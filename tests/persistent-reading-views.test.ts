import type{Summary}from'../src/capture/events.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Collector} from '../src/capture/collector.ts';
import {PeriodProjection} from '../src/capture/period-projection.ts';
import {snapshot} from '../src/mcp/data.ts';
import {openEventDatabase} from '../src/capture/event-database.ts';
import {makeEvent} from '../src/capture/events.ts';
const date='2026-10-20',from=new Date(date+'T00:00:00').getTime()/1000,to=from+86400;
const options={billingEvidence:true,persistedOnly:true,countTaskCounters:false};
function seed(c:Collector){for(let n=0;n<3;n++)c.store.put(makeEvent('macos','activity',{eventId:'sample'+n,observedAt:from+36000+n*10,data:{idleSeconds:0,foregroundName:'App'}}));}
test('generic views preserve Maps and property order, isolate namespaces, detect corruption and share discard',()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading-view-')),path=join(dir,'derived.sqlite');let cache=new PeriodProjection(path);
 try{const value={firstSeen:new Map([['b',2],['a',1]]),optional:undefined};cache.putView('one',date,'key',value);cache.putView('two',date,'key',{other:1});cache.close();cache=new PeriodProjection(path);assert.deepEqual(cache.getView('one',date,'key'),value);assert.equal(cache.getView('one',date,'changed'),undefined);
 const db=new DatabaseSync(path);db.prepare("UPDATE views SET data=x'00' WHERE namespace='one'").run();db.close();assert.equal(cache.getView('one',date,'key'),undefined);assert.deepEqual(cache.getView('two',date,'key'),{other:1});cache.discard();assert.equal(cache.retainedBytes,0);
 }finally{cache.close();rmSync(dir,{recursive:true,force:true});}
});
test('closed Review persists exact final summary and skips raw projection after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading-review-'));let c=new Collector(dir);
 try{seed(c);const first=c.versionedSummary(date);await c.close();c=new Collector(dir);(c as any).projection.get=()=>{throw Error('must use final Review');};assert.deepEqual(c.versionedSummary(date),first);assert.equal((c as any).days.computations,0);
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});
test('billing snapshots preserve exact output, pinned transactions, late evidence, settings, external edits and chunk bounds',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading-billing-')),c=new Collector(dir);
 try{seed(c);c.versionedHomeResponse(date);const expected=snapshot(dir,from,to,{...options,bypassProjection:true});assert.deepEqual(snapshot(dir,from,to,options),expected);
 const cache=new DatabaseSync(join(dir,'derived-periods.sqlite'));assert.equal(cache.prepare("SELECT count(*) n FROM views WHERE namespace='billing'").get()!.n,1);cache.close();
 const pinned=new DatabaseSync(join(dir,'events.sqlite'));pinned.exec('BEGIN');pinned.prepare('SELECT count(*) FROM events').get();
 c.store.put(makeEvent('macos','activity',{eventId:'late',observedAt:from+36035,data:{idleSeconds:0}}));
 assert.deepEqual(snapshot(dir,from,to,{...options,database:pinned}),expected);pinned.exec('ROLLBACK');pinned.close();
 for(const [a,b,settings] of [[from,to,undefined],[from+36001,to,{idleThreshold:1,agentIdleThreshold:300,countTaskCounters:false}]] as const)assert.deepEqual(snapshot(dir,a,b,{...options,settings}),snapshot(dir,a,b,{...options,settings,bypassProjection:true}));
 const external=openEventDatabase(join(dir,'events.sqlite'));external.prepare('DELETE FROM events WHERE event_id=?').run('sample1');external.close();assert.deepEqual(snapshot(dir,from,to,options),snapshot(dir,from,to,{...options,bypassProjection:true}));assert.notDeepEqual(snapshot(dir,from,to,options),expected);
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});
test('settled counter summaries persist while active leases and clock changes revalidate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading-counter-'));let c=new Collector(dir);const clock=Date.now;let now=to+60;Date.now=()=>now*1000;
 try{seed(c);c.updateSettings({countTaskCounters:true});c.store.put(makeEvent('agent_report','task_start',{eventId:'timer',provider:'claude',sessionId:'timer-session',observedAt:to-60,data:{name:'Timer',leaseSeconds:3600}}));
 const first=c.versionedSummary(date);now+=3601;const expired=c.versionedSummary(date,0,first.token);assert(!('unchanged'in expired));assert.equal(expired.agentSeconds,0);
 await c.close();c=new Collector(dir);assert.deepEqual(c.versionedSummary(date),expired);assert.equal((c as any).days.computations,0);
 now=to+60;assert(!('unchanged'in c.versionedSummary(date,0,expired.token)));
 }finally{Date.now=clock;await c.close();rmSync(dir,{recursive:true,force:true});}
});
test('generic views share raw/Home budgets and refused admission never stores data',()=>{
 const cache=new PeriodProjection(':memory:',1200),denied=new PeriodProjection(':memory:',1200,()=>false);
 try{for(let n=0;n<20;n++)cache.putView('fixture',String(n),'sig',{map:new Map([['x',n]])});assert(cache.retainedBytes<=1200);assert.equal(cache.getView('fixture','0','sig'),undefined);denied.putView('fixture',date,'sig',{data:1});assert.equal(denied.retainedBytes,0);}finally{cache.close();denied.close();}
});
test('legacy evidence without durable revision and nonpersisted reads never create a cached billing snapshot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading-legacy-')),c=new Collector(dir);
 try{seed(c);assert.equal(c.store.database.prepare("SELECT 1 FROM sqlite_master WHERE name='at_projection_revision'").get(),undefined);snapshot(dir,from,to,options);assert.equal(c.store.database.prepare("SELECT 1 FROM sqlite_master WHERE name='at_projection_revision'").get(),undefined);
 c.versionedHomeResponse(date);const db=new DatabaseSync(join(dir,'derived-periods.sqlite'));const count=()=>db.prepare("SELECT count(*) n FROM views WHERE namespace='billing'").get()!.n;assert.equal(count(),0);snapshot(dir,from,to,{...options,persistedOnly:false});snapshot(dir,from,to,{...options,countTaskCounters:true});assert.equal(count(),0);db.close();
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});

test('evicting heavy raw periods preserves lightweight final views for a 30-day report',()=>{
 const cache=new PeriodProjection(':memory:',65536);
 try{
  const raw={intervals:Array.from({length:200},(_,n)=>({start:n,end:n+1,state:'human',proof:'inferred',sourceEventIds:[String(n),String(n+1)]})),sessions:[],unresolved:[],coverage:[],humanSeconds:200,agentSeconds:0,childAgentSeconds:0,elapsedSeconds:200} as Summary;
  for(let n=0;n<30;n++){cache.put(String(n),'signature',raw);cache.putView('review',String(n),'signature',{n});cache.putView('counter-evidence',String(n),'signature',{events:[],ends:new Map()});}
  for(let n=0;n<30;n++){assert.deepEqual(cache.getView('review',String(n),'signature'),{n});assert.deepEqual(cache.getView('counter-evidence',String(n),'signature'),{events:[],ends:new Map()});}
  assert(cache.retainedBytes<=65536);
 }finally{cache.close();}
});
