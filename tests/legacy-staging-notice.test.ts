import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{storageUsage}from'../src/capture/storage-usage.ts';
test('old unowned archive temporaries remain visible and counted without unsafe deletion',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-legacy-staging-')),id='agent-time-2026-11-15T00-00-00-000Z-12345678-1234-1234-1234-123456789abc.sqlite';try{const folder=join(root,'exports');mkdirSync(folder);writeFileSync(join(folder,id+'.tmp'),'proof');writeFileSync(join(folder,id+'.gz.12345678-1234-1234-1234-123456789abc.tmp'),'old');writeFileSync(join(folder,'manual.tmp'),'manual');writeFileSync(join(folder,id),'archive');symlinkSync(join(folder,id),join(folder,id.replace('12345678','87654321')+'.tmp'));
 const usage=storageUsage(root);assert.equal(usage.unverifiedArchiveTemps?.files,2);assert.equal(usage.unverifiedArchiveTemps?.bytes,8);assert.equal(usage.unverifiedArchiveTemps?.folder,folder);assert.equal(usage.totalBytes,21);
 }finally{rmSync(root,{recursive:true,force:true});}
});
