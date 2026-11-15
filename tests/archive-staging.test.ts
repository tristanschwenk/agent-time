import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,existsSync,writeFileSync,symlinkSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {cleanupArchiveStaging} from '../src/capture/archive-storage.ts';
import {EventStore} from '../src/capture/store.ts';
import * as archives from '../src/capture/archive-storage.ts';
test('startup recovers killed export and compression staging but preserves live owners and unrelated files',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-staging-owner-')),folder=join(root,'exports');mkdirSync(folder);
 try{
  // Kill real producers after they create the owner record and partial output.
  const script=`import {createArchiveStaging} from ${JSON.stringify(new URL('../src/capture/archive-storage.ts',import.meta.url).href)};import {writeFileSync} from 'node:fs';const stage=createArchiveStaging(process.argv[1]);writeFileSync(stage.path,'partial');console.log(stage.path);process.kill(process.pid,'SIGKILL');`;
  const dead=[];for(let i=0;i<2;i++){const child=spawnSync(process.execPath,['--input-type=module','-e',script,folder]);assert.equal(child.signal,'SIGKILL',String(child.stderr));dead.push(String(child.stdout).trim());}
  const live=archives.createArchiveStaging(folder);writeFileSync(live.path,'live');
  const manual=join(folder,'manual.sqlite.tmp'),legacy=join(folder,'agent-time-old.sqlite.gz.legacy.tmp'),published=join(folder,'agent-time-2026-11-16T00-00-00-000Z-12345678-1234-1234-1234-123456789abc.sqlite');for(const path of [manual,legacy,published])writeFileSync(path,'protect');
  const unknown=join(folder,'.archive-write-Abc123');mkdirSync(unknown);writeFileSync(join(unknown,'data'),'unknown');
  const symlink=join(folder,'.archive-write-Xyz987');symlinkSync(unknown,symlink);
  const malformed=join(folder,'.archive-write-Err456');mkdirSync(malformed);writeFileSync(join(malformed,'owner.lock'),'unreadable owner');
  cleanupArchiveStaging(root);for(const path of dead)assert.equal(existsSync(path),false);
  for(const path of [live.path,manual,legacy,published,unknown,symlink,malformed])assert.equal(existsSync(path),true,path);
  live.cleanup();assert.equal(existsSync(live.path),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a killed compression operation leaves only owned recoverable staging and its original archive',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-killed-compression-')),folder=join(root,'exports');mkdirSync(folder);
 try{
  const script=`import {EventStore} from ${JSON.stringify(new URL('../src/capture/store.ts',import.meta.url).href)};import {compressArchive} from ${JSON.stringify(new URL('../src/capture/archive-storage.ts',import.meta.url).href)};import {readdirSync} from 'node:fs';import {join} from 'node:path';const path=join(process.argv[1],'original.sqlite'),store=new EventStore(path);store.database.exec('CREATE TABLE fixture(data BLOB);INSERT INTO fixture VALUES(zeroblob(16777216))');store.close();compressArchive(path);console.log(readdirSync(process.argv[1]).filter(n=>n.startsWith('.archive-write-'))[0]);process.kill(process.pid,'SIGKILL');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,folder]);assert.equal(child.signal,'SIGKILL',String(child.stderr));const stage=join(folder,String(child.stdout).trim());assert.ok(existsSync(stage));
  cleanupArchiveStaging(root);assert.equal(existsSync(stage),false);assert.equal(existsSync(join(folder,'original.sqlite')),true);assert.equal(existsSync(join(folder,'original.sqlite.gz')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a killed real SQLite export reclaims all dead-owner output while retaining source evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-killed-export-')),folder=join(root,'exports');
 try{
  const script=`import {EventStore} from ${JSON.stringify(new URL('../src/capture/store.ts',import.meta.url).href)};import {readdirSync,existsSync,statSync} from 'node:fs';import {join} from 'node:path';const root=process.argv[1],store=new EventStore(join(root,'events.sqlite'));store.put({eventId:'proof',source:'capture',kind:'capture_start',observedAt:1,monotonicAt:1,collectorEpoch:'e'});store.database.exec('CREATE TABLE fixture(data BLOB);INSERT INTO fixture VALUES(zeroblob(33554432));PRAGMA wal_checkpoint(TRUNCATE)');store.exportArchive(root).then(()=>{console.error('Export completed before crash injection');process.exit(1);},error=>{console.error(error);process.exit(1);});const observe=()=>{const folder=join(root,'exports'),name=readdirSync(folder).find(n=>n.startsWith('.archive-write-'));if(name){const path=join(folder,name,'archive.tmp');if(existsSync(path)&&statSync(path).size>0){console.log(name);process.kill(process.pid,'SIGKILL');}}setImmediate(observe);};observe();`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,root],{timeout:15000});assert.equal(child.signal,'SIGKILL',String(child.stderr));const name=String(child.stdout).trim();assert.match(name,/^\.archive-write-[A-Za-z0-9]{6}$/);const stage=join(folder,name);assert.ok(statSync(join(stage,'archive.tmp')).size>0);
  cleanupArchiveStaging(root);assert.equal(existsSync(stage),false);assert.deepEqual(readdirSync(folder),[]);
  const source=new EventStore(join(root,'events.sqlite'));try{assert.deepEqual(source.events().map(e=>e.eventId),['proof']);assert.equal(Number(source.database.prepare('SELECT length(data) n FROM fixture').get()?.n),33554432);}finally{source.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
