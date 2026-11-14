import{agentSessionKey}from'./session-identity.ts';
import{buildAppReviewGroups,reviewContextGroups}from'./review-app-groups.ts';
import type{Summary,Interval}from'./events.ts';
import{groupHumanReview,humanReviewState}from'./human-review.ts';
export interface HomeReviewStatus{date:string;completedAt:number|null;stale:boolean;hasActivity:boolean;pendingGroups:number;capturedGroups:number;unmatchedSeconds:number;conflicts:number;gaps:number;}
export type HomeSummary=Summary&{home:{review?:HomeReviewStatus;version:1;reviewBadge:number;reviewPending:number;reviewCaptured:number}};
/** Display periods only. Original evidence and visit boundaries remain in the full summary. */
export function compactHome(summary:Summary):HomeSummary{
 // Human/session matching considers every root's whole observed window. Merging
 // visits across its boundary could turn one unique match into an ambiguous one.
 const roots=new Map<string,[number,number]>();
 for(const i of summary.intervals)if(i.state==='grouped'&&!i.child){const key=agentSessionKey(i),old=roots.get(key);roots.set(key,old?[Math.min(old[0],i.start),Math.max(old[1],i.end)]:[i.start,i.end]);}
 const boundaries=[...new Set([...roots.values()].flat())].sort((a,b)=>a-b);
 const crossesBoundary=(start:number,end:number)=>{let lo=0,hi=boundaries.length;while(lo<hi){const mid=(lo+hi)>>>1;if(boundaries[mid]!<=start)lo=mid+1;else hi=mid;}return lo<boundaries.length&&boundaries[lo]!<end;};
 const intervals:Interval[]=[],last=new Map<string,Interval>();
 for(const interval of summary.intervals){
  const {start,end,sourceEventIds,...context}=interval;
  const display={...context,observedEvidence:sourceEventIds.length>0},key=JSON.stringify(display),previous=last.get(key);
  if(previous&&previous.end===start&&(interval.state!=='human'||!crossesBoundary(previous.start,end))){previous.end=end;continue;}
  const next={...display,start,end,sourceEventIds:[]};intervals.push(next);last.set(key,next);
 }
 const groups=groupHumanReview(summary.intervals);
 return {...summary,intervals,home:{version:1,reviewBadge:reviewContextGroups(buildAppReviewGroups(summary.intervals)).filter(g=>['unmatched','conflict'].includes(humanReviewState(g.groups[0]!))).length,reviewPending:groups.filter(g=>['unmatched','conflict'].includes(humanReviewState(g))).length,reviewCaptured:groups.filter(g=>humanReviewState(g)==='captured').length}};
}
