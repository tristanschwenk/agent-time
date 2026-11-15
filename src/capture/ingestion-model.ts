import{resourceKey}from'./reported-resources.ts';
import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';import{serialize,deserialize}from'node:v8';import{deflateRawSync,inflateRawSync}from'node:zlib';import{existsSync,mkdirSync,chmodSync,statSync,readFileSync}from'node:fs';import{join}from'node:path';
import type{BillingDayInput,BillingSpan}from'./billing-types.ts';import type{CaptureEvent}from'./events.ts';import{validProjectPaths,type ProjectPathDependency}from'./project-path.ts';import{ingestionMeta,ingestionJournalState,readIngestionChanges,type IngestMeta}from'./ingestion-journal.ts';import{ToolReconciliation}from'./tool-reconciliation.ts';import{quickStorageUsage,DEFAULT_STORAGE_LIMIT_MB}from'./storage-policy.ts';
export function ingestionStorageLimit(root:string){try{const n=Number(JSON.parse(readFileSync(join(root,'settings.json'),'utf8')).storageLimitMB);if(Number.isFinite(n)&&n>0)return n;}catch{}return DEFAULT_STORAGE_LIMIT_MB;}
export interface PreparedCreditedInput{value:BillingDayInput;paths:ProjectPathDependency[]|undefined;sessions:string[][];tasks:string[];urls?:string[];asOf:number;validUntil:number;dayEnd?:number;agentIdleThreshold?:number;}
const pack=(v:unknown)=>deflateRawSync(serialize(v),{level:1}),unpack=(v:unknown)=>deserialize(inflateRawSync(v as Uint8Array,{maxOutputLength:32*1024*1024}));
interface Point{identity:string;rowid:number;sequence:number;}
function sourcePoint(db:DatabaseSync):Point{
 const identity=db.prepare('SELECT identity FROM at_dependency_revision WHERE id=1').get()?.identity;if(!identity)throw Error('Source tracking unavailable');
 const file=String(db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file||'');const inode=file?statSync(file):undefined;
 return{identity:JSON.stringify([identity,inode?.ino,inode?.birthtimeMs]),rowid:Number(db.prepare('SELECT coalesce(max(rowid),0) n FROM events').get()!.n),sequence:ingestionJournalState(db).sequence};
}
/** Merge only exactly adjacent equal billing contexts; no gap, identity, project,
 * state or exclusion is invented. The unchanged billing engine still rounds. */
export function coalesceCreditedSpans(spans:BillingSpan[]):BillingSpan[]{
 const result:BillingSpan[]=[];let previousKey='';for(const span of spans){const{start,end,...context}=span,key=JSON.stringify(context),last=result.at(-1);if(last&&key===previousKey&&last.end===start)last.end=end;else result.push({...span});previousKey=key;}return result;
}
/** Durable ingestion read model, separate from the evictable display cache.
 * All values remain reconstructible from authoritative source evidence. */
export class IngestionModel{
 readonly database:DatabaseSync;readonly tools:ToolReconciliation;private root:string;private limitMB:number;private admission?:(bytes:number)=>boolean;
 constructor(root:string,create=true,limitMB=ingestionStorageLimit(root),admission?:(bytes:number)=>boolean){
  this.root=root;this.limitMB=limitMB;this.admission=admission;const path=join(root,'ingestion.sqlite');if(!create&&!existsSync(path))throw Error('Ingestion model absent');
  if(create){mkdirSync(root,{recursive:true,mode:0o700});if(!existsSync(path)&&!this.canWrite(65536))throw Error('Ingestion preparation paused for storage capacity');}
  const db=this.database=new DatabaseSync(path);try{const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(version>2)throw Error('Newer ingestion model');chmodSync(path,0o600);db.exec(`PRAGMA busy_timeout=200; PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA max_page_count=65536;
   CREATE TABLE IF NOT EXISTS ingestion_state(id INTEGER PRIMARY KEY,identity TEXT NOT NULL,rowid_cursor INTEGER NOT NULL,change_cursor INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS ingestion_days(bucket INTEGER PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS credited_slices(key TEXT PRIMARY KEY,project TEXT NOT NULL,date TEXT NOT NULL,config TEXT NOT NULL,start REAL NOT NULL,day_end REAL NOT NULL,read_from REAL NOT NULL,read_to REAL NOT NULL,activity_from REAL NOT NULL,activity_to REAL NOT NULL,dirty INTEGER NOT NULL,as_of REAL NOT NULL,valid_until REAL NOT NULL,meta BLOB,contexts BLOB,paths BLOB,digest TEXT);
   CREATE TABLE IF NOT EXISTS credited_periods(slice TEXT NOT NULL,ordinal INTEGER NOT NULL,start REAL NOT NULL,end REAL NOT NULL,context INTEGER NOT NULL,PRIMARY KEY(slice,ordinal)) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS credited_sessions(slice TEXT NOT NULL,provider TEXT NOT NULL,session TEXT NOT NULL,PRIMARY KEY(slice,provider,session)) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS credited_tasks(slice TEXT NOT NULL,task TEXT NOT NULL,PRIMARY KEY(slice,task)) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS credited_urls(slice TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(slice,url)) WITHOUT ROWID;
   CREATE INDEX IF NOT EXISTS credited_urls_identity ON credited_urls(url);
   CREATE INDEX IF NOT EXISTS credited_sessions_identity ON credited_sessions(provider,session);
   CREATE INDEX IF NOT EXISTS credited_tasks_identity ON credited_tasks(task);
   CREATE INDEX IF NOT EXISTS credited_dirty ON credited_slices(dirty,date); PRAGMA user_version=2;`);this.tools=new ToolReconciliation(db);
  }catch(error){db.close();throw error;}
 }
 private canWrite(bytes:number){if(this.admission&&!this.admission(bytes))return false;let file=0;try{file=statSync(join(this.root,'ingestion.sqlite')).size;}catch{}bytes=bytes*2+file;const usage=quickStorageUsage(this.root);return !usage.truncated&&(usage.freeBytes===null||usage.freeBytes-bytes>=1024**3)&&usage.managedBytes+bytes<this.limitMB*1024*1024*.9;}
 private state():Point|undefined{const row=this.database.prepare('SELECT * FROM ingestion_state WHERE id=1').get();return row?{identity:String(row.identity),rowid:Number(row.rowid_cursor),sequence:Number(row.change_cursor)}:undefined;}
 private save(point:Point){this.database.prepare('INSERT INTO ingestion_state VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET identity=excluded.identity,rowid_cursor=excluded.rowid_cursor,change_cursor=excluded.change_cursor').run(point.identity,point.rowid,point.sequence);}
 private mark(meta:IngestMeta){
  const{indexedAt,...logical}=meta;if(indexedAt!==undefined&&indexedAt!==meta.observedAt)this.mark({...logical,observedAt:indexedAt});
  const db=this.database,at=meta.observedAt;if(!Number.isFinite(at))return;
  const sample=meta.source==='macos'&&meta.kind==='activity';
  db.prepare(`UPDATE credited_slices SET dirty=1 WHERE dirty=0 AND ${sample?'activity_from<=? AND activity_to>?':'read_from<=? AND read_to>?'}`).run(at,at);
  if(meta.source==='agent_report'&&meta.kind==='resource'){const url=typeof meta.url==='string'?resourceKey(meta.url):null;if(url)db.prepare('UPDATE credited_slices SET dirty=1 WHERE dirty=0 AND start-2678400<? AND day_end+2678400>? AND key IN(SELECT slice FROM credited_urls WHERE url=?)').run(at,at,url);else if(meta.url===undefined)db.prepare('UPDATE credited_slices SET dirty=1 WHERE dirty=0 AND start-2678400<? AND day_end+2678400>?').run(at,at);}
  if(meta.source==='agent_report'&&meta.kind==='work_context'&&meta.provider&&meta.sessionId)db.prepare('UPDATE credited_slices SET dirty=1 WHERE dirty=0 AND read_to>? AND key IN(SELECT slice FROM credited_sessions WHERE provider=? AND session=?)').run(at,meta.provider,meta.sessionId);
  db.prepare('UPDATE credited_slices SET dirty=1 WHERE dirty=0 AND key IN(SELECT slice FROM credited_tasks WHERE task=?)').run(meta.eventId);
 }
 /** Transactional, resumable source ingestion. A wake after a rolled-back source
  * write is harmless: only committed rows in this pinned source are consumed. */
 sync(source:DatabaseSync,limit=4096,allowReset=true){const own=!source.isTransaction;if(own)source.exec('BEGIN');try{return this.syncPinned(source,limit,allowReset);}finally{if(own&&source.isTransaction)source.exec('ROLLBACK');}}
 private syncPinned(source:DatabaseSync,limit:number,allowReset:boolean){
  const target=sourcePoint(source),db=this.database,journal=ingestionJournalState(source);let state=this.state();let scanned=0;
  if(state?.identity===target.identity&&(state.sequence>target.sequence||state.rowid>target.rowid&&state.sequence===target.sequence))return{caughtUp:false,scanned,cursor:state.rowid,future:true};
  if(!allowReset&&(!state||state.identity!==target.identity))return{caughtUp:false,scanned,cursor:state?.rowid??0,future:true};
  if(state&&JSON.stringify(state)===JSON.stringify(target))return{caughtUp:true,scanned,cursor:state.rowid};
  if(!this.canWrite(256*1024))return{caughtUp:false,scanned,cursor:state?.rowid??0,capacity:true};
  db.exec('BEGIN IMMEDIATE');try{
   state=this.state();if(state?.identity===target.identity&&(state.sequence>target.sequence||state.rowid>target.rowid&&state.sequence===target.sequence)){db.exec('ROLLBACK');return{caughtUp:false,scanned,cursor:state.rowid,future:true};}
   if(!state||state.identity!==target.identity){db.exec('DELETE FROM credited_periods;DELETE FROM credited_slices;DELETE FROM credited_sessions;DELETE FROM credited_tasks;DELETE FROM credited_urls;DELETE FROM ingestion_days');this.tools.reset();state={identity:target.identity,rowid:0,sequence:journal.sequence};}
   if(state.sequence<journal.firstSequence-1){db.exec('UPDATE credited_slices SET dirty=1');this.tools.reset();state.rowid=0;state.sequence=journal.sequence;}
   const changes=readIngestionChanges(source,state.sequence,limit),read=source.prepare('SELECT rowid,payload FROM events WHERE event_id=?');
   for(const change of changes){
    if(change.kind==='blocks'){db.exec('UPDATE credited_slices SET dirty=1');this.tools.reset();state.rowid=0;}
    else if(change.kind==='review')for(const pair of change.pairs||[]){const times=pair.flatMap(id=>{const row=source.prepare('SELECT observed_at FROM events WHERE event_id=?').get(id);return row?[Number(row.observed_at)]:[];});if(times.length)db.prepare('UPDATE credited_slices SET dirty=1 WHERE activity_from<=? AND activity_to>?').run(Math.max(...times),Math.min(...times));else db.exec('UPDATE credited_slices SET dirty=1');}
    else{
     const ids=new Set<string>();for(const meta of [change.old,change.next])if(meta){this.mark(meta);this.tools.remove(meta.eventId);ids.add(meta.eventId);}
     for(const id of ids){const row=read.get(id);if(row){const event=JSON.parse(String(row.payload)) as CaptureEvent;this.tools.ingest([{rowid:Number(row.rowid),event}]);this.mark(ingestionMeta(event));}}
    }
    state.sequence=change.sequence;
   }
   state.rowid=Math.min(state.rowid,target.rowid);
   const packed=Number(source.prepare('PRAGMA user_version').get()?.user_version)===2,src=packed?'source':"json_extract(payload,'$.source')",sample=packed?'activity_sample':"(json_extract(payload,'$.source')='macos' AND json_extract(payload,'$.kind')='activity')";
   const rows=source.prepare(`SELECT rowid,event_id,observed_at,${src} source,${sample} sample,CASE WHEN ${src} IN('hook','agent_report') THEN payload ELSE NULL END payload FROM events WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`).all(state.rowid,target.rowid,limit);
   const boundaries:Array<{rowid:number;event:CaptureEvent}>=[],buckets=new Set<number>(),hasSlices=Boolean(db.prepare('SELECT 1 FROM credited_slices LIMIT 1').get());
   for(const row of rows){const event=row.payload?JSON.parse(String(row.payload)) as CaptureEvent:undefined;const meta=event?ingestionMeta(event):{eventId:String(row.event_id),source:String(row.source),kind:row.sample?'activity':'',observedAt:Number(row.observed_at)};
    if(hasSlices){this.mark(meta);if(meta.observedAt!==Number(row.observed_at))this.mark({...meta,observedAt:Number(row.observed_at)});}if(event?.source==='hook')boundaries.push({rowid:Number(row.rowid),event});buckets.add(Math.floor(meta.observedAt/86400));state.rowid=Number(row.rowid);scanned++;
   }
   this.tools.ingest(boundaries);for(const bucket of buckets)db.prepare('INSERT OR IGNORE INTO ingestion_days VALUES(?)').run(bucket);
   this.save(state);db.exec('COMMIT');return{caughtUp:state.rowid===target.rowid&&state.sequence===target.sequence,scanned,cursor:state.rowid};
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 }
 register(project:string,date:string,config:string,start:number,end:number,idle:number){const key=JSON.stringify([project,date]);this.database.prepare(`INSERT INTO credited_slices(key,project,date,config,start,day_end,read_from,read_to,activity_from,activity_to,dirty,as_of,valid_until) VALUES(?,?,?,?,?,?,?,?,?,?,1,0,0) ON CONFLICT(key) DO UPDATE SET dirty=1,config=excluded.config,start=excluded.start,day_end=excluded.day_end,read_from=excluded.read_from,read_to=excluded.read_to,activity_from=excluded.activity_from,activity_to=excluded.activity_to WHERE config<>excluded.config OR start<>excluded.start OR day_end<>excluded.day_end`).run(key,project,date,config,start,end,start-86400-idle,end+86400+idle,start-60,end+60);}
 buckets(){return this.database.prepare('SELECT bucket FROM ingestion_days ORDER BY bucket').all().map(r=>Number(r.bucket));}
 pending(limit=1){return this.database.prepare('SELECT project,date,config FROM credited_slices WHERE dirty=1 ORDER BY (meta IS NULL) DESC,date DESC,project LIMIT ?').all(limit).map(r=>({project:String(r.project),date:String(r.date),config:String(r.config)}));}
 stats(){const db=this.database;return{toolIndexAvailable:!this.tools.disabled(),prepared:Number(db.prepare('SELECT count(*) n FROM credited_slices WHERE dirty=0').get()!.n),dirty:Number(db.prepare('SELECT count(*) n FROM credited_slices WHERE dirty=1').get()!.n),periods:Number(db.prepare('SELECT count(*) n FROM credited_periods').get()!.n),tools:Number(db.prepare('SELECT count(*) n FROM tool_executions').get()!.n),cursor:this.state()?.rowid??0};}
 put(source:DatabaseSync,project:string,date:string,config:string,prepared:PreparedCreditedInput){
  if(!prepared.paths||!Number.isFinite(prepared.value.start)||!Number.isFinite(prepared.value.end))return false;const db=this.database,target=sourcePoint(source),key=JSON.stringify([project,date]),{spans,...rest}=prepared.value;
  const rows=coalesceCreditedSpans(spans),contexts:Array<{context:Omit<BillingSpan,'start'|'end'>;layout:string[]}>=[],ids=new Map<string,number>();
  const periods=rows.map(span=>{const{start,end,...context}=span,value={context,layout:Object.keys(span)},encoded=serialize(value).toString('base64');let n=ids.get(encoded);if(n===undefined){n=contexts.length;contexts.push(value);ids.set(encoded,n);}return{start,end,context:n};});
  const meta=pack(rest),contextData=pack(contexts),paths=pack(prepared.paths),digest=createHash('sha256').update(meta).update(contextData).update(paths);for(const row of periods)digest.update(JSON.stringify(row));
  if(!this.canWrite((meta.length+contextData.length+paths.length+periods.length*128)*2+1024*1024))return false;
  db.exec('BEGIN IMMEDIATE');try{const state=this.state();if(!state||JSON.stringify(state)!==JSON.stringify(target)){db.exec('ROLLBACK');return false;}
   const end=prepared.dayEnd??rest.end,idle=prepared.agentIdleThreshold??300;
   db.prepare('INSERT OR REPLACE INTO credited_slices VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)').run(key,project,date,config,rest.start,end,rest.start-86400-idle,end+86400+idle,rest.start-60,end+60,prepared.asOf,prepared.validUntil,meta,contextData,paths,digest.digest('hex'));
   for(const table of ['credited_periods','credited_sessions','credited_tasks','credited_urls'])db.prepare(`DELETE FROM ${table} WHERE slice=?`).run(key);
   const write=db.prepare('INSERT INTO credited_periods VALUES(?,?,?,?,?)');periods.forEach((row,n)=>write.run(key,n,row.start,row.end,row.context));
   for(const [provider,session] of prepared.sessions)if(provider&&session)db.prepare('INSERT OR IGNORE INTO credited_sessions VALUES(?,?,?)').run(key,provider,session);
   for(const task of prepared.tasks)db.prepare('INSERT OR IGNORE INTO credited_tasks VALUES(?,?)').run(key,task);
   for(const url of prepared.urls||[])db.prepare('INSERT OR IGNORE INTO credited_urls VALUES(?,?)').run(key,url);
   db.exec('COMMIT');return true;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 }
 get(source:DatabaseSync,project:string,date:string,config:string,asOf:number):BillingDayInput|undefined{
  try{if(!this.sync(source,4096,false).caughtUp)return;const target=sourcePoint(source),db=this.database;let invalid:{key:string;digest:string}|undefined;db.exec('BEGIN');try{
   if(JSON.stringify(this.state())!==JSON.stringify(target))return;
   const row=db.prepare('SELECT * FROM credited_slices WHERE key=? AND config=? AND dirty=0').get(JSON.stringify([project,date]),config);if(!row||asOf<Number(row.as_of))return;invalid={key:String(row.key),digest:String(row.digest)};if(asOf>=Number(row.valid_until))return;
   const dependencies=unpack(row.paths);if(!validProjectPaths(dependencies))return;
   const contexts=unpack(row.contexts) as Array<{context:Record<string,unknown>;layout:string[]}>,rest=unpack(row.meta) as Omit<BillingDayInput,'spans'>,spans:BillingSpan[]=[],digest=createHash('sha256').update(row.meta as Uint8Array).update(row.contexts as Uint8Array).update(row.paths as Uint8Array);
   for(const p of db.prepare('SELECT start,end,context FROM credited_periods WHERE slice=? ORDER BY ordinal').iterate(row.key!)){const context=contexts[Number(p.context)];if(!context)return;const value={start:Number(p.start),end:Number(p.end),context:Number(p.context)};digest.update(JSON.stringify(value));spans.push(Object.fromEntries(context.layout.map(k=>[k,k==='start'?value.start:k==='end'?value.end:context.context[k]])) as unknown as BillingSpan);}
   if(digest.digest('hex')!==row.digest)return;
   invalid=undefined;return{...rest,end:Math.min(Number(row.day_end),asOf),spans};
  }finally{db.exec('ROLLBACK');if(invalid)db.prepare('UPDATE credited_slices SET dirty=1 WHERE key=? AND digest=?').run(invalid.key,invalid.digest);}}
  catch{return undefined;}
 }
 discard(){try{const db=this.database;db.exec('BEGIN IMMEDIATE;DELETE FROM credited_periods;DELETE FROM credited_slices;DELETE FROM credited_sessions;DELETE FROM credited_tasks;DELETE FROM credited_urls;DELETE FROM ingestion_days;DELETE FROM ingestion_state');this.tools.reset();db.exec('COMMIT;VACUUM');return true;}catch{if(this.database.isTransaction)this.database.exec('ROLLBACK');return false;}}
 close(){this.database.close();}
}
