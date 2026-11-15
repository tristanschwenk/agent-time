/** Private frozen-copy benchmark. Never point report/ingest at a live profile.
 * clone COPY SOURCE; ingest COPY RESULT_PREFIX; proofs COPY RESULT_PREFIX;
 * report COPY RESULT_PREFIX CODE_ROOT [EXPECTED_REPLY_JSON].
 * Keep full replies private; only aggregate metrics belong in validation docs.
 */
import{mkdirSync,copyFileSync,existsSync,chmodSync,writeFileSync,readFileSync}from'node:fs';
import{backup,DatabaseSync}from'node:sqlite';import{resolve,join}from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';import{serialize}from'node:v8';import assert from'node:assert/strict';
const[mode,directory,prefix,code=process.cwd(),expected]=process.argv.slice(2);
if(!directory||!prefix)throw Error('Usage: benchmark-ingestion.ts clone|ingest|proofs|report COPY SOURCE_OR_RESULT_PREFIX [CODE_ROOT] [EXPECTED_REPLY_JSON]');
const root=resolve(directory),marker=join(root,'.benchmark-copy');
const load=(file:string)=>import(pathToFileURL(resolve(code,'src',file)).href);
if(mode==='clone'){
 if(existsSync(root))throw Error('Choose a new private copy directory');mkdirSync(root,{recursive:true,mode:0o700});
 const{openEventDatabase}=await load('capture/event-database.ts'),db=openEventDatabase(join(resolve(prefix),'events.sqlite'),{readOnly:true});try{await backup(db,join(root,'events.sqlite'));chmodSync(join(root,'events.sqlite'),0o600);}finally{db.close();}
 for(const file of ['settings.json','website-rules.json','linear-projects.json'])if(existsSync(join(prefix,file)))copyFileSync(join(prefix,file),join(root,file));
 writeFileSync(marker,'Private benchmark copy\n',{mode:0o600});const{EventStore}=await load('capture/store.ts'),store=new EventStore(join(root,'events.sqlite'));store.close();
}else{
 if(!existsSync(marker))throw Error('Missing private-copy marker; use clone first');
 const asOf=Date.parse(process.env.AGENT_TIME_BENCH_AS_OF||'2026-11-15T12:00:00Z');assert(Number.isFinite(asOf));Date.now=()=>asOf;
 const save=(value:unknown)=>{writeFileSync(prefix+'.json',JSON.stringify(value,null,2),{mode:0o600});console.log(value);};
 if(mode==='report'){
  const{billingForProject,billingProjects}=await load('capture/billing-service.ts'),projects=billingProjects(root).projects,project=projects.find((p:{name:string})=>p.name.toLowerCase()==='caex')??projects[0];assert(project,'No configured billing project');
  const t=performance.now(),value=billingForProject(root,{project:project.id,fromDate:process.env.AGENT_TIME_BENCH_FROM||'2026-10-16',toDate:process.env.AGENT_TIME_BENCH_TO||'2026-11-14',detail:'daily'}),ms=performance.now()-t,data=JSON.stringify(value);
  if(expected)assert.deepEqual(JSON.parse(data),JSON.parse(readFileSync(expected,'utf8')));writeFileSync(prefix+'.reply.json',data,{mode:0o600});
  save({ms,peakRssMiB:process.resourceUsage().maxRSS/1024,rssMiB:process.memoryUsage().rss/1048576,replyBytes:data.length,equal:!!expected,displayCacheCreated:existsSync(join(root,'derived-periods.sqlite'))});
 }else if(mode==='ingest'){
  const{runIngestionBatch}=await load('capture/ingestion-maintenance.ts'),{IngestionModel}=await load('capture/ingestion-model.ts');let scanned=0,prepared=0,steps=0;const t=performance.now();
  for(;;){const result=runIngestionBatch(root,{days:1});scanned+=result.scanned;prepared+=result.prepared;steps++;console.log(JSON.stringify({elapsedMs:performance.now()-t,...result}));assert(!['failed','paused'].includes(result.phase),JSON.stringify(result));if(result.phase==='idle'||!result.scanned&&!result.prepared)break;assert(steps<2000,'Maintenance did not settle');}
  const model=new IngestionModel(root,false);try{save({ms:performance.now()-t,peakRssMiB:process.resourceUsage().maxRSS/1024,steps,scanned,prepared,...model.stats()});}finally{model.close();}
 }else if(mode==='proofs'){
  const db=new DatabaseSync(join(root,'events.sqlite'),{readOnly:true}),result:Record<string,unknown>={};try{const packed=Number(db.prepare('PRAGMA user_version').get()?.user_version)===2;
   for(const table of ['events',...(packed?['at_event_blocks']:[]),'human_decisions','human_splits']){const h=createHash('sha256');let count=0;
    const columns=table==='events'?(packed?'rowid,event_id,observed_at,payload_data,source,activity_sample':'rowid,event_id,observed_at,payload'):'*',order=table==='events'?'rowid':table==='at_event_blocks'?'key':'start_event_id,end_event_id';
    for(const row of db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${order}`).iterate()){h.update(serialize(row));count++;}result[table]={count,sha256:h.digest('hex')};
   }save(result);
  }finally{db.close();}
 }else throw Error('Unknown benchmark mode');
}
