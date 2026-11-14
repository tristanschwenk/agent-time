import{createHash}from'node:crypto';
import{statfsSync}from'node:fs';
import{DatabaseSync}from'node:sqlite';
import{serialize,deserialize}from'node:v8';
import{deflateRawSync,inflateRawSync}from'node:zlib';
import{mkdirSync,chmodSync}from'node:fs';import{dirname}from'node:path';
import type{Summary,Interval}from'./events.ts';
const pack=(value:unknown)=>deflateRawSync(serialize(value),{level:1});
const unpack=(value:unknown)=>deserialize(inflateRawSync(value as Uint8Array,{maxOutputLength:64*1024*1024}));
/** Disposable read model. Source evidence remains exclusively in EventStore. */
export class PeriodProjection{
 private db?:DatabaseSync;private path:string;private budget:number;
 constructor(path:string,budget=64*1024*1024){this.path=path;this.budget=budget;}
 private open(){
  if(this.db)return this.db;
  if(this.path!==':memory:')mkdirSync(dirname(this.path),{recursive:true,mode:0o700});
  const db=new DatabaseSync(this.path);
  try{
   if(this.path!==':memory:')chmodSync(this.path,0o600);
   const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(version>2)throw Error('Newer projection format');if(version!==2)db.exec('DROP TABLE IF EXISTS periods; DROP TABLE IF EXISTS days; PRAGMA user_version=2');
   db.exec(`PRAGMA busy_timeout=200; PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA max_page_count=32768;
    CREATE TABLE IF NOT EXISTS days(date TEXT PRIMARY KEY,signature TEXT NOT NULL,header BLOB NOT NULL,proofs BLOB NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS periods(day TEXT NOT NULL,ordinal INTEGER NOT NULL,start REAL NOT NULL,end REAL NOT NULL,state TEXT NOT NULL,context INTEGER NOT NULL,PRIMARY KEY(day,ordinal)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS periods_time ON periods(day,start,end);`);
   this.db=db;return db;
  }catch(error){db.close();throw error;}
 }
 get retainedBytes(){try{return Number(this.open().prepare('SELECT coalesce(sum(bytes),0) n FROM days').get()?.n);}catch{return 0;}}
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
   if(this.path!==':memory:'){try{const volume=statfsSync(dirname(this.path));if(Number(volume.bavail)*Number(volume.bsize)<1024**3)return;}catch{}}
   db=this.open();const {intervals,...rest}=summary,contexts:unknown[]=[],indices=new Map<string,number>(),proofs:string[][]=[];
   const rows=intervals.map(interval=>{const {start,end,sourceEventIds,...context}=interval,stored={context,layout:Object.keys(interval)},key=serialize(stored).toString('base64');let id=indices.get(key);if(id===undefined){id=contexts.length;contexts.push(stored);indices.set(key,id);}proofs.push(sourceEventIds);return {start,end,state:interval.state,context:id};});
   const header=pack({rest,contexts,count:rows.length}),proofData=pack(proofs),bytes=header.length+proofData.length+rows.length*128+signature.length*2+256;
   if(bytes>this.budget)return;
   const digest=createHash('sha256').update(header).update(proofData);for(const r of rows)digest.update(JSON.stringify([r.start,r.end,r.state,r.context]));
   db.exec('BEGIN IMMEDIATE');
   db.prepare('DELETE FROM periods WHERE day=?').run(date);db.prepare('DELETE FROM days WHERE date=?').run(date);
   while(Number(db.prepare('SELECT coalesce(sum(bytes),0) n FROM days').get()?.n)+bytes>this.budget||Number(db.prepare('SELECT count(*) n FROM days').get()?.n)>=32){const oldest=db.prepare('SELECT date FROM days ORDER BY rowid LIMIT 1').get();if(!oldest)break;db.prepare('DELETE FROM periods WHERE day=?').run(String(oldest.date));db.prepare('DELETE FROM days WHERE date=?').run(String(oldest.date));}
   db.prepare('INSERT INTO days VALUES(?,?,?,?,?,?)').run(date,signature,header,proofData,bytes,digest.digest('hex'));
   const write=db.prepare('INSERT INTO periods VALUES(?,?,?,?,?,?)');rows.forEach((r,n)=>write.run(date,n,r.start,r.end,r.state,r.context));
   while(Number(db.prepare('SELECT sum(bytes) n FROM days').get()?.n)>this.budget||Number(db.prepare('SELECT count(*) n FROM days').get()?.n)>32){const oldest=String(db.prepare('SELECT date FROM days ORDER BY rowid LIMIT 1').get()!.date);db.prepare('DELETE FROM periods WHERE day=?').run(oldest);db.prepare('DELETE FROM days WHERE date=?').run(oldest);}
   db.exec('COMMIT; PRAGMA incremental_vacuum(1024)');
  }catch{if(db?.isTransaction)db.exec('ROLLBACK');/* A full/unavailable derived cache never blocks capture or results. */}
 }
 close(){this.db?.close();this.db=undefined;}
}
