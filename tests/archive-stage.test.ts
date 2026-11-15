import test from 'node:test';import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,statSync,lstatSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {gzipSync} from 'node:zlib';
import {EventStore} from '../src/capture/store.ts';
import {stageArchiveCopy} from '../src/capture/archive-stage.ts';import {cleanupArchiveStaging} from '../src/capture/archive-storage.ts';
const helper=fileURLToPath(new URL('../src/capture/archive-stage.ts',import.meta.url));
function fixture(source:string,big=false){const db=new EventStore(source);db.put({eventId:'proof',source:'capture',kind:'capture_start',observedAt:1,monotonicAt:1,collectorEpoch:'e'});if(big)db.database.exec('CREATE TABLE fixture(data BLOB);INSERT INTO fixture VALUES(zeroblob(67108864))');db.close();}
function childStage(source:string,root:string){const child=spawn(process.execPath,[helper,source,root],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);const done=new Promise<{code:number|null,signal:string|null,stdout:string,stderr:string}>(resolve=>child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr})));return {child,done};}
async function partialStage(root:string){const deadline=Date.now()+5000;while(Date.now()<deadline){const folder=join(root,'exports');if(existsSync(folder))for(const name of readdirSync(folder)){if(!name.startsWith('.archive-write-'))continue;const path=join(folder,name,'archive.tmp');try{if(statSync(path).size>0)return path;}catch{}}await new Promise(resolve=>setTimeout(resolve,1));}throw new Error('No partial owned stage appeared');}
test('native helper stages exact plain/gzip bytes privately and preserves source',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-picker-'));try{const source=join(root,'original.sqlite');fixture(source);const before=readFileSync(source),id=stageArchiveCopy(source,root);assert.deepEqual(readFileSync(join(root,'exports',id)),before);assert.deepEqual(readFileSync(source),before);assert.equal(lstatSync(join(root,'exports',id)).mode&0o777,0o600);
 const gzip=join(root,'original.sqlite.gz');writeFileSync(gzip,gzipSync(before));const compressed=stageArchiveCopy(gzip,root);assert.ok(compressed.endsWith('.sqlite.gz'));assert.deepEqual(readFileSync(join(root,'exports',compressed)),readFileSync(gzip));assert.equal(readdirSync(join(root,'exports')).some(n=>n.startsWith('.archive-write-')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('native helper refuses invalid/symlink inputs and symlink exports',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-picker-invalid-'));try{const source=join(root,'original.sqlite');writeFileSync(source,'SQLite format 3\0example');assert.throws(()=>stageArchiveCopy(source,root),/database|malformed/);rmSync(source);fixture(source);symlinkSync(source,join(root,'link.sqlite'));assert.throws(()=>stageArchiveCopy(join(root,'link.sqlite'),root),/regular/);mkdirSync(join(root,'elsewhere'));symlinkSync(join(root,'elsewhere'),join(root,'exports'));assert.throws(()=>stageArchiveCopy(source,root),/symlink/);assert.deepEqual(readdirSync(join(root,'elsewhere')),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('native helper excludes concurrent SQLite writers throughout copying',async()=>{
 const root=mkdtempSync(join(tmpdir(),'at-picker-writer-')),source=join(root,'original.sqlite');let processState:ReturnType<typeof childStage>|undefined;
 try{fixture(source,true);const before=readFileSync(source);processState=childStage(source,root);const liveStage=await partialStage(root);processState.child.kill('SIGSTOP');cleanupArchiveStaging(root);assert.equal(existsSync(liveStage),true);
 const writer=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);try{db.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');console.log('entered');}catch{console.log('blocked');}finally{db.close();}`,source]);assert.equal(String(writer.stdout).trim(),'blocked');processState.child.kill('SIGCONT');const result=await processState.done;assert.equal(result.code,0,result.stderr);const {id}=JSON.parse(result.stdout);assert.deepEqual(readFileSync(join(root,'exports',id)),before);assert.deepEqual(readFileSync(source),before);
 }finally{if(processState){processState.child.kill('SIGKILL');await processState.done;}rmSync(root,{recursive:true,force:true});}
});
test('killed native helper leaves dead-owner partial output recoverable without touching source or manual archives',async()=>{
 const root=mkdtempSync(join(tmpdir(),'at-picker-kill-')),source=join(root,'original.sqlite');let processState:ReturnType<typeof childStage>|undefined;
 try{fixture(source,true);const before=readFileSync(source);mkdirSync(join(root,'exports'));const manual=join(root,'exports','manual.sqlite');writeFileSync(manual,'preserve');processState=childStage(source,root);const stage=await partialStage(root);processState.child.kill('SIGKILL');const result=await processState.done;assert.equal(result.signal,'SIGKILL');assert.ok(existsSync(stage));cleanupArchiveStaging(root);assert.equal(existsSync(stage),false);assert.deepEqual(readdirSync(join(root,'exports')),['manual.sqlite']);assert.equal(readFileSync(manual,'utf8'),'preserve');assert.deepEqual(readFileSync(source),before);
 }finally{if(processState){processState.child.kill('SIGKILL');await processState.done;}rmSync(root,{recursive:true,force:true});}
});
