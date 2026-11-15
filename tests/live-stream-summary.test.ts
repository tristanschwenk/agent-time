import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../src/capture/correlate.ts';
import {createLiveSummary,appendLiveSummary} from '../src/capture/incremental-summary.ts';
import type {CaptureEvent} from '../src/capture/events.ts';
const options={idleThreshold:300,agentIdleThreshold:300};
const sample=(at:number):CaptureEvent=>({eventId:`e${at}`,source:'macos',kind:'activity',observedAt:at,monotonicAt:at,collectorEpoch:'epoch',data:{idleSeconds:0,foregroundBundleId:'editor'}});
const hook=(at:number,kind:string,hostId='one',provider='claude',agentId?:string):CaptureEvent=>({...sample(at),source:'hook',kind,hostId,provider,agentId,sessionId:'same',data:{toolId:'tool'}});
test('ordered hooks reuse settled human stream and preserve complete replay at every open end',()=>{
 const events:CaptureEvent[]=[sample(1),sample(3)];
 let raw=summarize(events,options),state=createLiveSummary(events,raw,options);assert.ok(state);
 const additions=[hook(4,'prompt_submitted'),sample(5),hook(6,'tool_start'),hook(7,'child_start','one','claude','child'),sample(8),hook(9,'tool_start','two'),hook(10,'tool_start','one','codex'),sample(11),hook(12,'tool_end'),hook(13,'response_stop'),sample(14),hook(15,'child_stop','one','claude','child'),hook(16,'tool_end','two'),hook(17,'tool_end','one','codex'),{...sample(18),collectorEpoch:'epoch2',monotonicAt:1}, {...sample(19),collectorEpoch:'epoch2',monotonicAt:2}];
 for(const next of additions){events.push(next);const result=appendLiveSummary(state,[next],options);assert.ok(result);raw=result.summary;state=result.state;assert.deepEqual(raw,summarize(events,options));}
 assert.equal(state.evidence.length,additions.filter(e=>e.source==='hook').length);
 assert.equal(state.lastActivity?.eventId,'e19');
});
test('unsafe order, capture fences, worker lookahead and retention overflow decline reuse',()=>{
 const events=[sample(1),sample(3)],raw=summarize(events,options),state=createLiveSummary(events,raw,options);assert.ok(state);
 for(const next of [sample(2),sample(3),{...sample(4),monotonicAt:0},{...sample(4),kind:'capture_stop',source:'capture'},{...sample(4),kind:'worker',source:'orca'}])assert.equal(appendLiveSummary(state,[next],options),null);
 assert.equal(createLiveSummary(events,raw,options,1),null);
 assert.equal(appendLiveSummary(state,[{...hook(4,'tool_start'),data:{padding:'x'.repeat(3*1024*1024)}}],options),null);
 assert.equal(createLiveSummary([sample(2),{...sample(1),monotonicAt:3}],raw,options),null);
});

test('interleaved batches retain metadata, issue order, background shells and terminal names',async()=>{
 const {EventStore}=await import('../src/capture/store.ts');
 const {DaySummaries,applyTerminalTitles}=await import('../src/capture/day-summaries.ts');
 const store=new EventStore(':memory:');
 try{
  const events:CaptureEvent[]=[];
  for(let at=1;at<1000;at+=5)events.push(sample(at));
  for(const event of events)store.put(event);
  const days=new DaySummaries(store,()=>options),date='1970-01-01';days.window(date);
  const read=store.windowEvents.bind(store);let reads=0;store.windowEvents=(...args)=>{reads++;return read(...args);};
  const batches:CaptureEvent[][]=[
   [{...hook(1002,'tool_start'),terminalHandle:'term',data:{toolId:'tool',attributes:{category:'coding'}}},sample(1003)],
   [{...hook(1004,'tool_end'),terminalHandle:'term',data:{toolId:'tool',backgroundTaskId:'bg'}},sample(1005)],
   [{...hook(1006,'response_stop'),terminalHandle:'term',data:{backgroundTasks:['bg']}},hook(1007,'child_stop','two','codex','orphan'),sample(1008)],
   [{...sample(1009),source:'orca',kind:'terminal',terminalHandle:'term',data:{title:'Named terminal'},cwd:'/project'},sample(1010)],
   [{...hook(1011,'prompt_submitted'),terminalHandle:'term',dispatchId:'dispatch',runId:'run'},sample(1012)],
   [{...hook(1013,'tool_start'),terminalHandle:'term',dispatchId:'dispatch'},hook(1014,'tool_end','different-host'),sample(1015)],
  ];
  for(const batch of batches){for(const event of batch){events.push(event);store.put(event);}const expected=summarize(events,options);applyTerminalTitles(expected,events);assert.deepEqual(days.window(date).raw,expected);}
  assert.equal(reads,0,'ordered agent updates must avoid another window read');assert.equal(days.computations,1);
  // Unsupported boundary and a late correction use the full reducer again.
  for(const next of [{...sample(1016),kind:'capture_stop',source:'capture'},hook(500,'tool_start')]){
   events.push(next);store.put(next);const expected=summarize(events,options);applyTerminalTitles(expected,events);assert.deepEqual(days.window(date).raw,expected);
  }
  assert.equal(reads,2);
 }finally{store.close();}
});

test('settings changes, bounded evidence admission and original terminal insertion order',()=>{
 const first=sample(1),last=sample(3),events=[first,last],state=createLiveSummary(events,summarize(events,options),options);assert.ok(state);
 assert.equal(appendLiveSummary(state,[sample(4)],{...options,agentIdleThreshold:10}),null);
 const many=Array.from({length:4097},(_,i)=>hook(i+4,'session_start'));
 assert.equal(appendLiveSummary(state,many,options),null);
 const terminals=[{...sample(10),source:'orca',kind:'terminal',terminalHandle:'terminal',data:{title:'first inserted'}},{...sample(5),source:'orca',kind:'terminal',terminalHandle:'terminal',data:{title:'last inserted'}}];
 const seeded=createLiveSummary([...events,...terminals],summarize([...events,...terminals],options),options);assert.ok(seeded);
 assert.deepEqual(seeded.evidence,terminals);
});

test('existing capture fences and worker history admit safe hook reuse with the exact human anchor reset',()=>{
 for(const fence of [
  {...sample(4),source:'capture',kind:'capture_start'},
  {...sample(4),source:'macos',kind:'sleep'},
  {...sample(4),source:'capture',kind:'capture_settings',data:{previous:{macosActivity:true},surfaces:{macosActivity:false}}},
  {...sample(4),source:'capture',kind:'capture_settings',data:{surfaces:{macosActivity:false}}},
  {...sample(4),source:'capture',kind:'capture_settings',data:{previous:{macosActivity:true},surfaces:{macosActivity:true}}},
 ]){
  const worker={...sample(5),source:'orca',kind:'worker',hostId:'one',provider:'claude',dispatchId:'dispatch',terminalHandle:'terminal',data:{state:'working',fresh:true}};
  const events:CaptureEvent[]=[sample(1),sample(3),fence,worker],state=createLiveSummary(events,summarize(events,options),options);assert.ok(state,'normal startup history must not permanently disable the stream cache');
  const fresh=[{...hook(6,'tool_start'),terminalHandle:'terminal'},sample(7),{...hook(8,'tool_end'),terminalHandle:'terminal'}];
  const next=appendLiveSummary(state,fresh,options);assert.ok(next);assert.deepEqual(next.summary,summarize([...events,...fresh],options));
  assert.equal(appendLiveSummary(next.state,[{...worker,eventId:'worker-new',observedAt:9,monotonicAt:9}],options),null,'new worker binding evidence still uses full replay');
 }
});
