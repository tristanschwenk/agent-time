import{serialize,deserialize}from'node:v8';
import{deflateRawSync,inflateRawSync}from'node:zlib';
import type{Summary}from'./events.ts';
const MAX_SNAPSHOT_BYTES=32*1024*1024;
/** View snapshots retain compressed bytes, not previous days' object graphs. */
export class DaySnapshotCache{
 private entries=new Map<string,{key:string;token:string;data:Buffer;bytes:number}>();
 private budget:number;private limit:number;retainedBytes=0;
 constructor(budget=8*1024*1024,limit=6){this.budget=budget;this.limit=limit;}
 clear(){this.entries.clear();this.retainedBytes=0;}
 private delete(date:string){const old=this.entries.get(date);if(old)this.retainedBytes-=old.bytes;this.entries.delete(date);}
 get(date:string,key:string){
  const entry=this.entries.get(date);if(!entry)return;
  if(entry.key!==key){this.delete(date);return;}
  this.entries.delete(date);this.entries.set(date,entry);
  return {token:entry.token,get value():Summary{return deserialize(inflateRawSync(entry.data,{maxOutputLength:MAX_SNAPSHOT_BYTES})) as Summary;}};
 }
 put(date:string,key:string,value:Summary,token:string){
  this.delete(date);const raw=serialize(value);if(raw.byteLength>MAX_SNAPSHOT_BYTES)return false;
  const data=deflateRawSync(raw,{level:1}),bytes=data.byteLength+2*(key.length+date.length+token.length)+256;
  if(bytes>this.budget)return false;
  this.entries.set(date,{key,token,data,bytes});this.retainedBytes+=bytes;
  while(this.entries.size>this.limit||this.retainedBytes>this.budget)this.delete(this.entries.keys().next().value!);
  return true;
 }
}
