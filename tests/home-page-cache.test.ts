import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import ts from'typescript';import{ref,markRaw}from'vue';import type{Summary}from'../src/capture/events.ts';
const value={intervals:[],sessions:[],unresolved:[],coverage:[],humanSeconds:123,agentSeconds:0,childAgentSeconds:0,elapsedSeconds:123}as Summary;

test('page snapshots are compressed, bounded and isolated; clearing also discards an in-flight write',async()=>{
 const{SummaryPageCache}=await import('../src/ui/summary-page-cache.ts');const cache=new SummaryPageCache(4000,2);
 await cache.put('a','a',value);assert.deepEqual(await cache.get('a'),{token:'a',value});
 (await cache.get('a'))!.value.humanSeconds=999;assert.equal((await cache.get('a'))!.value.humanSeconds,123);
 await cache.put('b','b',value);await cache.put('c','c',value);assert.equal(cache.get('a'),undefined);assert(cache.retainedBytes<=4000);
 const pending=cache.put('d','d',value);cache.clear();await pending;assert.equal(cache.get('d'),undefined);
});

test('missing browser compression disables only the optional cache',async()=>{
 const{SummaryPageCache}=await import('../src/ui/summary-page-cache.ts'),original=globalThis.CompressionStream;
 try{(globalThis as any).CompressionStream=undefined;const cache=new SummaryPageCache();await cache.put('a','token',value);assert.equal(cache.get('a'),undefined);}finally{globalThis.CompressionStream=original;}
});

function loader(cache:any,read:(date:string,background:boolean,since?:string)=>Promise<unknown>){
 const source=readFileSync(new URL('../src/ui/store.ts',import.meta.url),'utf8').match(/  async function loadSummary\(\) \{[\s\S]*?\n  \}\n\n  async function loadStatus/)![0].replace(/\n\n  async function loadStatus$/,'');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const selectedDate=ref('2026-10-20'),summary=ref<Summary|null>(null),loaded=ref(false),reports=ref([]),error=ref('');
 const make=new Function('selectedDate','summary','summaryLoaded','reportedWork','pollError','summaryPagesCache','transport','reportedWorkTransport','markRaw',`
 let summaryRevision=0,summaryKey='',summaryToken,summaryFetchedAt=0,reportedWorkInflight;const native=false,windowFocused={value:true};
 const isRetryableError=()=>false,humanizeError=String;
 function storeSummary(value,date){summary.value=value;summaryLoaded.value=true;summaryKey=date+'|fixture';summaryFetchedAt=Date.now();summaryToken=undefined;}
 ${code}
 return {loadSummary,change(date){selectedDate.value=date;summaryRevision++;summaryKey='';summaryToken=undefined;summary.value=null;summaryLoaded.value=false;}};`);
 return{...make(selectedDate,summary,loaded,reports,error,cache,{summarySince:read},{list:async()=>[]},markRaw),summary,loaded};
}

test('a revisited page validates its cached token before showing exactly that day',async()=>{
 const{SummaryPageCache}=await import('../src/ui/summary-page-cache.ts'),cache=new SummaryPageCache();await cache.put('2026-10-20','saved',value);
 let finish!:(v:any)=>void;const calls:any[]=[];const state=loader(cache,async(...args)=>{calls.push(args);return new Promise(resolve=>finish=resolve);});const pending=state.loadSummary();
 while(!calls.length)await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls[0][2],'saved');assert.equal(state.loaded.value,false);
 finish({unchanged:true,token:'saved'});await pending;assert.deepEqual(state.summary.value,value);assert.equal(state.loaded.value,true);
});

test('an invalid token uses fresh data; a late response never restores the previous day',async()=>{
 const{SummaryPageCache}=await import('../src/ui/summary-page-cache.ts'),cache=new SummaryPageCache();await cache.put('2026-10-20','old',value);
 const pending=new Map<string,(v:any)=>void>(),state=loader(cache,async date=>new Promise(resolve=>pending.set(date,resolve)));
 const old=state.loadSummary();while(!pending.has('2026-10-20'))await new Promise(resolve=>setTimeout(resolve,0));state.change('2026-10-21');const fresh=state.loadSummary();
 pending.get('2026-10-21')!({...value,humanSeconds:456,token:'fresh'});await fresh;
 pending.get('2026-10-20')!({unchanged:true,token:'old'});await old;assert.equal(state.summary.value?.humanSeconds,456);
});
