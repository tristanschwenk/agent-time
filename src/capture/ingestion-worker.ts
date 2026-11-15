import{Worker,isMainThread,parentPort,workerData}from'node:worker_threads';import{runIngestionBatch,type IngestionProgress}from'./ingestion-maintenance.ts';
/** Long-lived worker: source proof writes and app requests never wait for a reducer. */
export class IngestionCoordinator{
 private output:string;private worker?:Worker;private timer?:ReturnType<typeof setTimeout>;private closed=false;private active?:Promise<IngestionProgress>;private resolve?:((v:IngestionProgress)=>void);private reject?:((e:Error)=>void);
 private value:IngestionProgress={phase:'indexing',cursor:0,sourceCursor:0,preparedDays:0,pendingDays:0,scanned:0,prepared:0};
 constructor(output:string){this.output=output;}
 status(){return {...this.value};}
 wake(delay=100){if(this.closed||this.timer||this.active)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.run().then(value=>{if(!this.closed)this.wake((value.scanned>0||value.prepared>0)&&value.phase!=='paused'&&value.phase!=='failed'?25:5000);}).catch(()=>{if(!this.closed)this.wake(5000);});},delay);this.timer.unref?.();}
 private ensureWorker(){if(this.worker)return this.worker;const worker=this.worker=new Worker(new URL(import.meta.url),{workerData:{ingestionOutput:this.output},resourceLimits:{maxOldGenerationSizeMb:256}});worker.unref();
  worker.on('message',(reply:{progress?:IngestionProgress;result?:IngestionProgress})=>{if(reply.progress)this.value=reply.progress;if(reply.result){this.value=reply.result;this.resolve?.(reply.result);this.resolve=undefined;this.reject=undefined;this.active=undefined;worker.unref();}});
  worker.on('error',error=>{this.value={...this.value,phase:'failed',error:String(error)};this.reject?.(error instanceof Error?error:Error(String(error)));this.active=undefined;this.resolve=undefined;this.reject=undefined;this.worker=undefined;});
  worker.on('exit',code=>{if(this.worker===worker)this.worker=undefined;if(this.active){this.reject?.(Error(`Ingestion worker stopped (${code})`));this.active=undefined;this.resolve=undefined;this.reject=undefined;}});return worker;
 }
 run(options:{rows?:number;days?:number;force?:boolean}={}):Promise<IngestionProgress>{if(this.closed)return Promise.reject(Error('Ingestion stopped'));if(this.active)return this.active;clearTimeout(this.timer);this.timer=undefined;const worker=this.ensureWorker();worker.ref();this.active=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});worker.postMessage(options);return this.active;}
 async prepare(){let value:IngestionProgress;do{value=await this.run();if(value.phase==='failed'||value.phase==='paused')return value;}while(value.scanned>0||value.prepared>0&&value.pendingDays>0);return value;}
 async close(){this.closed=true;clearTimeout(this.timer);this.reject?.(Error('Ingestion stopped'));this.resolve=undefined;this.reject=undefined;this.active=undefined;await this.worker?.terminate();this.worker=undefined;}
}
if(!isMainThread&&parentPort&&workerData?.ingestionOutput){const output=String(workerData.ingestionOutput),port=parentPort;port.on('message',(options)=>{try{port.postMessage({result:runIngestionBatch(output,options,value=>port.postMessage({progress:value}))});}catch(error){port.postMessage({result:{phase:'failed',cursor:0,sourceCursor:0,preparedDays:0,pendingDays:0,scanned:0,prepared:0,error:String(error)}});}});}
