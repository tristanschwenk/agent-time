import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EventStore} from '../src/capture/store.ts';
import {UsageReader} from '../src/usage/reader.ts';

type CapturedReader={capturedSessions:(limit?:number)=>Map<string,number>;capturedRowid:number;capturedPending:boolean};
for(const packed of [true,false])for(const hasHook of [true,false])test(`captured polling indexes ${packed?'packed':'legacy'} non-hook tails (${hasHook?'with':'without'} hooks)`,async()=>{
 const store=packed?new EventStore(':memory:'):undefined;
 const db:DatabaseSync=store?(store as any).db:new DatabaseSync(':memory:');
 if(!packed)db.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');
 const insert=db.prepare(`INSERT INTO events(event_id,observed_at,${packed?'payload_data':'payload'}) VALUES(?,?,?)`);
 const append=(id:string,source:string,sessionId=id)=>insert.run(id,1,JSON.stringify({eventId:id,observedAt:1,source,provider:'codex',sessionId,kind:'session_start'}));
 db.exec('BEGIN');if(hasHook)append('hook','hook');for(let i=0;i<1000;i++)append('activity'+i,'macos');db.exec('COMMIT');
 let reader=new UsageReader(db,[],async()=>({}), '', '/nonexistent');
 const captured=()=>reader as unknown as CapturedReader;
 try{
  assert.equal(captured().capturedSessions().has('codex:hook'),hasHook);
  const source=packed?'source':"json_extract(payload,'$.source')";
  const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT rowid FROM events WHERE rowid>? AND ${source}='hook' ORDER BY rowid LIMIT ?`).all(captured().capturedRowid,20000);
  assert.ok(plan.some(row=>String(row.detail).includes('events_usage_hooks')),JSON.stringify(plan));
  assert.ok(!plan.some(row=>String(row.detail).includes('TEMP B-TREE')),JSON.stringify(plan));
  for(let i=0;i<3;i++)assert.equal(captured().capturedSessions().size,hasHook?1:0);
  append('new-hook','hook');append('new-tail','macos');
  assert.equal(captured().capturedSessions().get('codex:new-hook'),1);
  await reader.close();reader=new UsageReader(db,[],async()=>({}), '', '/nonexistent');
  assert.equal(captured().capturedSessions().size,hasHook?2:1);
  // Compaction changes the covered row count, invalidating saved sessions even when the last ID survives.
  db.exec("DELETE FROM events WHERE event_id='activity0'");
  db.prepare(`UPDATE events SET ${packed?'payload_data':'payload'}=? WHERE event_id='new-hook'`).run(JSON.stringify({source:'macos'}));
  await reader.close();reader=new UsageReader(db,[],async()=>({}), '', '/nonexistent');
  assert.equal(captured().capturedSessions().has('codex:new-hook'),false);
 }finally{await reader.close();if(store)store.close();else db.close();}
});

test('indexed captured polling preserves hook batches and earliest parent/child times',async()=>{
 const store=new EventStore(':memory:'),db:DatabaseSync=(store as any).db;
 const insert=db.prepare('INSERT INTO events(event_id,observed_at,payload_data) VALUES(?,?,?)');
 for(const [id,at,source,sessionId,kind,agentId] of [['h1',5,'hook','s','session_start',''],['a',6,'macos','','activity',''],['h2',2,'hook','s','child_start','child'],['h3',3,'hook','other','session_start','']] as const)
  insert.run(id,at,JSON.stringify({source,provider:'codex',sessionId,kind,agentId}));
 const reader=new UsageReader(db,[],async()=>({}), '', '/nonexistent'),internal=reader as unknown as CapturedReader;
 try{
  assert.equal(internal.capturedSessions(1).get('codex:s'),5);assert.equal(internal.capturedPending,true);
  const second=internal.capturedSessions(1);assert.equal(second.get('codex:s'),2);assert.equal(second.get('codex:child'),2);
  assert.equal(internal.capturedSessions(1).get('codex:other'),3);
  internal.capturedSessions(1);assert.equal(internal.capturedPending,false);
 }finally{await reader.close();store.close();}
});

test('hook index follows legacy-to-packed schema upgrades and restored row identities',async()=>{
 const {openEventDatabase,upgradeEventSchema}=await import('../src/capture/event-database.ts');
 const db=openEventDatabase(':memory:');db.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');
 db.prepare('INSERT INTO events VALUES(?,?,?)').run('old',1,JSON.stringify({source:'hook',provider:'codex',sessionId:'old'}));
 let reader=new UsageReader(db,[],async()=>({}), '', '/nonexistent');
 const captured=()=>reader as unknown as CapturedReader;
 try{
  assert.equal(captured().capturedSessions().get('codex:old'),1);
  await reader.close();upgradeEventSchema(db);
  reader=new UsageReader(db,[],async()=>({}), '', '/nonexistent');assert.equal(captured().capturedSessions().get('codex:old'),1);
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM events WHERE rowid>? AND source='hook' ORDER BY rowid LIMIT ?").all(1,20000);
  assert.ok(plan.some(row=>String(row.detail).includes('events_usage_hooks_packed')));
  // Same rowid/count, different last ID: restored history must rebuild its session map.
  db.prepare('UPDATE events SET event_id=?,payload_data=? WHERE rowid=1').run('restored',JSON.stringify({source:'hook',provider:'codex',sessionId:'restored'}));
  await reader.close();reader=new UsageReader(db,[],async()=>({}), '', '/nonexistent');
  assert.deepEqual([...captured().capturedSessions()],[['codex:restored',1]]);
 }finally{await reader.close();db.close();}
});
