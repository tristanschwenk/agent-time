import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Collector} from '../src/capture/collector.ts';
import {quickStorageUsage} from '../src/capture/storage-policy.ts';
const GiB=1024**3;

for(const phase of ['compressing','blocked','ready','failed'] as const){
 test(`manual stop revokes persistent storage resume while ${phase}, without changing evidence`,async()=>{
  const root=mkdtempSync(join(tmpdir(),'at-manual-storage-stop-'));let collector=new Collector(root),free=GiB/2;
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  try{
   collector.updateSettings({macosActivity:false,orcaPolling:false,tokenUsage:false});
   const usage=()=>({...quickStorageUsage(root),freeBytes:free});
   (collector as any).readStorageUsage=usage;
   (collector as any).runPressureCompression=async()=>{await pending;if(phase==='failed')throw new Error('injected');if(phase==='ready')free=2*GiB;return {packedEvents:0,reason:'headroom'};};
   await assert.rejects(collector.start(),/1 GB/);const recovery=(collector as any).pressureRecovery;
   if(phase!=='compressing'){release();await recovery;}
   assert.equal(collector.status().storageCare.pressure?.phase,phase);
   assert.equal(existsSync(join(root,'capture.lock')),phase==='compressing');
   const evidence=collector.store.events();
   await collector.stop();
   assert.equal(collector.status().storageCare.pressure?.autoResume,false);
   assert.equal(JSON.parse(readFileSync(join(root,'storage-paused.json'),'utf8')).pressure.autoResume,false);
   release();await recovery;
   assert.equal(collector.status().storageCare.pressure?.autoResume,false);
   assert.deepEqual(collector.store.events(),evidence);
   await collector.close();collector=new Collector(root);(collector as any).readStorageUsage=usage;
   free=2*GiB;await (collector as any).resumeAfterStorage();
   assert.equal(collector.status().running,false);assert.equal(collector.status().storageCare.pressure?.autoResume,false);
   assert.deepEqual(collector.store.events(),evidence);
  }finally{release();await collector.close();rmSync(root,{recursive:true,force:true});}
 });
}
test('internal storage stop and close retain persistent automatic recovery intent',async()=>{
 const root=mkdtempSync(join(tmpdir(),'at-internal-storage-stop-'));let collector=new Collector(root),free=GiB/2;
 try{
  collector.updateSettings({macosActivity:false,orcaPolling:false,tokenUsage:false});const usage=()=>({...quickStorageUsage(root),freeBytes:free});
  (collector as any).readStorageUsage=usage;(collector as any).runPressureCompression=async()=>({packedEvents:0,reason:'headroom'});
  await assert.rejects(collector.start(),/1 GB/);await (collector as any).pressureRecovery;
  await collector.stop(true);assert.equal(collector.status().storageCare.pressure?.autoResume,true);
  await collector.close();collector=new Collector(root);(collector as any).readStorageUsage=usage;
  assert.equal(collector.status().storageCare.pressure?.autoResume,true);
  free=2*GiB;await (collector as any).resumeAfterStorage();assert.equal(collector.status().running,true);
 }finally{await collector.close();rmSync(root,{recursive:true,force:true});}
});
