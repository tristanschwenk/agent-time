import type {DatabaseSync} from 'node:sqlite';
import type {CaptureEvent} from './events.ts';
export type ToolStatus='complete'|'open'|'orphan'|'ambiguous'|'clock_conflict';
export interface ToolBoundary {eventId:string;rowid:number;kind:string;observedAt:number;monotonicAt:number;collectorEpoch:string;}
export interface ToolExecution {identity:string;status:ToolStatus;start?:ToolBoundary;end?:ToolBoundary;boundaries:ToolBoundary[];}
/** Incomplete identities never collapse into an anonymous execution. */
export function toolIdentity(event:CaptureEvent):string|null {
 if(event.source!=='hook'||!['tool_start','tool_end'].includes(event.kind)||![event.provider,event.hostId,event.sessionId,event.data?.toolId].every(value=>typeof value==='string'&&value.length>0))return null;
 return JSON.stringify([event.provider,event.hostId,event.sessionId,event.data!.toolId,event.agentId??null,event.terminalHandle??null,event.terminalIncarnation??null]);
}
export class ToolReconciliation {
 private db:DatabaseSync;private maxBytes:number;
 constructor(db:DatabaseSync,maxBytes=192*1024*1024){
  this.db=db;this.maxBytes=maxBytes;
  // Upgrade only this reconstructible index; proofs and review records stay intact.
  if(db.prepare('PRAGMA table_info(tool_boundaries)').all().some(row=>row.name==='identity')){
   db.exec('BEGIN IMMEDIATE');try{db.exec('DROP TABLE tool_boundaries;DROP TABLE tool_executions');
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ingestion_state'").get())db.exec(`UPDATE ingestion_state SET rowid_cursor=0${db.prepare('PRAGMA table_info(ingestion_state)').all().some(row=>row.name==='started')?',started=0':''};UPDATE credited_slices SET dirty=1`);db.exec('COMMIT');
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  }
  db.exec(`CREATE TABLE IF NOT EXISTS tool_index_state(id INTEGER PRIMARY KEY CHECK(id=1),disabled INTEGER NOT NULL);INSERT OR IGNORE INTO tool_index_state VALUES(1,0);CREATE TABLE IF NOT EXISTS tool_executions(id INTEGER PRIMARY KEY,identity TEXT NOT NULL UNIQUE,status TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tool_boundaries(event_id TEXT PRIMARY KEY,execution INTEGER NOT NULL,row_ref INTEGER NOT NULL,kind TEXT NOT NULL,observed_at REAL NOT NULL,monotonic_at REAL NOT NULL,collector_epoch TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS tool_boundaries_execution ON tool_boundaries(execution);`);
 }
 ingest(rows:{rowid:number;event:CaptureEvent}[]):void {
  this.db.exec('SAVEPOINT tool_ingest');try{
   if(this.disabled()){this.db.exec('RELEASE tool_ingest');return;}
   const used=(Number(this.db.prepare('PRAGMA page_count').get()!.page_count)-Number(this.db.prepare('PRAGMA freelist_count').get()!.freelist_count))*Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
   // Reserve space for credited periods. Never retain a partial identity that
   // could hide an older duplicate: suspend the whole optional tool index.
   // The original reducer still credits from all proofs, including late ends.
   const incoming=rows.reduce((bytes,{event})=>bytes+(Buffer.byteLength(toolIdentity(event)||'')*2+Buffer.byteLength(event.eventId)*2+Buffer.byteLength(event.collectorEpoch||'')+512)*4,0);
   if(used+incoming>=this.maxBytes){this.db.exec('DELETE FROM tool_boundaries;DELETE FROM tool_executions;UPDATE tool_index_state SET disabled=1;RELEASE tool_ingest');return;}
   const touched=new Set<number>(),previous=this.db.prepare('SELECT execution FROM tool_boundaries WHERE event_id=?'),remove=this.db.prepare('DELETE FROM tool_boundaries WHERE event_id=?'),insert=this.db.prepare('INSERT INTO tool_boundaries VALUES(?,?,?,?,?,?,?)'),ensure=this.db.prepare("INSERT OR IGNORE INTO tool_executions(identity,status) VALUES(?,'open')"),find=this.db.prepare('SELECT id FROM tool_executions WHERE identity=?');
   for(const{rowid,event}of rows){const old=previous.get(event.eventId);if(old)touched.add(Number(old.execution));remove.run(event.eventId);const identity=toolIdentity(event);if(identity){ensure.run(identity);const id=Number(find.get(identity)!.id);touched.add(id);insert.run(event.eventId,id,rowid,event.kind,event.observedAt,event.monotonicAt,event.collectorEpoch);}}
   for(const id of touched)this.refresh(id);this.db.exec('RELEASE tool_ingest');
  }catch(error){try{this.db.exec('ROLLBACK TO tool_ingest; RELEASE tool_ingest');}catch{}throw error;}
 }
 remove(eventId:string):void{
  this.db.exec('SAVEPOINT tool_remove');try{const previous=this.db.prepare('SELECT execution FROM tool_boundaries WHERE event_id=?').get(eventId);this.db.prepare('DELETE FROM tool_boundaries WHERE event_id=?').run(eventId);if(previous)this.refresh(Number(previous.execution));this.db.exec('RELEASE tool_remove');}catch(error){try{this.db.exec('ROLLBACK TO tool_remove; RELEASE tool_remove');}catch{}throw error;}
 }
 private boundaries(id:number):ToolBoundary[]{return this.db.prepare('SELECT * FROM tool_boundaries WHERE execution=? ORDER BY row_ref,event_id').all(id).map(row=>({eventId:String(row.event_id),rowid:Number(row.row_ref),kind:String(row.kind),observedAt:Number(row.observed_at),monotonicAt:Number(row.monotonic_at),collectorEpoch:String(row.collector_epoch)}));}
 get(identity:string):ToolExecution|undefined{
  const own=!this.db.isTransaction;if(own)this.db.exec('BEGIN');try{
   const row=this.db.prepare('SELECT id,status FROM tool_executions WHERE identity=?').get(identity);if(!row)return;const boundaries=this.boundaries(Number(row.id)),result:ToolExecution={identity,status:row.status as ToolStatus,boundaries};
   if(result.status!=='ambiguous'){result.start=boundaries.find(b=>b.kind==='tool_start');result.end=boundaries.find(b=>b.kind==='tool_end');}return result;
  }finally{if(own)this.db.exec('ROLLBACK');}
 }

 private refresh(id:number):void {
  const boundaries=this.boundaries(id);if(!boundaries.length){this.db.prepare('DELETE FROM tool_executions WHERE id=?').run(id);return;}
  const starts=boundaries.filter(b=>b.kind==='tool_start'),ends=boundaries.filter(b=>b.kind==='tool_end');let status:ToolStatus='ambiguous';
  if(starts.length<=1&&ends.length<=1){const start=starts[0],end=ends[0];if(!start)status='orphan';else if(!end)status='open';else status=!Number.isFinite(start.observedAt)||!Number.isFinite(end.observedAt)||end.observedAt<start.observedAt||(start.collectorEpoch===end.collectorEpoch&&(!Number.isFinite(start.monotonicAt)||!Number.isFinite(end.monotonicAt)||end.monotonicAt<start.monotonicAt))?'clock_conflict':'complete';}
  this.db.prepare('UPDATE tool_executions SET status=? WHERE id=?').run(status,id);
 }
 disabled(){return Boolean(this.db.prepare('SELECT disabled FROM tool_index_state WHERE id=1').get()?.disabled);}
 reset():void{this.db.exec('SAVEPOINT tool_reset');try{this.db.exec('DELETE FROM tool_boundaries; DELETE FROM tool_executions;UPDATE tool_index_state SET disabled=0; RELEASE tool_reset');}catch(error){try{this.db.exec('ROLLBACK TO tool_reset; RELEASE tool_reset');}catch{}throw error;}}
}
