import type {AppReviewGroup} from './review-apps.ts';
import type {AgentExecution} from './project-explorer.ts';
import type {BillingReport} from '../capture/billing-types.ts';
export type ActivityDetailTarget =
 | {kind:'human';date:string;groups:AppReviewGroup[]}
 | {kind:'agent';date:string;execution:AgentExecution}
 | {kind:'billing';report:Omit<BillingReport,'projectSnapshot'>};
/** Original spans only. A first/last envelope would include unobserved gaps. */
export function activityDetailSpans(target:ActivityDetailTarget){
 if(target.kind==='billing')return [];
 return (target.kind==='human'?target.groups:target.execution.bars).map(item=>({start:item.start,end:item.end}));
}
type Range={start:number;end:number};
/** Ranges to exclude so that only `next` remains of `span`: the head before it and the tail after it. */
export function trimCuts(span:Range,next:Range):Array<[number,number]>{
 if(!(next.end>next.start)||next.start<span.start||next.end>span.end)throw new Error('Keep the new times inside the original interval');
 const cuts:Array<[number,number]>=[];
 if(next.start>span.start)cuts.push([span.start,next.start]);
 if(next.end<span.end)cuts.push([next.end,span.end]);
 return cuts;
}
/** `HH:MM:SS` for a time input, in local time. */
export function timeInputValue(seconds:number){const d=new Date(seconds*1000),p=(n:number)=>String(n).padStart(2,'0');return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
/** Epoch seconds for a time input value on a local date; `original` is kept when the field is unchanged, so sub-second edges survive. */
export function timeInputSeconds(date:string,value:string,original:number){
 if(value===timeInputValue(original))return original;
 const time=value.length===5?`${value}:00`:value,result=new Date(`${date}T${time}`).getTime()/1000;
 if(!Number.isFinite(result))throw new Error('Enter a valid time');
 return result;
}
