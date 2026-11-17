import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAgentExclusions,subtractRanges,type AgentTimeExclusion} from '../src/capture/agent-exclusions.ts';
import {agentSessionKey} from '../src/capture/session-identity.ts';
import type {Interval,Summary} from '../src/capture/events.ts';

const id={hostId:'h',provider:'codex',sessionId:'s1'};
const key=agentSessionKey(id);
const iv=(start:number,end:number,extra:Partial<Interval>={}):Interval=>({start,end,state:'grouped',proof:'inferred',sourceEventIds:[],...id,...extra});
const summary=(intervals:Interval[],extra:Partial<Summary>={}):Summary=>{
 const main=intervals.filter(i=>i.state!=='human'&&!i.child).reduce((s,i)=>s+i.end-i.start,0);
 const child=intervals.filter(i=>i.state!=='human'&&i.child).reduce((s,i)=>s+i.end-i.start,0);
 const human=intervals.filter(i=>i.state==='human').reduce((s,i)=>s+i.end-i.start,0);
 return {intervals,unresolved:[],coverage:[],humanSeconds:human,agentSeconds:main+child,mainAgentSeconds:main,agentWallSeconds:main+child,childAgentSeconds:child,elapsedSeconds:main+child+human,
  sessions:[{key,title:'t',state:'x',lastObservedAt:0,seconds:main,observedSeconds:0,child:false,proof:'inferred',...id}],...extra};
};
const ex=(start:number,end:number,executionKey=key,extra:Partial<AgentTimeExclusion>={}):AgentTimeExclusion=>({id:`e${start}`,executionKey,date:'2026-01-01',start,end,createdAt:1,...extra});
const agent=(s:Summary)=>s.intervals.filter(i=>i.state!=='human');
const totals=(s:Summary)=>[s.agentSeconds,s.mainAgentSeconds,s.agentWallSeconds,s.elapsedSeconds,s.sessions[0]!.seconds];

test('subtractRanges cuts and merges',()=>{
 assert.deepEqual(subtractRanges([[0,10]],[[2,4],[3,6]]),[[0,2],[6,10]]);
 assert.deepEqual(subtractRanges([[0,10]],[[0,10]]),[]);
});
test('deleting a whole interval removes it and its credit',()=>{
 const r=applyAgentExclusions(summary([iv(0,3600)]),[ex(0,3600)]);
 assert.equal(agent(r).length,0);
 assert.deepEqual(totals(r),[0,0,0,0,0]);assert.equal(r.childAgentSeconds,0);
});
for(const [name,cut,expected,credit] of [['head trim',[0,1800],[[1800,3600]],1800],['tail trim',[1800,3600],[[0,1800]],1800],['middle split',[1200,2400],[[0,1200],[2400,3600]],1200]] as const)
 test(name,()=>{
  const r=applyAgentExclusions(summary([iv(0,3600)]),[ex(cut[0],cut[1])]);
  assert.deepEqual(agent(r).map(i=>[i.start,i.end]),expected);
  assert.deepEqual(totals(r),Array(5).fill(3600-credit));
 });
test('main agent exclusion does not touch subagents',()=>{
 const child={child:true,agentId:'a1'};
 const s=summary([iv(0,3600),iv(0,3600,child)],{agentWallSeconds:3600,elapsedSeconds:3600});
 const r=applyAgentExclusions(s,[ex(0,3600)]);
 assert.deepEqual(agent(r).map(i=>i.child),[true]);
 assert.equal(r.childAgentSeconds,3600);assert.equal(r.agentSeconds,3600);assert.equal(r.mainAgentSeconds,0);
 assert.equal(r.agentWallSeconds,3600);assert.equal(r.elapsedSeconds,3600);
});
test('dispatch execution matched by dispatch key',()=>{
 const s=summary([iv(0,3600,{dispatchId:'d1'})]);
 assert.equal(agent(applyAgentExclusions(s,[ex(0,3600,agentSessionKey({hostId:'h',dispatchId:'d1'}))])).length,0);
 assert.equal(applyAgentExclusions(s,[ex(0,3600,key)]),s);
});
test('human intervals are never cut',()=>{
 const s=summary([iv(0,3600,{state:'human'})]);
 const r=applyAgentExclusions(s,[ex(0,3600)]);
 assert.equal(r,s);assert.equal(r.humanSeconds,3600);
});
test('counter-credited interval is cut',()=>{
 const r=applyAgentExclusions(summary([iv(100,3700,{state:'running',sourceEventIds:['counter-id']})]),[ex(0,4000)]);
 assert.equal(agent(r).length,0);assert.deepEqual(totals(r),[0,0,0,0,0]);
});
test('overlapping exclusions subtract once',()=>{
 const r=applyAgentExclusions(summary([iv(0,3600)]),[ex(0,2000),ex(1000,3000)]);
 assert.deepEqual(agent(r).map(i=>[i.start,i.end]),[[3000,3600]]);
 assert.deepEqual(totals(r),Array(5).fill(600));
});
test('elapsed keeps human time and other agents covering the cut',()=>{
 const other=iv(0,1800,{sessionId:'s2'});
 const r=applyAgentExclusions(summary([iv(0,3600),other,iv(3600,4200,{state:'human'})],{agentWallSeconds:3600,elapsedSeconds:4200}),[ex(0,3600)]);
 assert.equal(r.elapsedSeconds,1800+600);assert.equal(r.agentWallSeconds,1800);
});
test('undone exclusions are ignored',()=>{
 const s=summary([iv(0,3600)]);
 assert.equal(applyAgentExclusions(s,[ex(0,3600,key,{undoneAt:5})]),s);
});
test('no intersecting exclusion returns the same summary object',()=>{
 const s=summary([iv(0,3600)]);
 assert.equal(applyAgentExclusions(s,[ex(4000,5000)]),s);
 assert.equal(applyAgentExclusions(s,[]),s);
});
