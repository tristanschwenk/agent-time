import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {summarize} from '../../src/capture/correlate.ts';
import {createLiveSummary,appendLiveSummary} from '../../src/capture/incremental-summary.ts';
import type {CaptureEvent} from '../../src/capture/events.ts';
const options={idleThreshold:300,agentIdleThreshold:300};
const sample=(at:number):CaptureEvent=>({eventId:`e${at}`,observedAt:at,monotonicAt:at,collectorEpoch:'epoch',kind:'activity',source:'macos',data:{idleSeconds:0,foregroundBundleId:'editor'}});
const events=Array.from({length:12000},(_,i)=>sample(i*5+1));
for(let i=0;i<100;i++){events.push({...sample(i*500+2),source:'hook',kind:'tool_start',hostId:'host',provider:'codex',sessionId:`s${i}`});events.push({...sample(i*500+4),source:'hook',kind:'tool_end',hostId:'host',provider:'codex',sessionId:`s${i}`});}
const raw=summarize(events,options),state=createLiveSummary(events,raw,options)!;
const next={...sample(60002),source:'hook',kind:'tool_start',hostId:'host',provider:'codex',sessionId:'new'};
const expected=summarize([...events,next],options);assert.deepEqual(appendLiveSummary(state,[next],options)!.summary,expected);
const measure=(fn:()=>unknown)=>{const runs=[];for(let i=0;i<15;i++){const start=performance.now();fn();runs.push(performance.now()-start);}return runs.sort((a,b)=>a-b)[7];};
console.log(JSON.stringify({samples:12000,agentEvidence:200,medianMs:{full:measure(()=>summarize([...events,next],options)),stream:measure(()=>appendLiveSummary(state,[next],options))},retainedSourceEvents:state.evidence.length+1},null,2));
