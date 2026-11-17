<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,nextTick,ref} from 'vue';
import AppButton from './AppButton.vue';
import AgentExecutionDetails from './AgentExecutionDetails.vue';
import BillingReportExplanation from './BillingReportExplanation.vue';
import {usePagePresentation} from './page-presentation.ts';
import {activityDetailSpans,trimCuts,timeInputValue,timeInputSeconds,type ActivityDetailTarget} from './activity-detail-target.ts';
import {reviewGroupId,reviewVisitTitle,reviewAssignmentLabel} from './review-apps.ts';
import {duration,preciseClock} from './format.ts';
import {useStore} from './store.ts';
const props=withDefaults(defineProps<{target:ActivityDetailTarget;focusOnOpen?:boolean;invoker?:HTMLElement|null}>(),{focusOnOpen:true});
const emit=defineEmits<{close:[];review:[date:string,ids:string[]]}>();
const active=usePagePresentation(),root=ref<HTMLElement|null>(null);
let returnFocus:HTMLElement|null=null;
onMounted(()=>{void store?.loadAgentCorrections();returnFocus=props.invoker||(document.activeElement instanceof HTMLElement?document.activeElement:null);if(props.focusOnOpen!==false)void nextTick(()=>requestAnimationFrame(()=>{if(active.value)root.value?.focus();}));});
onBeforeUnmount(()=>{if(props.focusOnOpen!==false)void nextTick(()=>{if(active.value&&returnFocus?.isConnected)returnFocus.focus();});});
const title=computed(()=>props.target.kind==='human'?(props.target.groups.length===1?reviewVisitTitle(props.target.groups[0]!):`${props.target.groups.length} activity visits`):props.target.kind==='agent'?'Agent execution':'Saved billing report');
const spans=computed(()=>activityDetailSpans(props.target));
const store=props.target.kind==='agent'?useStore():null;
const executionKey=computed(()=>props.target.kind==='agent'?props.target.execution.key:'');
const activeCorrections=computed(()=>(store?.agentCorrections.value||[]).filter(item=>!item.undoneAt&&item.executionKey===executionKey.value));
const removedSeconds=computed(()=>activeCorrections.value.reduce((sum,item)=>sum+Math.max(0,item.end-item.start),0));
const editing=ref(-1),removing=ref(-1),editStart=ref(''),editEnd=ref(''),error=ref(''),busy=ref(false);
type Span={start:number;end:number};
function startEdit(span:Span,index:number){removing.value=-1;error.value='';editing.value=index;editStart.value=timeInputValue(span.start);editEnd.value=timeInputValue(span.end);}
function askRemove(index:number){editing.value=-1;error.value='';removing.value=index;}
async function change(work:()=>Promise<void>){if(busy.value)return false;busy.value=true;error.value='';try{await work();return true;}catch(caught){error.value=caught instanceof Error?caught.message:String(caught);return false;}finally{busy.value=false;}}
async function removeSpan(span:Span){if(await change(()=>store!.excludeAgentTime(executionKey.value,span.start,span.end)))removing.value=-1;}
async function saveEdit(span:Span){
 const ok=await change(async()=>{
  const date=props.target.kind==='agent'?props.target.date:'',cuts=trimCuts(span,{start:timeInputSeconds(date,editStart.value,span.start),end:timeInputSeconds(date,editEnd.value,span.end)});
  for(const [start,end] of cuts)await store!.excludeAgentTime(executionKey.value,start,end);
 });
 if(ok)editing.value=-1;
}
async function undoCorrection(item:{id:string}){await change(()=>store!.undoAgentTimeCorrection(item.id));}
function close(event?:KeyboardEvent){event?.stopPropagation();event?.preventDefault();emit('close');}
function review(){if(props.target.kind==='human')emit('review',props.target.date,props.target.groups.map(reviewGroupId));}
</script>
<template>
 <section ref="root" class="activity-details-panel" role="region" aria-label="Activity details" tabindex="-1" @keydown.esc="close">
  <header><h3>{{title}}</h3><AppButton compact variant="quiet" @click="close()">Close details</AppButton></header>
  <template v-if="target.kind==='human'">
   <p>{{target.date}} · {{target.groups.length}} visits · {{duration(target.groups.reduce((sum,g)=>sum+g.seconds,0))}} observed human activity</p>
   <ul class="detail-visits"><li v-for="(group,index) in target.groups" :key="index"><strong>{{group.appName}} · {{reviewVisitTitle(group)}}</strong><span>{{preciseClock(group.start)}}–{{preciseClock(group.end)}} · {{duration(group.seconds)}}</span><span>{{reviewAssignmentLabel(group)}}</span><small>{{group.attributionReason || 'No project match recorded.'}}</small></li></ul>
   <p>Only the recorded visits count. Time between visits is not added.</p>
   <slot><AppButton compact @click="review">Open these visits in Review</AppButton></slot>
  </template>
  <template v-else-if="target.kind==='agent'">
   <p>{{target.date}} · Measured execution. Declared task timers remain separate.</p>
   <AgentExecutionDetails :execution="target.execution" />
   <p v-if="activeCorrections.length">Corrected · −{{duration(removedSeconds)}}</p>
   <details><summary>{{spans.length}} recorded activity intervals</summary>
    <ul class="detail-visits"><li v-for="(span,index) in spans" :key="index">
     <div class="interval-row"><span>{{preciseClock(span.start)}}–{{preciseClock(span.end)}}</span><span class="interval-actions"><AppButton compact variant="quiet" :disabled="busy" @click="startEdit(span,index)">Edit</AppButton><AppButton compact variant="quiet" :disabled="busy" @click="askRemove(index)">Delete</AppButton></span></div>
     <form v-if="editing===index" class="interval-edit" @submit.prevent="saveEdit(span)">
      <label>From <input v-model="editStart" type="time" step="1" required :min="timeInputValue(span.start)" :max="timeInputValue(span.end)" /></label>
      <label>To <input v-model="editEnd" type="time" step="1" required :min="timeInputValue(span.start)" :max="timeInputValue(span.end)" /></label>
      <AppButton compact variant="primary" type="submit" :disabled="busy">Save</AppButton><AppButton compact @click="editing=-1">Cancel</AppButton>
     </form>
     <div v-if="removing===index" class="interval-edit" role="group" aria-label="Confirm removal"><span>Remove this time?</span><AppButton compact variant="danger" :disabled="busy" @click="removeSpan(span)">Remove</AppButton><AppButton compact :disabled="busy" @click="removing=-1">Keep</AppButton></div>
    </li></ul>
   </details>
   <p v-if="error" class="interval-error" role="alert">{{error}}</p>
   <div v-if="activeCorrections.length"><strong>Corrections</strong><ul class="detail-visits"><li v-for="item in activeCorrections" :key="item.id"><div class="interval-row"><span>Removed {{preciseClock(item.start)}}–{{preciseClock(item.end)}}</span><AppButton compact variant="quiet" :disabled="busy" @click="undoCorrection(item)">Undo</AppButton></div></li></ul></div>
  </template>
  <template v-else>
   <p>{{target.report.projectName}} · {{target.report.fromDate}}–{{target.report.toDate}} · {{target.report.timezone}}</p>
   <p>Saved snapshot · {{new Date(target.report.createdAt).toLocaleString()}}. Its scope and results do not follow the current filters.</p>
   <BillingReportExplanation :report="target.report" />
   <p>Original observations are not embedded in this snapshot. Opening a day in Review shows the currently available evidence; it does not rewrite this report.</p>
  </template>
 </section>
</template>
<style scoped>
.activity-details-panel{margin:18px 0;padding:18px;border:1px solid var(--border);border-radius:var(--radius-card);background:var(--panel);min-width:0;overflow-wrap:anywhere}.activity-details-panel:focus-visible{outline:2px solid var(--accent);outline-offset:2px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h3{margin:0;font-size:var(--text-base)}p,small{font-size:var(--text-sm);color:var(--muted);line-height:1.6}.detail-visits{list-style:none;margin:12px 0;padding:0;max-height:260px;overflow:auto}.detail-visits li{display:grid;gap:4px;padding:10px 0;border-top:1px solid var(--border);font-size:var(--text-sm)}
.interval-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.interval-actions{display:flex;gap:4px}.interval-edit{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.interval-edit label{display:flex;align-items:center;gap:6px}.interval-error{color:var(--danger,#b42318)}
</style>
