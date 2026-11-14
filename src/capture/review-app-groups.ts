import type {Interval} from './events.ts';
import {groupHumanReview,humanReviewState,type HumanReviewGroup} from './human-review.ts';
import brave from './sources/brave.browser.ts';
import chrome from './sources/chrome.browser.ts';
import safari from './sources/safari.browser.ts';

export interface AppReviewGroup extends HumanReviewGroup {
  appKey:string;
  appName:string;
  bundleId?:string;
  hostId?:string;
}
export interface ReviewContextGroup {
  key:string;
  label:string;
  groups:AppReviewGroup[];
  seconds:number;
}
export interface ReviewAppSection {
  key:string;
  label:string;
  bundleId?:string;
  hostId?:string;
  groups:AppReviewGroup[];
  contexts:ReviewContextGroup[];
  seconds:number;
}
export const reviewGroupId=(group:HumanReviewGroup)=>`${group.start}:${group.key}`;
function application(interval:Interval){
  const bundleId=interval.foregroundBundleId||interval.browserBundleId;
  const appName=interval.foregroundName||bundleId||'Unknown app';
  return {appKey:JSON.stringify([interval.hostId||'',bundleId?'bundle:'+bundleId:'name:'+appName]),appName,bundleId,hostId:interval.hostId};
}

/** View grouping only. Keep every source pair and preserve interruptions, even
 * when the same page/app returns within the old review grouping's 60 s margin. */
export function buildAppReviewGroups(intervals:Interval[]):AppReviewGroup[]{
  const result:AppReviewGroup[]=[];
  let run:Interval[]=[],app:ReturnType<typeof application>|undefined;
  const flush=()=>{
    if(!app||!run.length)return;
    for(const group of groupHumanReview(run))result.push({...group,...app,key:JSON.stringify([app.appKey,group.key])});
    run=[];
  };
  for(const interval of intervals.filter(i=>i.state==='human'&&i.sourceEventIds.length===2&&Number.isFinite(i.start)&&Number.isFinite(i.end)&&i.end>i.start).sort((a,b)=>a.start-b.start||a.end-b.end)){
    const next=application(interval),last=run.at(-1);
    if(app&&(next.appKey!==app.appKey||last&&interval.start>last.end))flush();
    app=next;run.push(interval);
  }
  flush();return result;
}

const browserBundles=new Set([brave.bundleId,chrome.bundleId,safari.bundleId]);
const cleanTitle=(value:string)=>[...new Map(value.split('·').map(part=>part.trim()).filter(Boolean).map(part=>[part.toLocaleLowerCase(),part])).values()].join(' · ');
export function reviewContextTitle(group:AppReviewGroup):string{
  const label=cleanTitle(group.label),app=cleanTitle(group.appName);
  let site=group.browserDomain||'';
  if(!site){try{site=new URL(group.browserUrl||group.browserOrigin||'').hostname;}catch{/* No known website. */}}
  if(label&&label!=='Unknown app'&&label!==app)return label;
  if(site)return label&&label!=='Unknown app'&&!browserBundles.has(group.bundleId||'')?label:site;
  return 'General activity';
}
export function reviewVisitTitle(group:AppReviewGroup):string{
  const title=reviewContextTitle(group);return title==='General activity'?'Visit':title;
}

/** Summaries may cover separate visits. Keep their actual spans only in groups. */
export function reviewContextGroups(groups:AppReviewGroup[]):ReviewContextGroup[]{
  const contexts=new Map<string,ReviewContextGroup>();
  for(const group of groups){
    const key=`context:${group.key}`;
    let context=contexts.get(key);
    if(!context){
      context={key,label:reviewContextTitle(group),groups:[],seconds:0};
      contexts.set(key,context);
    }
    context.groups.push(group);context.seconds+=group.seconds;
  }
  for(const context of contexts.values())context.groups.sort((a,b)=>a.start-b.start||a.end-b.end);
  return [...contexts.values()].sort((a,b)=>b.seconds-a.seconds||a.groups[0]!.start-b.groups[0]!.start||a.key.localeCompare(b.key));
}
