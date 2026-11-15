import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventStore} from '../src/capture/store.ts';
import {compressArchive,withReadableArchive} from '../src/capture/archive-storage.ts';
import {prepareRestore,applyPendingReplacement,pendingReplacement} from '../src/capture/storage-migration.ts';
const id='agent-time-2026-11-16T00-00-00-000Z-12345678-1234-1234-1234-123456789abc.sqlite';
function make(path:string,eventId:string){const store=new EventStore(path);store.put({eventId,source:'capture',kind:'capture_start',observedAt:1,monotonicAt:1,collectorEpoch:'e'});store.close();}
function killedWriter(path:string){const script=`import {EventStore} from ${JSON.stringify(new URL('../src/capture/store.ts',import.meta.url).href)};const store=new EventStore(process.argv[1]);store.put({eventId:'wal-only',source:'capture',kind:'capture_start',observedAt:2,monotonicAt:2,collectorEpoch:'e'});process.kill(process.pid,'SIGKILL');`;const result=spawnSync(process.execPath,['--input-type=module','-e',script,path]);assert.equal(result.signal,'SIGKILL',String(result.stderr));assert.ok(readFileSync(path+'-wal').length>0);}
for(const afterPreparation of [false,true])test(`restore refuses committed candidate WAL ${afterPreparation?'after':'before'} preparation`,()=>{
 const root=mkdtempSync(join(tmpdir(),'at-restore-wal-'));mkdirSync(join(root,'exports'));const source=join(root,'events.sqlite'),archive=join(root,'exports',id);
 try{make(source,'active');make(archive,'base');if(afterPreparation)prepareRestore(root,id);killedWriter(archive);
  assert.throws(()=>afterPreparation?applyPendingReplacement(root,()=>{}):prepareRestore(root,id),/closed|write-ahead|WAL/i);
  assert.equal(existsSync(archive),true);assert.ok(readFileSync(archive+'-wal').length>0);
  const active=new EventStore(source);try{assert.deepEqual(active.events().map(e=>e.eventId),['active']);}finally{active.close();}
  if(!afterPreparation)assert.equal(pendingReplacement(root),null);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('compression excludes a concurrent SQLite writer until publication and preserves exact bytes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'at-compress-lock-')),path=join(root,'archive.sqlite');
 try{make(path,'base');const before=readFileSync(path),running=compressArchive(path);
  const writer=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);try{db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');console.log('writer-entered');}catch{console.log('writer-blocked');}finally{db.close();}`,path]);
  const result=await running;assert.equal(String(writer.stdout).trim(),'writer-blocked');assert.deepEqual(await withReadableArchive(result.path,p=>readFileSync(p)),before);assert.equal(existsSync(path),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('compression refuses a preexisting WAL writer without changing its committed evidence',async()=>{
 const root=mkdtempSync(join(tmpdir(),'at-compress-live-')),path=join(root,'archive.sqlite');let writer:EventStore|undefined;
 try{make(path,'base');writer=new EventStore(path);writer.put({eventId:'wal-only',source:'capture',kind:'capture_start',observedAt:2,monotonicAt:2,collectorEpoch:'e'});const before=readFileSync(path+'-wal');
  await assert.rejects(compressArchive(path),/closed|write-ahead/i);assert.deepEqual(readFileSync(path+'-wal'),before);assert.equal(existsSync(path),true);assert.equal(existsSync(path+'.gz'),false);assert.deepEqual(writer.events().map(e=>e.eventId),['base','wal-only']);
 }finally{writer?.close();rmSync(root,{recursive:true,force:true});}
});
