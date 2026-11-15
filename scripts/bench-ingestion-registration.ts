// Synthetic only. Run with: node scripts/bench-ingestion-registration.ts
// Metadata is marked ready only AFTER all dates are registered, to isolate idle work.
import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{performance}from'node:perf_hooks';
import{EventStore}from'../src/capture/store.ts';import{IngestionModel}from'../src/capture/ingestion-model.ts';import{runIngestionBatch}from'../src/capture/ingestion-maintenance.ts';import{billingLocalDate}from'../src/capture/billing-calendar.ts';
const root=mkdtempSync(join(tmpdir(),'at-registration-bench-')),store=new EventStore(join(root,'events.sqlite')),db=store.database,now=Math.floor(Date.now()/86400000)*86400;
try{
 db.exec('BEGIN');const write=db.prepare('INSERT INTO events(event_id,observed_at,payload_data) VALUES(?,?,?)');for(let n=1;n<=1095;n++){const at=now-n*86400;write.run('day'+n,at,JSON.stringify({eventId:'day'+n,observedAt:at,source:'macos',kind:'activity',data:{}}));}
 for(let n=0;n<10;n++){const p={id:'p'+n,name:'Project'+n,aliases:[],sources:{repositories:[],workspaceIds:[],reportedProjects:[]},timezone:'Europe/Paris',policies:[],revision:1};db.prepare('INSERT INTO billing_projects VALUES(?,?,?)').run(p.id,1,JSON.stringify(p));}db.exec('COMMIT');
 let model=new IngestionModel(root);model.sync(db);const expected=new Set<string>();for(let p=0;p<10;p++)for(const bucket of model.buckets())for(let delta=-3;delta<=3;delta++){const date=billingLocalDate((bucket+delta)*86400,'Europe/Paris');if(date<=billingLocalDate(Date.now()/1000,'Europe/Paris'))expected.add(JSON.stringify(['p'+p,date]));}model.close();
 const timings=[];let result,start=performance.now();do{const t=performance.now();result=runIngestionBatch(root);timings.push({kind:'initial-batch',ms:performance.now()-t,result});if(result.phase==='failed'||result.phase==='paused')throw Error(JSON.stringify(result));}while(result.phase==='indexing');const initialTotalMs=performance.now()-start;
 model=new IngestionModel(root);const keys=model.database.prepare('SELECT key FROM credited_slices').all().map(r=>String(r.key));if(keys.length!==expected.size||keys.some(k=>!expected.has(k)))throw Error('Registration changed original date set');const sliceCount=keys.length;
 model.database.prepare('UPDATE credited_slices SET dirty=0,valid_until=?').run(now+86400*10);model.close();
 for(let n=0;n<3;n++){const t=performance.now(),result=runIngestionBatch(root);if(result.phase!=='idle'||result.scanned||result.prepared)throw Error('Fixture is not idle');timings.push({kind:'idle',ms:performance.now()-t,result});}
 if(store.count()!==1095)throw Error('Source evidence changed');console.log(JSON.stringify({sliceCount,initialTotalMs,batches:timings.length-3,timings,memory:process.memoryUsage(),peakRssKB:process.resourceUsage().maxRSS},null,2));
}finally{store.close();rmSync(root,{recursive:true,force:true});}
