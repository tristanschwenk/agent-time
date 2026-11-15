/** Internal native file-picker worker; no protocol method accepts arbitrary paths. */
import {createHash,randomUUID} from 'node:crypto';
import {chmodSync,closeSync,existsSync,fchmodSync,fsyncSync,fstatSync,linkSync,lstatSync,mkdirSync,openSync,readSync,statfsSync,writeSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createArchiveStaging,lockClosedArchive} from './archive-storage.ts';
const maxBytes=8*1024**3;
function regular(path:string){const info=lstatSync(path,{bigint:true});if(!info.isFile()||info.isSymbolicLink())throw new Error('Choose a regular SQLite archive');return info;}
function same(a:ReturnType<typeof regular>,b:ReturnType<typeof regular>){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;}
export function stageArchiveCopy(source:string,output:string):string{
 const before=regular(source),compressed=source.endsWith('.sqlite.gz');
 if(!compressed&&extname(source)!=='.sqlite')throw new Error('Choose a regular SQLite archive');
 if(before.size>BigInt(maxBytes))throw new Error('Archive is larger than the 8 GB import limit');
 // A selected plain database must be self-contained before any bytes are copied.
 const guard=compressed?undefined:lockClosedArchive(source);
 let input:number|undefined,target:number|undefined,staging:ReturnType<typeof createArchiveStaging>|undefined;
 try{
  input=openSync(source,'r');if(!same(before,fstatSync(input,{bigint:true})))throw new Error('Archive changed before copying');
  const header=Buffer.alloc(16);if(readSync(input,header,0,16,0)!==16||(compressed?header[0]!==0x1f||header[1]!==0x8b:header.toString('binary')!=='SQLite format 3\0'))throw new Error('Selected file is not a SQLite archive');
  const folder=join(output,'exports');if(existsSync(folder)&&lstatSync(folder).isSymbolicLink())throw new Error('Export folder must not be a symlink');mkdirSync(folder,{recursive:true,mode:0o700});chmodSync(folder,0o700);
  const volume=statfsSync(folder,{bigint:true});if(volume.bavail*volume.bsize<before.size+1024n**3n)throw new Error('Not enough free space to stage this archive safely');
  staging=createArchiveStaging(folder);target=openSync(staging.path,'wx',0o600);fchmodSync(target,0o600);
  const copied=createHash('sha256'),chunk=Buffer.allocUnsafe(1024*1024);let offset=0;
  while(offset<=Number(before.size)){
   const bytes=readSync(input,chunk,0,Math.min(chunk.length,Number(before.size)+1-offset),offset);if(!bytes)break;
   copied.update(chunk.subarray(0,bytes));let written=0;while(written<bytes)written+=writeSync(target,chunk,written,bytes-written);offset+=bytes;
  }
  if(offset!==Number(before.size))throw new Error('Archive changed during copying');
  const current=createHash('sha256');let reread=0;for(;;){const bytes=readSync(input,chunk,0,chunk.length,reread);if(!bytes)break;current.update(chunk.subarray(0,bytes));reread+=bytes;if(reread>Number(before.size))throw new Error('Archive changed during copying');}
  if(reread!==offset||copied.digest('hex')!==current.digest('hex')||!same(before,fstatSync(input,{bigint:true}))||!same(before,regular(source)))throw new Error('Archive changed during copying');
  fsyncSync(target);closeSync(target);target=undefined;
  const id=`agent-time-${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${randomUUID()}.sqlite${compressed?'.gz':''}`;
  linkSync(staging.path,join(folder,id));return id;
 }finally{
  if(target!==undefined)closeSync(target);if(input!==undefined)closeSync(input);
  try{guard?.close();}finally{staging?.cleanup();}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4)throw new Error('Expected source and output paths');const id=stageArchiveCopy(process.argv[2]!,process.argv[3]!);process.stdout.write(JSON.stringify({id}));}
 catch(error){process.stderr.write((error instanceof Error?error.message:'Archive staging failed').slice(0,2000));process.exitCode=1;}
}
