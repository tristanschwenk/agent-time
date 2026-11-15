import type {DatabaseSync} from 'node:sqlite';
import type {CaptureEvent} from './events.ts';
export type ToolStatus='complete'|'open'|'orphan'|'ambiguous'|'clock_conflict';
export interface ToolBoundary {eventId:string;rowid:number;kind:string;observedAt:number;monotonicAt:number;collectorEpoch:string;}
export interface ToolExecution {identity:string;status:ToolStatus;start?:ToolBoundary;end?:ToolBoundary;boundaries:ToolBoundary[];}
/** Missing provider/host/session/tool IDs never collapse into an anonymous tool. */
export function toolIdentity(event:CaptureEvent):string|null {
 if(event.source!=='hook'||!['tool_start','tool_end'].includes(event.kind)||![event.provider,event.hostId,event.sessionId,event.data?.toolId].every(value=>typeof value==='string'&&value.length>0))return null;
 return JSON.stringify([event.provider,event.hostId,event.sessionId,event.data!.toolId,event.agentId??null,event.terminalHandle??null,event.terminalIncarnation??null]);
}
export class ToolReconciliation {
 private db:DatabaseSync;
 constructor(db:DatabaseSync){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS tool_boundaries(event_id TEXT PRIMARY KEY,identity TEXT NOT NULL,row_ref INTEGER NOT NULL,kind TEXT NOT NULL,observed_at REAL NOT NULL,monotonic_at REAL NOT NULL,collector_epoch TEXT NOT NULL); CREATE INDEX IF NOT EXISTS tool_boundaries_identity ON tool_boundaries(identity); CREATE TABLE IF NOT EXISTS tool_executions(identity TEXT PRIMARY KEY,status TEXT NOT NULL,start_event_id TEXT,end_event_id TEXT,start_at REAL,end_at REAL,start_count INTEGER NOT NULL,end_count INTEGER NOT NULL,payload TEXT NOT NULL);`);}
 ingest(rows:{rowid:number;event:CaptureEvent}[]):void {
  this.db.exec('SAVEPOINT tool_ingest');try{
   const touched=new Set<string>(),previous=this.db.prepare('SELECT identity FROM tool_boundaries WHERE event_id=?');
   const remove=this.db.prepare('DELETE FROM tool_boundaries WHERE event_id=?');
   const insert=this.db.prepare('INSERT INTO tool_boundaries VALUES(?,?,?,?,?,?,?)');
   for(const {rowid,event} of rows){const old=previous.get(event.eventId);if(old)touched.add(String(old.identity));remove.run(event.eventId);const identity=toolIdentity(event);if(identity){touched.add(identity);insert.run(event.eventId,identity,rowid,event.kind,event.observedAt,event.monotonicAt,event.collectorEpoch);}}
   for(const identity of touched)this.refresh(identity);
   this.db.exec('RELEASE tool_ingest');
  }catch(error){this.db.exec('ROLLBACK TO tool_ingest; RELEASE tool_ingest');throw error;}
 }
 remove(eventId:string):void{
  this.db.exec('SAVEPOINT tool_remove');try{const previous=this.db.prepare('SELECT identity FROM tool_boundaries WHERE event_id=?').get(eventId);this.db.prepare('DELETE FROM tool_boundaries WHERE event_id=?').run(eventId);if(previous)this.refresh(String(previous.identity));this.db.exec('RELEASE tool_remove');}catch(error){this.db.exec('ROLLBACK TO tool_remove; RELEASE tool_remove');throw error;}
 }
 get(identity:string):ToolExecution|undefined {const row=this.db.prepare('SELECT payload FROM tool_executions WHERE identity=?').get(identity);return row?JSON.parse(String(row.payload)) as ToolExecution:undefined;}
 private refresh(identity:string):void {
  const execution=this.reconcile(identity);if(!execution){this.db.prepare('DELETE FROM tool_executions WHERE identity=?').run(identity);return;}
  this.db.prepare('INSERT INTO tool_executions VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET status=excluded.status,start_event_id=excluded.start_event_id,end_event_id=excluded.end_event_id,start_at=excluded.start_at,end_at=excluded.end_at,start_count=excluded.start_count,end_count=excluded.end_count,payload=excluded.payload').run(identity,execution.status,execution.start?.eventId??null,execution.end?.eventId??null,execution.start?.observedAt??null,execution.end?.observedAt??null,execution.boundaries.filter(b=>b.kind==='tool_start').length,execution.boundaries.filter(b=>b.kind==='tool_end').length,JSON.stringify(execution));
 }
 private reconcile(identity:string):ToolExecution|undefined {
  const boundaries=this.db.prepare('SELECT * FROM tool_boundaries WHERE identity=? ORDER BY row_ref,event_id').all(identity).map(row=>({eventId:String(row.event_id),rowid:Number(row.row_ref),kind:String(row.kind),observedAt:Number(row.observed_at),monotonicAt:Number(row.monotonic_at),collectorEpoch:String(row.collector_epoch)}));
  if(!boundaries.length)return undefined;
  const starts=boundaries.filter(row=>row.kind==='tool_start'),ends=boundaries.filter(row=>row.kind==='tool_end');
  const result:ToolExecution={identity,status:'ambiguous',boundaries};
  if(starts.length>1||ends.length>1)return result;
  result.start=starts[0];result.end=ends[0];
  if(!result.start)result.status='orphan';else if(!result.end)result.status='open';else {
   const {start,end}=result;
   result.status=!Number.isFinite(start.observedAt)||!Number.isFinite(end.observedAt)||end.observedAt<start.observedAt||(start.collectorEpoch===end.collectorEpoch&&(!Number.isFinite(start.monotonicAt)||!Number.isFinite(end.monotonicAt)||end.monotonicAt<start.monotonicAt))?'clock_conflict':'complete';
  }
  return result;
 }
 reset():void{this.db.exec('SAVEPOINT tool_reset');try{this.db.exec('DELETE FROM tool_boundaries; DELETE FROM tool_executions; RELEASE tool_reset');}catch(error){this.db.exec('ROLLBACK TO tool_reset; RELEASE tool_reset');throw error;}}
}
