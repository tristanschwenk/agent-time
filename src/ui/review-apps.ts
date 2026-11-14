import type {Interval} from '../capture/events.ts';
import {humanReviewState,type HumanReviewGroup} from '../capture/human-review.ts';
import {clampTimeRange,type TimeRange} from './timeline-viewport.ts';
import{buildAppReviewGroups,reviewContextGroups,reviewGroupId,type AppReviewGroup,type ReviewAppSection}from'../capture/review-app-groups.ts';
export{buildAppReviewGroups,reviewContextGroups,reviewGroupId,reviewContextTitle,reviewVisitTitle,type AppReviewGroup,type ReviewAppSection,type ReviewContextGroup}from'../capture/review-app-groups.ts';
const pairKey=(pair:readonly string[],segment?:string)=>JSON.stringify([pair[0],pair[1],segment||'']);
export function reviewCheckState(groups:AppReviewGroup[],selected:Readonly<Record<string,boolean>>){
  const eligible=groups.filter(group=>!group.reviewSegment),count=eligible.filter(group=>selected[reviewGroupId(group)]).length;
  return {eligible,checked:eligible.length>0&&count===eligible.length,partial:count>0&&count<eligible.length};
}

export function reviewAppSections(groups:AppReviewGroup[]):ReviewAppSection[]{
  const sections=new Map<string,ReviewAppSection>();
  for(const group of groups){
    let app=sections.get(group.appKey);
    if(!app){app={key:group.appKey,label:group.appName,bundleId:group.bundleId,hostId:group.hostId,groups:[],contexts:[],seconds:0};sections.set(app.key,app);}
    app.groups.push(group);app.seconds+=group.seconds;
  }
  for(const app of sections.values()){app.groups.sort((a,b)=>a.start-b.start||a.end-b.end);app.contexts=reviewContextGroups(app.groups);}
  return [...sections.values()].sort((a,b)=>b.seconds-a.seconds||a.label.localeCompare(b.label)||a.key.localeCompare(b.key));
}

export function reviewSelection(groups:AppReviewGroup[],selectedIds:Readonly<Record<string,boolean>>){
  const selected=groups.filter(group=>!group.reviewSegment&&selectedIds[reviewGroupId(group)]);
  const pairs=[...new Map(selected.flatMap(group=>group.pairs).map(pair=>[JSON.stringify(pair),pair])).values()];
  return {groups:selected,pairs,seconds:selected.reduce((n,g)=>n+g.seconds,0),hasDecisions:selected.some(g=>Boolean(g.userAttribution)),overLimit:pairs.length>10000};
}

export interface ReviewTimelineBar {
  key:string;
  groupId:string;
  appKey:string;
  appName:string;
  projectPath?:string;
  start:number;
  end:number;
}
export function reviewTimelineRange(date:string,intervals:Interval[],now:number):TimeRange{
  const day=new Date(`${date}T00:00:00`),start=day.getTime()/1000;day.setDate(day.getDate()+1);const end=day.getTime()/1000;
  let first=Infinity,last=-Infinity;
  for(const item of intervals)if(item.state==='human'&&item.end>start&&item.start<end){first=Math.min(first,Math.max(start,item.start));last=Math.max(last,Math.min(end,item.end));}
  const cursor=Math.max(start,Math.min(end,now));
  const range=Number.isFinite(first)?{start:first-60,end:last+60}:{start:cursor-1800,end:cursor+60};
  return clampTimeRange(range,start,end,1800);
}
/** Draw actual source spans, never a group's envelope across missing evidence. */
export function reviewTimelineBars(intervals:Interval[],groups:AppReviewGroup[],range:TimeRange):ReviewTimelineBar[]{
  const byPair=new Map<string,AppReviewGroup>();
  for(const group of groups)for(const pair of group.pairs)byPair.set(pairKey(pair,group.reviewSegment),group);
  const bars:ReviewTimelineBar[]=[];
  for(const interval of intervals.filter(i=>i.state==='human'&&i.sourceEventIds.length===2).sort((a,b)=>a.start-b.start||a.end-b.end)){
    const group=byPair.get(pairKey(interval.sourceEventIds,interval.reviewSegment));
    if(!group)continue;
    const start=Math.max(range.start,interval.start),end=Math.min(range.end,interval.end);
    if(!(end>start))continue;
    const groupId=reviewGroupId(group),last=bars.at(-1);
    if(last&&last.groupId===groupId&&last.end===start){last.end=end;continue;}
    bars.push({key:`${groupId}:${start}`,groupId,appKey:group.appKey,appName:group.appName,projectPath:group.projectPath,start,end});
  }
  return bars;
}

/** Editing/picker keys and native button activation belong to their controls. */
export function reviewShortcutAllowed(key:string,target:{inReview:boolean;editing:boolean;picker:boolean;nativeControl:boolean}):boolean{
  return target.inReview&&!target.editing&&!target.picker&&!(target.nativeControl&&(key===' '||key==='Enter'));
}

export type ReviewViewMode='queue'|'reviewed'|'all';
export function reviewIsAssigned(group:HumanReviewGroup):boolean{
  return Boolean(group.projectPath)&&group.userAttribution!=='unassigned'&&humanReviewState(group)!=='conflict';
}
/** Automatic project evidence is already applied; it is never a pending confirmation. */
export function reviewViewGroups(groups:AppReviewGroup[],mode:ReviewViewMode):AppReviewGroup[]{
  if(mode==='queue')return groups.filter(group=>['unmatched','conflict'].includes(humanReviewState(group)));
  if(mode==='reviewed')return groups.filter(reviewIsAssigned);
  return [...groups];
}
export function initialReviewState(saved:unknown):{viewMode:ReviewViewMode;filterText:string;focused:string}{
  const defaults={viewMode:'queue' as ReviewViewMode,filterText:'',focused:''};
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return defaults;
  const state=saved as Record<string,unknown>;
  if(state.version!==2)return defaults;
  return {
    viewMode:['queue','reviewed','all'].includes(String(state.viewMode))?state.viewMode as ReviewViewMode:'queue',
    filterText:typeof state.filterText==='string'?state.filterText:'',
    focused:typeof state.focused==='string'?state.focused:'',
  };
}
export function reviewAssignmentLabel(group:HumanReviewGroup):string{
  if(group.userAttribution==='unassigned')return 'Left unassigned';
  if(humanReviewState(group)==='conflict')return 'Conflicting matches';
  if(reviewIsAssigned(group)){
    const name=group.projectPath!.split('/').filter(Boolean).at(-1)||group.projectPath;
    return `${group.userAttribution==='assigned'?'Assigned':'Automatically assigned'} · ${name}`;
  }
  return 'Needs a project';
}
export function reviewCanAssign(group:HumanReviewGroup,path:string):boolean{
  return Boolean(path)&&(!reviewIsAssigned(group)||path!==group.projectPath);
}
