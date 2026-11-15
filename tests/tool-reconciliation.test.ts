import{makeEvent}from'../src/capture/events.ts';
import{test}from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{ToolReconciliation}from'../src/capture/tool-reconciliation.ts';

test('old duplicated tool schemas are rebuilt and a full optional index fails closed',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec('CREATE TABLE tool_boundaries(event_id TEXT PRIMARY KEY,identity TEXT);CREATE TABLE tool_executions(identity TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const tools=new ToolReconciliation(db,0);assert.equal(db.prepare('PRAGMA table_info(tool_boundaries)').all().some(r=>r.name==='identity'),false);tools.ingest([]);assert.equal(tools.disabled(),true);assert.equal(db.prepare('SELECT count(*) n FROM tool_executions').get()!.n,0);tools.reset();assert.equal(tools.disabled(),false);
 }finally{db.close();}
});

test('oversized identity batches suspend the optional index before exhausting SQLite pages',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('PRAGMA max_page_count=1024');const tools=new ToolReconciliation(db,3*1024*1024),rows=Array.from({length:100},(_,n)=>({rowid:n+1,event:makeEvent('hook','tool_start',{eventId:'large-'+n,provider:'claude',hostId:'host',sessionId:'session',observedAt:n,data:{toolId:'x'.repeat(32768)+n}})}));tools.ingest(rows);assert.equal(tools.disabled(),true);tools.ingest(rows);assert.equal(db.prepare('SELECT count(*) n FROM tool_executions').get()!.n,0);}finally{db.close();}
});

import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{toolIdentity}from'../src/capture/tool-reconciliation.ts';
test('tool status and boundaries are read from one pinned snapshot across concurrent writes',()=>{
 const root=mkdtempSync(join(tmpdir(),'at-tool-snapshot-')),db=new DatabaseSync(join(root,'index.sqlite'));db.exec('PRAGMA journal_mode=WAL');const other=new DatabaseSync(join(root,'index.sqlite'));try{
 const reader=new ToolReconciliation(db),writer=new ToolReconciliation(other),start=makeEvent('hook','tool_start',{eventId:'start',provider:'claude',hostId:'host',sessionId:'session',observedAt:10,monotonicAt:10,data:{toolId:'tool'}}),end={...start,eventId:'end',kind:'tool_end',observedAt:20,monotonicAt:20};reader.ingest([{rowid:1,event:start},{rowid:2,event:end}]);
 const internals=reader as unknown as {boundaries:(id:number)=>unknown[]},read=internals.boundaries.bind(reader);internals.boundaries=id=>{writer.remove('end');return read(id);};const value=reader.get(toolIdentity(start)!);assert.equal(value?.status,'complete');assert.equal(value?.boundaries.length,2);assert.equal(value?.end?.eventId,'end');assert.equal(db.isTransaction,false);assert.equal(writer.get(toolIdentity(start)!)?.status,'open');
 }finally{other.close();db.close();rmSync(root,{recursive:true,force:true});}
});
