import{join}from'node:path';import{openEventDatabase}from'./event-database.ts';import{BillingStore}from'./billing-store.ts';import{snapshotSettings}from'../mcp/data.ts';import{creditedConfiguration,prepareCreditedInput}from'./billing-service.ts';import{IngestionModel,ingestionStorageLimit}from'./ingestion-model.ts';
export interface IngestionProgress{phase:'indexing'|'preparing'|'idle'|'paused'|'failed';cursor:number;sourceCursor:number;preparedDays:number;pendingDays:number;scanned:number;prepared:number;date?:string;error?:string;toolIndexAvailable?:boolean;history?:{projects:number;total:number;prepared:number;pending:number};projectName?:string;}
const deferred=new Map<string,number>();
/** One bounded maintenance step; no user report is generated or saved. */
export function runIngestionBatch(output:string,options:{rows?:number;days?:number;force?:boolean}={},progress?:(value:IngestionProgress)=>void):IngestionProgress{
 const db=openEventDatabase(join(output,'events.sqlite'),{readOnly:true});let model:IngestionModel|undefined;
 let result:IngestionProgress={phase:'indexing',cursor:0,sourceCursor:0,preparedDays:0,pendingDays:0,scanned:0,prepared:0};
 try{
  model=new IngestionModel(output,true,ingestionStorageLimit(output));
  const rows=Math.max(1,Math.min(options.rows??32768,32768));let done=false;
  for(let n=0;n<rows;n+=4096){const update=model.sync(db,Math.min(4096,rows-n));result.scanned+=update.scanned;result.cursor=update.cursor;result.sourceCursor=Number(db.prepare('SELECT coalesce(max(rowid),0) n FROM events').get()!.n);if(update.scanned||!update.caughtUp)progress?.(result);if(update.capacity){result.phase='paused';return result;}if(update.future)throw Error('Source snapshot is older than ingestion state');if(update.caughtUp){done=true;break;}}
  if(!done)return result;
  const projects=new BillingStore(db).listProjects(),settings=snapshotSettings(output),now=Date.now()/1000;
  const registration=model.registerDates(projects.map(project=>({id:project.id,timezone:project.timezone,config:creditedConfiguration(project,projects,settings)})),settings.agentIdleThreshold,now);
  if(!registration.complete){if(registration.capacity)result.phase='paused';return result;}
  model.database.prepare('UPDATE credited_slices SET dirty=1 WHERE dirty=0 AND valid_until<=?').run(now);
  result.history=model.historyStats(now,projects.map(p=>p.id));
  const byId=new Map(projects.map(p=>[p.id,p]));
  for(const job of model.pending(256)){
   if(result.prepared>=Math.max(1,Math.min(options.days??1,31)))break;
   const id=JSON.stringify([job.project,job.date]);if(!options.force&&(deferred.get(id)??0)>now)continue;
   const project=byId.get(job.project);if(!project)continue;
   result.phase='preparing';result.date=job.date;result.projectName=project.name;progress?.(result);
   db.exec('BEGIN');try{
    const update=model.sync(db);if(!update.caughtUp){result.phase='indexing';break;}
    const input=prepareCreditedInput(output,db,project,projects,job.date,settings,Date.now()/1000);
    if(model.put(db,project.id,job.date,creditedConfiguration(project,projects,settings),input)){
     result.prepared++;if(input.validUntil<=input.asOf){deferred.set(id,now+30);while(deferred.size>256)deferred.delete(deferred.keys().next().value!);}else deferred.delete(id);
    }else{deferred.set(id,now+30);result.phase='paused';break;}
   }finally{db.exec('ROLLBACK');}
  }
  result.history=model.historyStats(now,projects.map(p=>p.id));
  const stats=model.stats();result.toolIndexAvailable=stats.toolIndexAvailable;result.preparedDays=stats.prepared;result.pendingDays=stats.dirty;result.cursor=stats.cursor;
  if(result.phase!=='paused')result.phase=result.pendingDays?'preparing':'idle';return result;
 }catch(error){result.phase='failed';result.error=error instanceof Error?error.message:String(error);return result;}
 finally{model?.close();db.close();}
}
