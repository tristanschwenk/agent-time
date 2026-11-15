import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{EventStore}from'../src/capture/store.ts';import{makeEvent}from'../src/capture/events.ts';import{IngestionModel}from'../src/capture/ingestion-model.ts';import{runIngestionBatch}from'../src/capture/ingestion-maintenance.ts';import{billingLocalDate,billingDayStart,nextBillingDate}from'../src/capture/billing-calendar.ts';
const at=(date:string)=>Date.parse(date+'T12:00Z')/1000;
test('registration is bounded, resumes after reopen, and skips unchanged buckets',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-registration-')),store=new EventStore(join(root,'events.sqlite'));let model=new IngestionModel(root);try{
 for(let n=1;n<=20;n++)store.put(makeEvent('macos','activity',{eventId:'day'+n,observedAt:at('2026-10-'+String(n).padStart(2,'0'))}));model.sync(store.database);
 const projects=[{id:'p',timezone:'Europe/Paris',config:'one'},{id:'q',timezone:'America/New_York',config:'two'}],now=at('2026-10-21');let calls=0;const register=model.register.bind(model);model.register=(...args)=>{calls++;return register(...args);};
 let result=model.registerDates(projects,300,now,2);assert.equal(result.complete,false);assert(calls<=14);assert(calls>0);model.close();model=new IngestionModel(root);
 for(let n=0;!result.complete&&n<30;n++)result=model.registerDates(projects,300,now,2);assert(result.complete);
 const expected=new Set<string>();for(const p of projects)for(const bucket of model.buckets())for(let d=-3;d<=3;d++){const date=billingLocalDate((bucket+d)*86400,p.timezone);if(date<=billingLocalDate(now,p.timezone))expected.add(JSON.stringify([p.id,date]));}
 assert.deepEqual(new Set(model.database.prepare('SELECT key FROM credited_slices').all().map(r=>String(r.key))),expected);
 assert.equal(model.registerDates(projects,300,now,2).registered,0);
 store.put(makeEvent('macos','activity',{eventId:'same-day',observedAt:at('2026-10-10')+1}));model.sync(store.database);assert.equal(model.registerDates(projects,300,now,2).registered,0);
 store.put(makeEvent('macos','activity',{eventId:'late',observedAt:at('2025-01-01')}));model.sync(store.database);result=model.registerDates(projects,300,now,2);assert(result.complete);assert(result.registered>0);assert(model.database.prepare("SELECT 1 FROM credited_slices WHERE date='2025-01-01'").get());
 const changed=[{...projects[0]!,timezone:'Pacific/Auckland',config:'changed'},projects[1]!];result=model.registerDates(changed,300,now,2);assert(!result.complete);while(!result.complete)result=model.registerDates(changed,300,now,2);const row=model.database.prepare("SELECT config,start FROM credited_slices WHERE project='p' AND date='2026-10-10'").get()!;assert.equal(row.config,'changed');assert.equal(row.start,billingDayStart('2026-10-10','Pacific/Auckland'));
 result=model.registerDates(changed,300,at('2026-10-22'),2);assert(!result.complete);while(!result.complete)result=model.registerDates(changed,300,at('2026-10-22'),2);assert(model.database.prepare("SELECT 1 FROM credited_slices WHERE project='p' AND date='2026-10-22'").get());
 }finally{model.close();store.close();rmSync(root,{recursive:true,force:true});}
});
test('maintenance does not prepare or announce idle before registration completes',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-registration-phase-')),store=new EventStore(join(root,'events.sqlite'));try{
 for(let n=0;n<300;n++)store.put(makeEvent('macos','activity',{eventId:'day'+n,observedAt:at('2025-01-01')+86400*n}));const p={id:'p',name:'P',aliases:[],sources:{repositories:[],workspaceIds:[],reportedProjects:[]},timezone:'UTC',policies:[]};store.database.prepare('INSERT INTO billing_projects VALUES(?,?,?)').run(p.id,1,JSON.stringify(p));
 const result=runIngestionBatch(root);assert.equal(result.phase,'indexing');assert.equal(result.prepared,0);assert.equal(result.history,undefined);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('existing schema3 buckets seed registration once and changed topology restarts an unfinished pass',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-registration-upgrade-')),store=new EventStore(join(root,'events.sqlite'));let model=new IngestionModel(root);try{
 for(let n=0;n<5;n++)store.put(makeEvent('macos','activity',{eventId:'day'+n,observedAt:at('2026-10-01')+n*86400}));model.sync(store.database);const before=store.events();
 model.database.exec('DROP TABLE ingestion_registration_buckets;DROP TABLE ingestion_registration;DROP TABLE ingestion_registration_meta');model.close();model=new IngestionModel(root);
 const projects=[{id:'p',timezone:'UTC',config:'old'}];assert(!model.registerDates(projects,300,at('2026-10-10'),1).complete);
 const changed=[{id:'p',timezone:'UTC',config:'new-ownership'},{id:'q',timezone:'Europe/Paris',config:'new-project'}];let result=model.registerDates(changed,300,at('2026-10-10'),1);assert(!result.complete);while(!result.complete)result=model.registerDates(changed,300,at('2026-10-10'),1);
 assert.equal(model.database.prepare("SELECT count(*) n FROM credited_slices WHERE project='p' AND config<>'new-ownership'").get()!.n,0);assert(model.database.prepare("SELECT 1 FROM credited_slices WHERE project='q'").get());assert.deepEqual(store.events(),before);
 assert(model.discard());model.sync(store.database);assert(model.registerDates(changed,300,at('2026-10-10'),100).complete);assert(model.database.prepare("SELECT 1 FROM credited_slices WHERE project='q'").get());
 }finally{model.close();store.close();rmSync(root,{recursive:true,force:true});}
});
import{IngestionCoordinator}from'../src/capture/ingestion-worker.ts';
test('explicit preparation follows registration-only batches until completion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'at-registration-worker-')),store=new EventStore(join(root,'events.sqlite')),coordinator=new IngestionCoordinator(root);try{
 for(let n=0;n<300;n++)store.put(makeEvent('macos','activity',{eventId:'day'+n,observedAt:at('2025-01-01')+86400*n}));const p={id:'p',name:'P',aliases:[],sources:{repositories:[],workspaceIds:[],reportedProjects:[]},timezone:'UTC',policies:[]};store.database.prepare('INSERT INTO billing_projects VALUES(?,?,?)').run(p.id,1,JSON.stringify(p));
 // Seed through production registration, then bypass reduction only. Restart its
 // cursor so the coordinator must finish several registration-only batches.
 while(runIngestionBatch(root).phase==='indexing'){}const model=new IngestionModel(root);model.database.prepare('UPDATE credited_slices SET dirty=0,valid_until=?').run(Date.now()/1000+86400);model.database.exec('UPDATE ingestion_registration SET cursor=0');model.close();
 const result=await coordinator.prepare();assert.equal(result.phase,'idle');assert.equal(result.prepared,0);assert.equal(result.scanned,0);assert.equal(result.history?.pending,0);
 }finally{await coordinator.close();store.close();rmSync(root,{recursive:true,force:true});}
});
test('large idle windows also resume within a bucket without exceeding the candidate budget',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-registration-wide-')),store=new EventStore(join(root,'events.sqlite')),model=new IngestionModel(root);try{
 store.put(makeEvent('macos','activity',{eventId:'day',observedAt:at('2026-01-01')}));model.sync(store.database);const p=[{id:'p',timezone:'UTC',config:'wide'}];let result=model.registerDates(p,86400*10,at('2026-02-01'),1);assert(!result.complete);assert(result.registered<=7);let batches=1;while(!result.complete){result=model.registerDates(p,86400*10,at('2026-02-01'),1);assert(result.registered<=7);batches++;}assert(batches>1);assert.equal(model.database.prepare('SELECT count(*) n FROM credited_slices').get()!.n,25);
 }finally{model.close();store.close();rmSync(root,{recursive:true,force:true});}
});
