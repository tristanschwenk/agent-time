import type{IngestionProgress}from'../capture/ingestion-maintenance.ts';
export interface HistoryPreparationView{label:string;detail:string;count:string;busy:boolean;tone:'working'|'ready'|'attention';completed?:number;total?:number;current?:string;}
/** Daily-period counts are reported by the worker. Rowids can be sparse and
 * must never be presented as a percentage of captured events. */
export function historyPreparationView(status:IngestionProgress|null|undefined):HistoryPreparationView|null{
 if(!status||status.history?.projects===0)return null;
 const fallback='Reports can still run: available prepared periods are reused, and the rest use the original calculation.';
 if(status.phase==='failed')return{label:'History preparation needs attention',detail:'Preparation could not finish and will retry automatically. '+fallback,count:'',busy:false,tone:'attention'};
 if(status.phase==='paused')return{label:'History preparation paused',detail:'Preparation is waiting for storage capacity and will retry automatically. '+fallback,count:'',busy:false,tone:'attention'};
 if(status.phase==='indexing')return{label:'Reading report history',detail:'Step 1 of 2 · Reading saved activity before preparing daily periods. '+fallback,count:'',busy:true,tone:'working'};
 const history=status.history;
 if(!history)return{label:'Checking history preparation',detail:'Waiting for preparation details. '+fallback,count:'',busy:true,tone:'working'};
 if(!history.total)return{label:'No history to prepare yet',detail:'Daily periods will be prepared as activity is captured for your billing projects.',count:'',busy:false,tone:'ready'};
 const completed=Math.max(0,Math.min(history.total,history.prepared)),count=`${completed.toLocaleString()} / ${history.total.toLocaleString()} daily periods`;
 if(history.pending===0)return{label:'Report history ready',detail:'Reports can use prepared historical periods. Recent or changed activity may still need calculation.',count,busy:false,tone:'ready'};
 return{label:'Preparing report history',detail:'Step 2 of 2 · Preparing daily periods in the background. '+fallback,count,busy:true,tone:'working',completed,total:history.total,current:[status.projectName,status.date].filter(Boolean).join(' · ')};
}
