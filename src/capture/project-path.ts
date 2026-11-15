import {execFileSync} from 'node:child_process';
import {openSync,closeSync,readSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';

const cacheLimit=256,positiveTtl=60_000,negativeTtl=5_000;
const cache=new Map<string,{path:string;at:number;linked:boolean}>();
function smallFile(path:string):string|undefined{
 let fd:number|undefined;
 try{
  const info=statSync(path);if(!info.isFile()||info.size>16_384)return;
  fd=openSync(path,'r');const buffer=Buffer.alloc(16_385),size=readSync(fd,buffer,0,buffer.length,0);
  return size<=16_384?buffer.toString('utf8',0,size).trim():undefined;
 }catch{return;}finally{if(fd!==undefined)closeSync(fd);}
}
function directory(path:string):boolean{try{return statSync(path).isDirectory();}catch{return false;}}
function gitDirectory(root:string):string|undefined{
 const dotGit=join(root,'.git');if(directory(dotGit))return dotGit;
 const link=smallFile(dotGit)?.match(/^gitdir: ([^\r\n]+)$/)?.[1];return link?resolve(root,link):undefined;
}
function principalCheckout(root:string,common:string):string|undefined{
 if(basename(common)==='.git'&&directory(dirname(common))&&gitDirectory(dirname(common))===common)return dirname(common);
 // Nonstandard --separate-git-dir layouts do not encode their principal checkout
 // in commondir. Git's first worktree is the principal checkout, never a branch guess.
 try{
  const output=execFileSync('/usr/bin/git',['-C',root,'worktree','list','--porcelain','-z'],{
   encoding:'utf8',timeout:700,maxBuffer:64_000,stdio:['ignore','pipe','ignore'],
   env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},
  });
  const path=output.split('\0')[0]?.match(/^worktree (.+)$/s)?.[1];
  if(path&&isAbsolute(path)&&directory(path)&&gitDirectory(path)===common)return path;
  const configured=execFileSync('/usr/bin/git',['--git-dir',common,'config','--path','--get','core.worktree'],{
   encoding:'utf8',timeout:700,maxBuffer:16_384,stdio:['ignore','pipe','ignore'],
   env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},
  }).trim();
  const explicit=resolve(common,configured);
  if(configured&&directory(explicit)&&gitDirectory(explicit)===common)return explicit;
 }catch{/* Missing, bare or oversized metadata cannot establish a principal checkout. */}
 return;
}
export interface ProjectPathDependency{path:string;hostId?:string;resolved:string;}
let pathObserver:((dependency:ProjectPathDependency)=>void)|undefined;
/** Synchronous, bounded dependency capture; always close in finally. Nested
 * reads forward their dependencies so an outer derived view remains complete. */
export function collectProjectPaths(){
 const previous=pathObserver,paths=new Map<string,ProjectPathDependency>();let overflow=false,closed=false;
 const observer=(dependency:ProjectPathDependency)=>{previous?.(dependency);if(overflow)return;const key=JSON.stringify([dependency.path,dependency.hostId]),prior=paths.get(key);if(prior&&prior.resolved!==dependency.resolved){paths.clear();overflow=true;return;}paths.set(key,dependency);if(paths.size>8192){paths.clear();overflow=true;}};
 pathObserver=observer;
 return {get paths(){return overflow?undefined:[...paths.values()];},close(){if(!closed){pathObserver=previous;closed=true;}}};
}
export function withProjectPaths<T>(run:()=>T):{value:T;paths:ProjectPathDependency[]|undefined}{const capture=collectProjectPaths();try{return {value:run(),paths:capture.paths};}finally{capture.close();}}
export function validProjectPaths(paths:unknown):paths is ProjectPathDependency[]{
 return Array.isArray(paths)&&paths.length<=8192&&paths.every(item=>item&&typeof item.path==='string'&&typeof item.resolved==='string'&&(item.hostId===undefined||typeof item.hostId==='string')&&resolveProjectPath(item.path,{hostId:item.hostId})===item.resolved);
}
/** Canonical project path, preserving explicit subproject directories and raw caller data. */
export function resolveProjectPath(path:string,options:{hostId?:string}={}):string{
 const resolved=resolvePath(path,options);pathObserver?.({path,hostId:options.hostId,resolved});return resolved;
}
function resolvePath(path:string,options:{hostId?:string}):string{
 const normalized=resolve(path),marker=`${sep}.orca${sep}workspaces${sep}`,orca=normalized.indexOf(marker);
 if(orca>=0)return normalized.slice(0,orca)||sep;
 const host=options.hostId;
 if(host!==undefined&&host!=='local'&&host!==process.env.ORCA_EXECUTION_HOST_ID)return normalized;
 // Never let a warm cache manufacture evidence for a deleted historical cwd.
 if(!directory(normalized)){cache.delete(normalized);return normalized;}
 const now=Date.now(),cached=cache.get(normalized);
 if(cached&&now-cached.at<(cached.linked?positiveTtl:negativeTtl))return cached.path;
 let result=normalized;
 for(let current=normalized,depth=0;depth<128;depth++){
  const gitDir=gitDirectory(current);
  if(gitDir){
   const commonLink=smallFile(join(gitDir,'commondir'));
   if(commonLink){
    const common=resolve(gitDir,commonLink),principal=principalCheckout(current,common);
    if(principal)result=join(principal,relative(current,normalized));
   }
   break;
  }
  const parent=dirname(current);if(parent===current)break;current=parent;
 }
 cache.delete(normalized);cache.set(normalized,{path:result,at:now,linked:result!==normalized});
 if(cache.size>cacheLimit)cache.delete(cache.keys().next().value!);
 return result;
}
/** Compatibility export for website and existing capture callers. */
export const projectPathFromWorktree=resolveProjectPath;
