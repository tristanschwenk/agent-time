import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{EventStore}from'../src/capture/store.ts';import{Collector}from'../src/capture/collector.ts';import{makeEvent}from'../src/capture/events.ts';import{windowBounds}from'../src/capture/summary-window.ts';

test('selective durable revisions ignore unrelated samples and notice external edits and rollback',()=>{
 const dir=mkdtempSync(join(tmpdir(),'at-revisions-')),path=join(dir,'events.sqlite'),s=new EventStore(path),other=new EventStore(path);
 try{
  const before=s.dependencyRevision('resources'),review=s.dependencyRevision('review'),reports=s.reportedEvidenceRevision();
  other.put(makeEvent('macos','activity',{eventId:'sample',observedAt:100,data:{idleSeconds:0}}));
  assert.equal(s.dependencyRevision('resources'),before);assert.equal(s.dependencyRevision('review'),review);assert.equal(s.reportedEvidenceRevision(),reports);
  other.put(makeEvent('agent_report','resource',{eventId:'resource',observedAt:105,data:{url:'https://example.com',project:'/project'}}));
  const resource=s.dependencyRevision('resources');assert.notEqual(resource,before);assert.notEqual(s.reportedEvidenceRevision(),reports);
  other.database.prepare('DELETE FROM events WHERE event_id=?').run('resource');assert.notEqual(s.dependencyRevision('resources'),resource);
  const stable=s.dependencyRevision('resources');assert.throws(()=>other.transaction(()=>{other.put(makeEvent('agent_report','resource',{eventId:'rolledback',observedAt:110}));throw Error('rollback');}));assert.equal(s.dependencyRevision('resources'),stable);
  other.setHumanDecisions([['sample','sample']],'unassigned',null);assert.notEqual(s.dependencyRevision('review'),review);
 }finally{other.close();s.close();rmSync(dir,{recursive:true,force:true});}
});

test('window signatures read bounded bucket revisions, not all observations, and survive restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'at-window-stamp-')),path=join(dir,'events.sqlite');let s=new EventStore(path);
 const bounds=windowBounds(10*86400,11*86400,300);
 try{
  const first=s.projectionSignature(bounds);s.put(makeEvent('macos','activity',{eventId:'outside',observedAt:30*86400}));assert.equal(s.projectionSignature(bounds),first);
  s.put(makeEvent('macos','activity',{eventId:'inside',observedAt:10*86400+50}));const changed=s.projectionSignature(bounds);assert.notEqual(changed,first);
  s.close();s=new EventStore(path);assert.equal(s.projectionSignature(bounds),changed);
  const prepare=s.database.prepare.bind(s.database);s.database.prepare=(sql:string)=>{assert(!/count\(\*\).*FROM events/i.test(sql),'validation must not count history');return prepare(sql);};
  s.projectionSignature(bounds);s.reportedEvidenceRevision();s.dependencyRevision('review');
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('resource mapping reads only resources and refreshes on writes, expiry and clock rollback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'at-resource-stamp-')),c=new Collector(dir),realNow=Date.now;let now=Date.parse('2026-10-20T12:00:00Z');Date.now=()=>now;
 try{
  c.store.put(makeEvent('agent_report','resource',{eventId:'r',observedAt:now/1000,data:{url:'https://example.com/a',project:'/project'}}));
  let reads=0;const original=c.store.resourceEvents.bind(c.store);c.store.resourceEvents=(...args)=>{reads++;return original(...args);};
  assert.equal((c as any).resources().size,1);assert.equal(reads,1);
  now+=20_000;c.store.put(makeEvent('macos','activity',{observedAt:now/1000}));assert.equal((c as any).resources().size,1);assert.equal(reads,1);
  c.store.put(makeEvent('agent_report','resource',{eventId:'r2',observedAt:now/1000,data:{url:'https://example.com/b',project:'/other'}}));assert.equal((c as any).resources().size,2);assert.equal(reads,2);
  now+=32*86400*1000;assert.equal((c as any).resources().size,0);now-=32*86400*1000;assert.equal((c as any).resources().size,2);
 }finally{Date.now=realNow;await c.close();rmSync(dir,{recursive:true,force:true});}
});
