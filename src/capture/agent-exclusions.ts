import type {Interval,Summary} from './events.ts';
import {minuteCreditSeconds} from './correlate.ts';
import {agentSessionKey} from './session-identity.ts';

/** A user-removed time range of one agent execution (`executionKey` is an `agentSessionKey`). */
export interface AgentTimeExclusion {id:string;executionKey:string;date:string;start:number;end:number;createdAt:number;undoneAt?:number}
type Range=[number,number];
const credited=new Set<Interval['state']>(['running','turn','grouped']);
const ranges=(items:Interval[]):Range[]=>items.map(i=>[i.start,i.end]);

/** Remove `cuts` from `ranges`; the result is sorted and non-overlapping. */
export function subtractRanges(source:Range[],cuts:Range[]):Range[]{
 const sorted=[...cuts].filter(([s,e])=>e>s).sort((a,b)=>a[0]-b[0]),out:Range[]=[];
 for(const [start,end] of source){
  let cursor=start;
  for(const [s,e] of sorted){if(e<=cursor||s>=end)continue;if(s>cursor)out.push([cursor,s]);cursor=Math.max(cursor,e);}
  if(cursor<end)out.push([cursor,end]);
 }
 return out;
}

/** Cut excluded ranges out of agent intervals and lower the totals by the minute credit they carried. */
export function applyAgentExclusions(summary:Summary,exclusions:readonly AgentTimeExclusion[]):Summary{
 const cuts=new Map<string,Range[]>();
 for(const x of exclusions)if(x.undoneAt===undefined&&x.end>x.start)cuts.set(x.executionKey,[...cuts.get(x.executionKey)||[],[x.start,x.end]]);
 if(!cuts.size)return summary;
 const hit=new Set<string>();
 const intervals:Interval[]=[];
 for(const interval of summary.intervals){
  const key=interval.state==='human'?undefined:agentSessionKey(interval),keyCuts=key&&cuts.get(key);
  if(!key||!keyCuts){intervals.push(interval);continue;}
  const parts=subtractRanges([[interval.start,interval.end]],keyCuts);
  if(parts.length===1&&parts[0]![0]===interval.start&&parts[0]![1]===interval.end){intervals.push(interval);continue;}
  hit.add(key);
  for(const [start,end] of parts)intervals.push({...interval,start,end});
 }
 if(!hit.size)return summary;
 const agentOf=(items:Interval[])=>items.filter(i=>credited.has(i.state));
 const before=agentOf(summary.intervals),after=agentOf(intervals);
 let main=0,child=0;const sessionDelta=new Map<string,number>();
 for(const key of hit){
  const pick=(items:Interval[])=>ranges(items.filter(i=>agentSessionKey(i)===key));
  const delta=minuteCreditSeconds(pick(before))-minuteCreditSeconds(pick(after));
  sessionDelta.set(key,delta);
  if(summary.intervals.some(i=>i.child&&agentSessionKey(i)===key))child+=delta;else main+=delta;
 }
 const human=ranges(summary.intervals.filter(i=>i.state==='human'));
 const wall=minuteCreditSeconds(ranges(before))-minuteCreditSeconds(ranges(after));
 const elapsed=minuteCreditSeconds([...ranges(before),...human])-minuteCreditSeconds([...ranges(after),...human]);
 const lower=(value:number,delta:number)=>Math.max(0,value-delta);
 const result:Summary={...summary,intervals,
  sessions:summary.sessions.map(s=>sessionDelta.has(s.key)?{...s,seconds:lower(s.seconds,sessionDelta.get(s.key)!)}:s),
  agentSeconds:lower(summary.agentSeconds,main),childAgentSeconds:lower(summary.childAgentSeconds,child),elapsedSeconds:lower(summary.elapsedSeconds,elapsed)};
 if(summary.mainAgentSeconds!==undefined)result.mainAgentSeconds=lower(summary.mainAgentSeconds,main);
 if(summary.agentWallSeconds!==undefined)result.agentWallSeconds=lower(summary.agentWallSeconds,wall);
 return result;
}
