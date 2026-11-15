import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,existsSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {cleanupArchiveStaging} from '../src/capture/archive-storage.ts';
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
