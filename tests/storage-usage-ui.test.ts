import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {compileScript,parse} from '@vue/compiler-sfc';
import {createRenderer,h,nextTick} from 'vue';
import ts from 'typescript';
import type {StorageUsage} from '../src/capture/storage-usage.ts';
type Node={text:string;children:Node[];parent:Node|null};
const node=():Node=>({text:'',children:[],parent:null});
const renderer=createRenderer<Node,Node>({createElement:node,createText:text=>({...node(),text}),createComment:node,setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;},parentNode:n=>n.parent,nextSibling:()=>null,insert(n,p){n.parent=p;p.children.push(n);},remove(n){if(n.parent)n.parent.children=n.parent.children.filter(c=>c!==n);},patchProp(){}});
const require=createRequire(import.meta.url);
async function render(usage:StorageUsage){
 const source=readFileSync(new URL('../src/ui/StorageUsage.vue',import.meta.url),'utf8');
 const compiled=compileScript(parse(source).descriptor,{id:'storage-ui',inlineTemplate:true});
 const code=ts.transpileModule(compiled.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:Record<string,any>={};
 new Function('require','exports',code)((path:string)=>{
  if(path.endsWith('.vue'))return {default:{setup:(_p:unknown,{slots}:any)=>()=>h('div',slots.default?.())}};
  if(path==='./transport.ts')return {storageTransport:{usage:async()=>usage},storageRecoveryTransport:{pending:async()=>null,result:async()=>null}};
  return require(path.startsWith('.')?fileURLToPath(new URL('../src/ui/'+path,import.meta.url)):path);
 },exports);
 const root=node(),app=renderer.createApp({render:()=>h(exports.default,{running:false})});app.mount(root);
 await Promise.resolve();await Promise.resolve();await nextTick();
 const text=(n:Node):string=>n.text+' '+n.children.map(text).join(' ');const result=text(root);app.unmount();return result;
}
const GiB=1024**3,empty=()=>({bytes:0,files:0,truncated:false});
function fixture():StorageUsage{return {database:empty(),wal:empty(),sharedMemory:empty(),indexes:empty(),spool:empty(),runtimes:empty(),exports:empty(),totalBytes:100,eventCount:0,freeBytes:2*GiB,byDay:[],storageLimitMB:5120,care:{at:null,error:null,paused:true}};}
test('storage pause explains real low disk before quota and retains automatic recovery status',async()=>{
 const usage=fixture();usage.freeBytes=GiB/2;usage.care={...usage.care!,pressure:{id:'p',reason:'disk-space',phase:'blocked',autoResume:true,at:1,freeBytes:GiB/2,savedBytes:0}};
 const before=structuredClone(usage),text=await render(usage);assert.match(text,/less than 1 GB|out of space/);assert.match(text,/restarts automatically/);assert.doesNotMatch(text,/Raise the limit/);assert.deepEqual(usage,before);
});
test('current disk shortage overrides stale ready recovery and manual pause stays manual',async()=>{
 const usage=fixture();usage.freeBytes=GiB/2;usage.care!.pressure={id:'p',reason:'disk-space',phase:'ready',autoResume:false,at:1,freeBytes:2*GiB,savedBytes:0};
 const text=await render(usage);assert.match(text,/keep 1 GB free/);assert.match(text,/Resume capture when you are ready/);assert.doesNotMatch(text,/enough space is available|restarts automatically|Raise the limit/);
});
test('storage quota pause still offers the budget remedy at the exact limit',async()=>{
 const usage=fixture();usage.totalBytes=5*GiB;const text=await render(usage);assert.match(text,/paused to stay within your limit/);assert.match(text,/Raise the limit/);
});
test('incomplete and unknown storage measurements do not suggest raising the budget',async()=>{
 for(const unknown of [false,true]){const usage=fixture();if(unknown)usage.freeBytes=null;else usage.spool.truncated=true;const text=await render(usage);assert.match(text,/measur|capacity.*check/i);assert.doesNotMatch(text,/Raise the limit|paused to stay within your limit/);}
});
test('storage exports category includes saved billing exports',async()=>{
 const usage=fixture();usage.care!.paused=false;usage.exports.bytes=100;const text=await render(usage);assert.match(text,/Backups and exports/);assert.match(text,/billing reports/i);
});
