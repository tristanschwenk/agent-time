import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventStore} from '../src/capture/store.ts';
import {storageUsage} from '../src/capture/storage-usage.ts';

test('storage report separates database, spool, runtimes and exports without following links',()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-time-storage-'));
 const store=new EventStore(join(root,'events.sqlite'));
 try{
  const now=Date.now()/1000;
  store.put({eventId:'mac',source:'macos',kind:'activity',observedAt:now,monotonicAt:1,collectorEpoch:'a'});
  mkdirSync(join(root,'spool'));writeFileSync(join(root,'spool','one.json'),'x'.repeat(17));
  mkdirSync(join(root,'hook-runtime'));writeFileSync(join(root,'hook-runtime','node'),'x'.repeat(23));
  mkdirSync(join(root,'exports'));writeFileSync(join(root,'exports','saved.sqlite'),'x'.repeat(29));
  symlinkSync(join(root,'exports'),join(root,'spool','linked-export'));
  const report=storageUsage(root);
  assert.equal(report.eventCount,1);
  assert.equal(report.spool.bytes,17);
  assert.equal(report.spool.files,1);
  assert.equal(report.runtimes.bytes,23);
  assert.equal(report.exports.bytes,29);
  assert.ok(report.database.bytes>0);
  assert.ok(report.freeBytes===null||report.freeBytes>=0);
  assert.ok(report.indexes.bytes>0);
  assert.equal(report.byDay[0].events,1);
  assert.equal(report.byDay[0].source,'macos');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('checkpoint frees the write-ahead log without changing captured events',()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-time-checkpoint-'));
 const store=new EventStore(join(root,'events.sqlite'));
 try{
  for(let i=0;i<100;i++)store.put({eventId:`event-${i}`,source:'macos',kind:'activity',observedAt:1000+i,monotonicAt:i,collectorEpoch:'a'});
  const before=JSON.stringify(store.events()),walBefore=storageUsage(root).wal.bytes;
  assert.ok(walBefore>0);
  store.checkpointWal();
  assert.equal(JSON.stringify(store.events()),before);
  assert.equal(store.quickCheck(),true);
  assert.ok(storageUsage(root).wal.bytes<walBefore);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('derived periods count toward displayed and managed disk usage',async()=>{const{quickStorageUsage}=await import('../src/capture/storage-policy.ts');const root=mkdtempSync(join(tmpdir(),'at-derived-size-'));try{writeFileSync(join(root,'derived-periods.sqlite'),'x'.repeat(123));const report=storageUsage(root);assert.equal(report.derived?.bytes,123);assert.equal(report.totalBytes,123);assert.equal(quickStorageUsage(root).managedBytes,123);}finally{rmSync(root,{recursive:true,force:true});}});

test('billing exports are accounted exactly once in both measures and retained unchanged',async()=>{
 const {quickStorageUsage}=await import('../src/capture/storage-policy.ts');const {readFileSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'at-billing-export-size-'));try{
  mkdirSync(join(root,'exports'));writeFileSync(join(root,'exports','backup.sqlite'),'b'.repeat(29));
  mkdirSync(join(root,'billing-exports','nested'),{recursive:true});
  const files=[['report.csv','c'.repeat(123)],['nested/report.md','m'.repeat(456)]];
  for(const [name,data] of files)writeFileSync(join(root,'billing-exports',name),data);
  symlinkSync(join(root,'exports'),join(root,'billing-exports','linked-backup'));
  const report=storageUsage(root);assert.equal(report.exports.bytes,608);assert.equal(report.exports.files,3);assert.equal(report.totalBytes,608);assert.equal(quickStorageUsage(root).managedBytes,608);
  for(const [name,data] of files)assert.equal(readFileSync(join(root,'billing-exports',name),'utf8'),data);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('billing export directory links are excluded from fast and detailed accounting',async()=>{
 const {quickStorageUsage}=await import('../src/capture/storage-policy.ts');const root=mkdtempSync(join(tmpdir(),'at-billing-export-link-'));try{
  mkdirSync(join(root,'external'));writeFileSync(join(root,'external','report.csv'),'x'.repeat(123));symlinkSync(join(root,'external'),join(root,'billing-exports'));
  assert.equal(storageUsage(root).exports.bytes,0);assert.equal(storageUsage(root).totalBytes,0);assert.equal(quickStorageUsage(root).managedBytes,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
