import{createHash}from'node:crypto';
import{statfsSync}from'node:fs';
import{DatabaseSync}from'node:sqlite';
import{serialize,deserialize}from'node:v8';
import{deflateRawSync,inflateRawSync}from'node:zlib';
import{mkdirSync,chmodSync,rmSync,statSync,existsSync}from'node:fs';import{dirname}from'node:path';
import type{HomeWire}from'./home-wire.ts';
import type{Summary,Interval}from'./events.ts';
const pack=(value:unknown)=>deflateRawSync(serialize(value),{level:1});
const unpack=(value:unknown)=>deserialize(inflateRawSync(value as Uint8Array,{maxOutputLength:64*1024*1024}));
/** Disposable read model. Source evidence remains exclusively in EventStore. */
export class PeriodProjection{
 private db?:DatabaseSync;private path:string;private budget:number;private admission:(bytes:number)=>boolean;
 constructor(path:string,budget=64*1024*1024,admission:(bytes:number)=>boolean=()=>true){this.path=path;this.budget=budget;this.admission=admission;}
 private open(){
  if(this.db)return this.db;
  if(this.path!==':memory:'){mkdirSync(dirname(this.path),{recursive:true,mode:0o700});if(!existsSync(this.path)&&!this.canWrite(32768))throw Error('No capacity for derived periods');}
  const db=new DatabaseSync(this.path);
  try{
   if(this.path!==':memory:')chmodSync(this.path,0o600);
   const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(version>3)throw Error('Newer projection format');if(version!==3)db.exec('DROP TABLE IF EXISTS periods; DROP TABLE IF EXISTS days; DROP TABLE IF EXISTS home_views; PRAGMA user_version=3');
   db.exec(`PRAGMA busy_timeout=200; PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA max_page_count=32768;
    CREATE TABLE IF NOT EXISTS days(date TEXT PRIMARY KEY,signature TEXT NOT NULL,header BLOB NOT NULL,proofs BLOB NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS views(namespace TEXT NOT NULL,date TEXT NOT NULL,signature TEXT NOT NULL,data BLOB NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(namespace,date));
    CREATE TABLE IF NOT EXISTS home_views(date TEXT PRIMARY KEY,signature TEXT NOT NULL,data BLOB NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS periods(day TEXT NOT NULL,ordinal INTEGER NOT NULL,start REAL NOT NULL,end REAL NOT NULL,state TEXT NOT NULL,context INTEGER NOT NULL,PRIMARY KEY(day,ordinal)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS periods_time ON periods(day,start,end);`);
   this.db=db;return db;
  }catch(error){db.close();throw error;}
 }
 /** Raw reducer graphs are the most expensive cache entries. Drop those first,
  * keeping independently validated final views useful across a 30-day report. */
 private evict(db:DatabaseSync):boolean{
  const raw=db.prepare('SELECT date FROM days ORDER BY rowid LIMIT 1').get();
  if(raw){db.prepare('DELETE FROM periods WHERE day=?').run(String(raw.date));db.prepare('DELETE FROM days WHERE date=?').run(String(raw.date));return true;}
  const home=db.prepare('SELECT date FROM home_views ORDER BY rowid LIMIT 1').get();
  if(home){db.prepare('DELETE FROM home_views WHERE date=?').run(String(home.date));return true;}
  return Number(db.prepare('DELETE FROM views WHERE rowid=(SELECT rowid FROM views ORDER BY rowid LIMIT 1)').run().changes)>0;
 }
 get retainedBytes(){try{return Number(this.open().prepare('SELECT (SELECT coalesce(sum(bytes),0) FROM days)+(SELECT coalesce(sum(bytes),0) FROM home_views)+(SELECT coalesce(sum(bytes),0) FROM views) n').get()?.n);}catch{return 0;}}
 get(date:string,signature:string):Summary|undefined{
  try{
   const db=this.open(),row=db.prepare('SELECT header,proofs,digest FROM days WHERE date=? AND signature=?').get(date,signature);if(!row)return;
   const {rest,contexts,count}=unpack(row.header) as {rest:Omit<Summary,'intervals'>;contexts:Array<{context:Omit<Interval,'start'|'end'|'sourceEventIds'>;layout:string[]}>;count:number},proofs=unpack(row.proofs) as string[][];
   const intervals:Interval[]=[],digest=createHash('sha256').update(row.header as Uint8Array).update(row.proofs as Uint8Array);
   for(const p of db.prepare('SELECT start,end,state,context FROM periods WHERE day=? ORDER BY ordinal').iterate(date)){
    const stored=contexts[Number(p.context)],context=stored?.context,ids=proofs[intervals.length];if(!context||!ids||context.state!==p.state)throw Error('Invalid derived period');
    digest.update(JSON.stringify([Number(p.start),Number(p.end),String(p.state),Number(p.context)]));
    intervals.push(Object.fromEntries(stored!.layout.map(key=>[key,key==='start'?Number(p.start):key==='end'?Number(p.end):key==='sourceEventIds'?ids:(context as unknown as Record<string,unknown>)[key]])) as unknown as Interval);
   }
   if(digest.digest('hex')!==row.digest||intervals.length!==count||proofs.length!==count)throw Error('Incomplete derived periods');
   return {...rest,intervals};
  }catch{return undefined;}
 }
 put(date:string,signature:string,summary:Summary){
  let db:DatabaseSync|undefined;
  try{
   db=this.open();const {intervals,...rest}=summary,contexts:unknown[]=[],indices=new Map<string,number>(),proofs:string[][]=[];
   const rows=intervals.map(interval=>{const {start,end,sourceEventIds,...context}=interval,stored={context,layout:Object.keys(interval)},key=serialize(stored).toString('base64');let id=indices.get(key);if(id===undefined){id=contexts.length;contexts.push(stored);indices.set(key,id);}proofs.push(sourceEventIds);return {start,end,state:interval.state,context:id};});
   const header=pack({rest,contexts,count:rows.length}),proofData=pack(proofs),bytes=header.length+proofData.length+rows.length*128+signature.length*2+256;
   if(bytes>this.budget||!this.canWrite(bytes))return;
   const digest=createHash('sha256').update(header).update(proofData);for(const r of rows)digest.update(JSON.stringify([r.start,r.end,r.state,r.context]));
   db.exec('BEGIN IMMEDIATE');
   db.prepare('DELETE FROM periods WHERE day=?').run(date);db.prepare('DELETE FROM days WHERE date=?').run(date);
   while(this.retainedBytes+bytes>this.budget||Number(db.prepare('SELECT count(*) n FROM days').get()?.n)>=32){if(!this.evict(db)){db.exec('ROLLBACK');return;}}
   db.prepare('INSERT INTO days VALUES(?,?,?,?,?,?)').run(date,signature,header,proofData,bytes,digest.digest('hex'));
   const write=db.prepare('INSERT INTO periods VALUES(?,?,?,?,?,?)');rows.forEach((r,n)=>write.run(date,n,r.start,r.end,r.state,r.context));
   db.exec('COMMIT; PRAGMA incremental_vacuum(1024)');
  }catch{if(db?.isTransaction)db.exec('ROLLBACK');/* A full/unavailable derived cache never blocks capture or results. */}
 }
 private canWrite(bytes:number){
  let fileBytes=0;if(this.path!==':memory:')try{fileBytes=statSync(this.path).size;}catch{}
  // Reserve both new pages and a possible rollback journal of existing pages.
  const reserve=bytes*2+fileBytes+1024*1024;
  if(!this.admission(reserve))return false;
  if(this.path!==':memory:')try{const volume=statfsSync(dirname(this.path));return Number(volume.bavail)*Number(volume.bsize)-reserve>=1024**3;}catch{return false;}
  return true;
 }
 getHome(date:string,signature:string):HomeWire|undefined{
  try{const row=this.open().prepare('SELECT data,digest FROM home_views WHERE date=? AND signature=?').get(date,signature);if(!row)return;
   if(createHash('sha256').update(row.data as Uint8Array).digest('hex')!==row.digest)return;
   const value=unpack(row.data) as HomeWire;if(value.format!=='home-periods-v1')return;return value;
  }catch{return undefined;}
 }
 putHome(date:string,signature:string,value:HomeWire){
  let db:DatabaseSync|undefined;try{
   const data=pack(value),bytes=data.length+signature.length*2+256;if(bytes>this.budget||!this.canWrite(bytes))return;
   db=this.open();db.exec('BEGIN IMMEDIATE');db.prepare('DELETE FROM home_views WHERE date=?').run(date);
   while(this.retainedBytes+bytes>this.budget){if(!this.evict(db)){db.exec('ROLLBACK');return;}}
   // A Home-only view is allowed when the raw period set was too large to retain.
   db.prepare('INSERT INTO home_views VALUES(?,?,?,?,?)').run(date,signature,data,bytes,createHash('sha256').update(data).digest('hex'));
   while(Number(db.prepare('SELECT count(*) n FROM home_views').get()?.n)>32)db.prepare('DELETE FROM home_views WHERE date=(SELECT date FROM home_views ORDER BY rowid LIMIT 1)').run();
   db.exec('COMMIT; PRAGMA incremental_vacuum(1024)');
  }catch{if(db?.isTransaction)db.exec('ROLLBACK');}
 }
 getView<T>(namespace:string,date:string,signature:string):T|undefined{
  try{const row=this.open().prepare('SELECT data,digest FROM views WHERE namespace=? AND date=? AND signature=?').get(namespace,date,signature);if(!row)return;
   if(createHash('sha256').update(row.data as Uint8Array).digest('hex')!==row.digest)return;
   return unpack(row.data) as T;
  }catch{return undefined;}
 }
 putView<T>(namespace:string,date:string,signature:string,value:T){
  let db:DatabaseSync|undefined;try{
   const data=pack(value),bytes=data.length+(namespace.length+date.length+signature.length)*2+256;
   if(bytes>this.budget||!this.canWrite(bytes))return;
   db=this.open();db.exec('BEGIN IMMEDIATE');db.prepare('DELETE FROM views WHERE namespace=? AND date=?').run(namespace,date);
   while(this.retainedBytes+bytes>this.budget){if(!this.evict(db)){db.exec('ROLLBACK');return;}}
   db.prepare('INSERT INTO views VALUES(?,?,?,?,?,?)').run(namespace,date,signature,data,bytes,createHash('sha256').update(data).digest('hex'));
   while(Number(db.prepare('SELECT count(*) n FROM views WHERE namespace=?').get(namespace)?.n)>32)db.prepare('DELETE FROM views WHERE rowid=(SELECT rowid FROM views WHERE namespace=? ORDER BY rowid LIMIT 1)').run(namespace);
   while(Number(db.prepare('SELECT count(*) n FROM views').get()?.n)>96)db.prepare('DELETE FROM views WHERE rowid=(SELECT rowid FROM views ORDER BY rowid LIMIT 1)').run();
   db.exec('COMMIT; PRAGMA incremental_vacuum(1024)');
  }catch{if(db?.isTransaction)db.exec('ROLLBACK');}
 }
 discard(){
  if(this.path!==':memory:'&&!existsSync(this.path))return false;
  let db:DatabaseSync|undefined;
  try{
   db=this.open();const before=this.path===':memory:'?this.retainedBytes:statSync(this.path).size;
   db.exec('BEGIN IMMEDIATE; DELETE FROM periods; DELETE FROM days; DELETE FROM home_views; DELETE FROM views; COMMIT; VACUUM');
   // Keep the inode: other readers must not write an invisible, unlinked cache.
   return this.path===':memory:'?before>0:statSync(this.path).size<before;
  }catch(error){
   if(db?.isTransaction)db.exec('ROLLBACK');
   if(!/not a database|malformed/i.test(String(error)))return false;
   this.close();if(this.path===':memory:')return false;
   let removed=false;for(const suffix of ['', '-journal','-wal','-shm'])try{const path=this.path+suffix;if(statSync(path).isFile()){rmSync(path);removed=true;}}catch{}
   return removed;
  }
 }

 close(){this.db?.close();this.db=undefined;}
}
