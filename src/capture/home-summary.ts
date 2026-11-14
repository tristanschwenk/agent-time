import{buildAppReviewGroups,reviewContextGroups}from'./review-app-groups.ts';
import type{Summary,Interval}from'./events.ts';
import{groupHumanReview,humanReviewState}from'./human-review.ts';
export type HomeSummary=Summary&{home:{version:1;reviewBadge:number;reviewPending:number;reviewCaptured:number}};
/** Display periods only. Original evidence and visit boundaries remain in the full summary. */
export function compactHome(summary:Summary):HomeSummary{
 const intervals:Interval[]=[],last=new Map<string,Interval>();
 for(const interval of summary.intervals){
  const {start,end,sourceEventIds,...context}=interval;
  const display={...context,observedEvidence:sourceEventIds.length>0},key=JSON.stringify(display),previous=last.get(key);
  if(previous&&previous.end===start){previous.end=end;continue;}
  const next={...display,start,end,sourceEventIds:[]};intervals.push(next);last.set(key,next);
 }
 const groups=groupHumanReview(summary.intervals);
 return {...summary,intervals,home:{version:1,reviewBadge:reviewContextGroups(buildAppReviewGroups(summary.intervals)).filter(g=>['unmatched','conflict'].includes(humanReviewState(g.groups[0]!))).length,reviewPending:groups.filter(g=>['unmatched','conflict'].includes(humanReviewState(g))).length,reviewCaptured:groups.filter(g=>humanReviewState(g)==='captured').length}};
}
