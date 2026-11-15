import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{Collector}from'../src/capture/collector.ts';import{makeEvent}from'../src/capture/events.ts';
test('persisted backlog follows resource expiry and agrees with direct review after restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'at-review-expiry-')),real=Date.now;let now=Date.parse('2026-11-15T12:00Z');Date.now=()=>now;let c=new Collector(root);try{
 c.store.put(makeEvent('agent_report','resource',{observedAt:now/1000-31*86400+60,data:{url:'https://example.test/artifact',project:'/project'}}));const at=new Date('2026-11-13T10:00:00').getTime()/1000;
 for(const observedAt of [at,at+10])c.store.put(makeEvent('macos','activity',{observedAt,data:{idleSeconds:0,foregroundBundleId:'com.brave.Browser',browserDomain:'example.test',browserUrl:'https://example.test/artifact'}}));
 c.markDayReview('2026-11-13');const proof=c.store.events();assert.equal(c.dayReviewStatus('2026-11-15').backlog.length,0);now+=120000;
 const row=c.dayReviewStatus('2026-11-15').backlog.find(r=>r.date==='2026-11-13');assert(row);assert.equal(row.pendingGroups,1);assert.equal(row.unmatchedSeconds,10);assert.equal(c.dayReviewStatus('2026-11-13',false).stale,true);assert.deepEqual(c.store.events(),proof);
 await c.close();c=new Collector(root);assert.equal((await c.dayReviewStatusAsync('2026-11-15')).backlog.find(r=>r.date==='2026-11-13')?.pendingGroups,1);
 }finally{await c.close();Date.now=real;rmSync(root,{recursive:true,force:true});}
});
