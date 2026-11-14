import type{Summary}from'../capture/events.ts';
/** Navigation cache only: tokens must be validated by the collector before presentation. */
export class SummaryPageCache{
 private entries=new Map<string,{token:string;data:Uint8Array}>();private writing=false;private epoch=0;
 private budget:number;private limit:number;retainedBytes=0;
 constructor(budget=8*1024*1024,limit=3){this.budget=budget;this.limit=limit;}
 private delete(date:string){const old=this.entries.get(date);if(old)this.retainedBytes-=old.data.byteLength;this.entries.delete(date);}
 clear(){this.entries.clear();this.retainedBytes=0;this.epoch++;}
 get(date:string):Promise<{token:string;value:Summary}|undefined>|undefined{
  const entry=this.entries.get(date);if(!entry||typeof DecompressionStream!=='function')return;
  this.entries.delete(date);this.entries.set(date,entry);
  return new Response(new Blob([entry.data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
   .then(text=>({token:entry.token,value:JSON.parse(text)as Summary})).catch(()=>{this.delete(date);return undefined;});
 }
 async put(date:string,token:string,value:Summary){
  // At most one transient encoding graph; rapid navigation can simply skip caching a result.
  if(this.writing||typeof CompressionStream!=='function'||typeof DecompressionStream!=='function')return;
  this.writing=true;const epoch=this.epoch;
  try{
   const text=JSON.stringify(value);if(text.length*2>32*1024*1024)return;
   const data=new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
   if(epoch!==this.epoch||data.byteLength>this.budget)return;
   this.delete(date);this.entries.set(date,{token,data});this.retainedBytes+=data.byteLength;
   while(this.entries.size>this.limit||this.retainedBytes>this.budget)this.delete(this.entries.keys().next().value!);
  }catch{/* Caching must never prevent a normal server load. */}
  finally{this.writing=false;}
 }
}
