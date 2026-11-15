import type {CaptureEvent,Summary,Interval} from './events.ts';
import {minuteCreditSeconds,summarize} from './correlate.ts';
import {estimatedBytes} from './storage-policy.ts';
import {isActivitySample,resetsActivity} from './summary-window.ts';

// Minimal fallback when no live stream was admitted: activity samples alone
// can append without changing session identity, capture fences, or agent credit.
export function appendActivitySummary(summary:Summary,previous:CaptureEvent|undefined,events:CaptureEvent[],idleThreshold:number):Summary|null {
 if(!events.length||events.some(event=>event.source!=='macos'||event.kind!=='activity'))return null;
 const delta=summarize(previous?[previous,...events]:events,{idleThreshold});
 if(delta.coverage.length||delta.unresolved.length||delta.intervals.some(interval=>interval.state!=='human'))return null;
 const firstGrouped=summary.intervals.findIndex(interval=>interval.state==='grouped');
 const intervals=firstGrouped<0?[...summary.intervals,...delta.intervals]:[
  ...summary.intervals.slice(0,firstGrouped),...delta.intervals,...summary.intervals.slice(firstGrouped),
 ];
 const human=intervals.filter(interval=>interval.state==='human').map(interval=>[interval.start,interval.end] as [number,number]);
 const grouped=intervals.filter(interval=>interval.state==='grouped').map(interval=>[interval.start,interval.end] as [number,number]);
 return {...summary,intervals,humanSeconds:minuteCreditSeconds(human),elapsedSeconds:minuteCreditSeconds([...grouped,...human])};
}

type LiveOptions={idleThreshold:number;agentIdleThreshold:number};
/** Disposable stream cache. Human intervals share the raw summary's objects;
 * only non-activity evidence and one activity anchor retain source payloads.
 * Agent state is deliberately replayed by the authoritative reducer: native
 * promotion and background ownership make per-session partitions unsafe. */
export interface LiveSummaryState {
 evidence:CaptureEvent[];human:Interval[];lastActivity?:CaptureEvent;
 maxObservedAt:number;epochs:Record<string,number>;options:LiveOptions;budgetBytes:number;
}
const liveEvidenceLimit=4096,liveEpochLimit=128,liveBudget=4*1024*1024;
function extendLive(state:LiveSummaryState,events:CaptureEvent[],initial=false):LiveSummaryState|null {
 const next={...state,evidence:state.evidence.slice(),epochs:{...state.epochs}};
 for(const event of events){
  // Newly arriving fences/workers require a full replay. Historical ones stay
  // in the replayed agent evidence. Equal wall times and
  // monotonic ties also fall back rather than reconstructing causal tie order.
  if(!Number.isFinite(event.observedAt)||!Number.isFinite(event.monotonicAt)||event.observedAt<=next.maxObservedAt||
   Object.hasOwn(next.epochs,event.collectorEpoch)&&event.monotonicAt<=next.epochs[event.collectorEpoch]!||
   !initial&&['worker','sleep','capture_start','capture_stop','capture_settings'].includes(event.kind)||event.kind==='activity'&&!isActivitySample(event))return null;
  next.maxObservedAt=event.observedAt;
  Object.defineProperty(next.epochs,event.collectorEpoch,{value:event.monotonicAt,writable:true,configurable:true,enumerable:true});
  if(isActivitySample(event))next.lastActivity=event;else{next.evidence.push(event);if(resetsActivity(event))next.lastActivity=undefined;}
 }
 if(next.evidence.length>liveEvidenceLimit||Object.keys(next.epochs).length>liveEpochLimit||
  estimatedBytes({evidence:next.evidence,lastActivity:next.lastActivity,epochs:next.epochs},next.budgetBytes)>next.budgetBytes)return null;
 return next;
}
/** Inputs are SQLite-unique evidence and its corresponding raw reducer output. */
export function createLiveSummary(events:CaptureEvent[],summary:Summary,options:LiveOptions,budgetBytes=liveBudget):LiveSummaryState|null {
 const ordered=events.slice().sort((a,b)=>a.observedAt-b.observedAt);
 const state=extendLive({evidence:[],human:[],maxObservedAt:-Infinity,epochs:{},options:{...options},budgetBytes:Math.min(budgetBytes,liveBudget)},ordered,true);
 if(!state)return null;
 state.evidence=events.filter(event=>!isActivitySample(event));
 state.human=summary.intervals.filter(interval=>interval.state==='human');
 return state;
}
export function appendLiveSummary(state:LiveSummaryState,events:CaptureEvent[],options:LiveOptions):{summary:Summary;state:LiveSummaryState}|null {
 if(!events.length||options.idleThreshold!==state.options.idleThreshold||options.agentIdleThreshold!==state.options.agentIdleThreshold)return null;
 const next=extendLive(state,events);if(!next)return null;
 const activity=events.filter(isActivitySample);
 const delta=activity.length?summarize(state.lastActivity?[state.lastActivity,...activity]:activity,options):undefined;
 next.human=delta?[...state.human,...delta.intervals]:state.human;
 const summary=summarize(next.evidence,{...options,alreadyUnique:true,settledActivity:next.human});
 return {summary,state:next};
}
