import {validBillingProgressId} from './billing-progress.ts';
export interface PeriodReportProgress {phase:'reading'|'complete'|'failed';completedDays:number;totalDays:number;date?:string;}
/** Progress retains only small counters, never observations or completed reports. */
export class PeriodProgress {
 private jobs=new Map<string,{value:PeriodReportProgress;updatedAt:number}>();
 begin(id:string,totalDays:number,date:string){
  if(!validBillingProgressId(id))throw new Error('Invalid report progress ID');
  for(const [key,job] of this.jobs)if(job.value.phase!=='reading'&&Date.now()-job.updatedAt>600000)this.jobs.delete(key);
  if(this.jobs.has(id))throw new Error('Report progress ID already used');
  if(this.jobs.size>=8){const terminal=[...this.jobs].find(([,job])=>job.value.phase!=='reading');if(terminal)this.jobs.delete(terminal[0]);else throw new Error('Too many reports in progress');}
  this.set(id,{phase:'reading',completedDays:0,totalDays,date});
 }
 set(id:string,value:PeriodReportProgress){this.jobs.set(id,{value:{...value},updatedAt:Date.now()});}
 get(id:string){const job=this.jobs.get(id);if(!job)return null;if(job.value.phase!=='reading'&&Date.now()-job.updatedAt>600000){this.jobs.delete(id);return null;}return {...job.value};}
}
