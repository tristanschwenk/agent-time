import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditTaskCounters,type ReportedWorkItem} from '../src/capture/reported-work.ts';
import type {Summary,Interval,Session} from '../src/capture/events.ts';

test('many counters index each measured interval once instead of rescanning it per counter',()=>{
 let identityReads=0;
 const intervals=Array.from({length:2000},(_,i)=>({start:i*2,end:i*2+1,state:'running',proof:'observed',sourceEventIds:[String(i)],provider:'claude',hostId:'local',workspaceId:'/project',get sessionId(){identityReads++;return 'session';}})) as Interval[];
 const sessions=[{key:'session',sessionId:'session',hostId:'local',provider:'claude',workspaceId:'/project',title:'Agent',state:'stopped',lastObservedAt:4000,seconds:4000,observedSeconds:2000}] as Session[];
 const input={intervals,sessions,agentSeconds:4000,elapsedSeconds:4000,humanSeconds:0,childAgentSeconds:0,mainAgentSeconds:4000,agentWallSeconds:4000,unresolved:[],coverage:[]} as Summary;
 const items=Array.from({length:100},(_,i)=>({id:'counter-'+i,kind:'counter',title:'Task',provider:'claude',hostId:'local',sessionId:'session',workspaceId:'/project',start:5000+i*120,end:5010+i*120,active:false})) as ReportedWorkItem[];
 const result=creditTaskCounters(input,items);
 assert.equal(result.intervals.length,2100);
 assert.equal(result.agentSeconds,10000);
 assert.equal(input.intervals.length,2000);
 assert(identityReads<10000,`read measured interval identities ${identityReads} times`);
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Collector} from '../src/capture/collector.ts';
import {makeEvent} from '../src/capture/events.ts';
test('range reports validate only saved day reviews and remain identical to the legacy weekly report',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'period-report-cache-')),c=new Collector(dir);
 try{
  const at=new Date('2026-10-20T10:00:00').getTime()/1000;
  for(let i=0;i<4;i++)c.store.put(makeEvent('macos','activity',{eventId:'sample'+i,observedAt:at+i*5,monotonicAt:i*5,data:{idleSeconds:0}}));
  const expected=c.weeklyReview('2026-10-19');let checks=0;
  const real=(c as any).dayReviewSnapshot.bind(c);(c as any).dayReviewSnapshot=(date:string)=>{checks++;return real(date);};
  const {options,...report}=await c.periodReview('2026-10-19','2026-10-25');assert.deepEqual(report,expected);assert.equal(checks,0);
  c.store.setHumanDecisions([['sample0','sample1'],['sample1','sample2'],['sample2','sample3']],'unassigned',null);c.markDayReview('2026-10-20');
  const reviewed=c.weeklyReview('2026-10-19');checks=0;
  const result=await c.periodReview('2026-10-19','2026-10-25');const {options:_options,...actual}=result;
  assert.deepEqual(actual,reviewed);assert.equal(checks,1);
  c.store.setHumanDecisions([['sample0','sample1']],'assigned','/changed');
  assert.equal((c as any).dayReviewSnapshot('2026-10-20').stale,true);
  const stale=c.weeklyReview('2026-10-19');const {options:_staleOptions,...afterEdit}=await c.periodReview('2026-10-19','2026-10-25');assert.deepEqual(afterEdit,stale);
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});

test('unchanged day cache hits reuse retained-size accounting',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'period-cache-size-')),c=new Collector(dir);
 try{
  const days=(c as any).days,entry=days.window('2026-10-20');days.window('2026-10-21');let scans=0;
  Object.defineProperty(entry.raw,'accountingProbe',{enumerable:true,get(){scans++;return [];}});entry.version++;
  days.window('2026-10-20');scans=0;
  for(let i=0;i<5;i++)days.window('2026-10-20');
  assert.equal(scans,0,'cache hits must not recursively walk all retained summaries again');
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});

test('a range report releases days it loaded while preserving preexisting interactive day caches',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'period-cache-release-')),c=new Collector(dir);
 try{
  const days=(c as any).days;c.summaryForDate('2026-10-20');
  const before=c.summaryForDate('2026-10-20');
  await c.periodReview('2026-10-19','2026-10-25');
  assert.deepEqual([...days.entries.keys()],['2026-10-20']);
  assert.deepEqual(c.summaryForDate('2026-10-20'),before);
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});

import {EventStore} from '../src/capture/store.ts';
import {readWindowEvents} from '../src/capture/summary-window.ts';
test('packed-format window reads do not issue one payload query per observation and retain insertion order',()=>{
 const store=new EventStore(':memory:');
 try{
  const events=Array.from({length:200},(_,i)=>makeEvent('macos','activity',{eventId:'event'+i,observedAt:1000+(i%11),monotonicAt:i,data:{idleSeconds:0}}));
  for(const e of events)store.put(e);
  const db=store.database,prepare=db.prepare.bind(db);let payloadGets=0;
  db.prepare=(sql:string)=>{const statement=prepare(sql);if(sql.includes('payload_data')&&sql.includes('rowid=?')){const get=statement.get.bind(statement);statement.get=(...args:any[])=>{payloadGets++;return get(...args);};}return statement;};
  const result=readWindowEvents(db,990,1020,300);
  assert.deepEqual(result.events.map(e=>e.eventId),events.map(e=>e.eventId));
  assert.equal(payloadGets,0,'a single ordered payload stream replaces N per-row gets');
 }finally{store.close();}
});

import {randomUUID} from 'node:crypto';
import {emptyActivityFilters} from '../src/capture/activity-filter.ts';
test('period progress counts actual completed days and is queryable before work and between days',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'period-progress-')),c=new Collector(dir),id=randomUUID(),seen:any[]=[];
 try{
  const original=(c as any).daySummary.bind(c);(c as any).daySummary=(date:string,...args:any[])=>{seen.push((c as any).periodReviewProgress(id));return original(date,...args);};
  const pending=c.periodReview('2026-10-19','2026-10-21','all',emptyActivityFilters(),id);
  assert.deepEqual((c as any).periodReviewProgress(id),{phase:'reading',completedDays:0,totalDays:3,date:'2026-10-19'});
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(c.periodReviewProgress(id),{phase:'reading',completedDays:1,totalDays:3,date:'2026-10-20'});
  await pending;
  assert.deepEqual(seen.map(p=>p.completedDays),[0,1,2]);assert.deepEqual(seen.map(p=>p.date),['2026-10-19','2026-10-20','2026-10-21']);
  assert.deepEqual((c as any).periodReviewProgress(id),{phase:'complete',completedDays:3,totalDays:3});
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});

import {PeriodProgress} from '../src/capture/period-progress.ts';
import {dispatchRequest} from '../src/capture/protocol.ts';
test('progress records are bounded, reject reused active IDs and retain failure at the completed day',async()=>{
 const jobs=new PeriodProgress(),ids=Array.from({length:9},()=>randomUUID());
 for(const id of ids.slice(0,8))jobs.begin(id,30,'2026-10-14');
 assert.throws(()=>jobs.begin(ids[8]!,30,'2026-10-14'),/Too many/);
 assert.throws(()=>jobs.begin(ids[0]!,30,'2026-10-14'),/already used/);
 jobs.set(ids[0]!,{phase:'complete',completedDays:30,totalDays:30});jobs.begin(ids[8]!,30,'2026-10-14');assert.equal(jobs.get(ids[0]!),null);
 const copy=jobs.get(ids[1]!)!;copy.completedDays=99;assert.equal(jobs.get(ids[1]!)?.completedDays,0);
 const dir=mkdtempSync(join(tmpdir(),'period-progress-failure-')),c=new Collector(dir),id=randomUUID();
 try{
  const original=(c as any).daySummary.bind(c);(c as any).daySummary=(date:string)=>{if(date==='2026-10-20')throw new Error('Read failed');return original(date);};
  const pending=c.periodReview('2026-10-19','2026-10-21','all',emptyActivityFilters(),id);
  await assert.rejects(c.periodReview('2026-10-19','2026-10-21','all',emptyActivityFilters(),id),/already used/);
  await assert.rejects(pending,/Read failed/);assert.deepEqual(c.periodReviewProgress(id),{phase:'failed',completedDays:1,totalDays:3});
  assert.equal((c as any).days.entries.size,0);
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});
test('period progress is read-only and accepts only a UUID through the bridge',async()=>{
 const id=randomUUID(),calls:unknown[]=[];
 const controller={status:()=>({}),summary:()=>({}),start:async()=>({}),stop:async()=>({}),periodReviewProgress:(key:string)=>{calls.push(key);return null;},periodReview:(...args:unknown[])=>{calls.push(args);return {};}};
 assert.deepEqual(await dispatchRequest({id:'poll',method:'period_review_progress',params:{progressId:id}},controller),{id:'poll',result:null});
 for(const params of [{progressId:'../../file'},{progressId:id,path:'/tmp'},{progressId:42},{}])assert('error'in await dispatchRequest({id:'bad',method:'period_review_progress',params},controller));
 const scope={fromDate:'2026-10-19',toDate:'2026-10-21',progressId:id};assert('result'in await dispatchRequest({id:'run',method:'period_review',params:scope},controller));assert.equal((calls[1]as unknown[])[4],id);
 assert('error'in await dispatchRequest({id:'bad',method:'period_review',params:{...scope,progressId:'invalid'}},controller));assert.equal(calls.length,2);
});

test('days without counters do not scan historical session endings',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'period-no-counters-')),c=new Collector(dir);
 try{
  let reads=0;const original=c.store.sessionEnds.bind(c.store);c.store.sessionEnds=(...args)=>{reads++;return original(...args);};
  assert.deepEqual(c.reportedWork('2026-10-20'),[]);assert.equal(reads,0);
  c.store.put(makeEvent('agent_report','work_context',{observedAt:new Date('2026-10-20T10:00:00').getTime()/1000,data:{project:'P'}}));
  assert.equal(c.reportedWork('2026-10-20').length,1);assert.equal(reads,0);
  c.store.put(makeEvent('agent_report','task_start',{observedAt:new Date('2026-10-20T10:00:00').getTime()/1000,data:{name:'Task'}}));
  c.reportedWork('2026-10-20');assert.equal(reads,1);
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});
