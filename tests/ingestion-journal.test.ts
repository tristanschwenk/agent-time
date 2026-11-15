import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {openEventDatabase,createPackedEventSchema,insertEventRow,eventLocator} from '../src/capture/event-database.ts';
import {encodeEventBlock} from '../src/capture/packed-codec.ts';
import {makeEvent} from '../src/capture/events.ts';
import {ensureIngestionJournal,ingestionJournalState,readIngestionChanges} from '../src/capture/ingestion-journal.ts';
import {ToolReconciliation,toolIdentity} from '../src/capture/tool-reconciliation.ts';
for(const packed of [false,true])test(`mutation journal ${packed?'packed':'legacy'}`,()=>{
 const db=openEventDatabase(':memory:');if(packed)createPackedEventSchema(db);else db.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');
 db.exec('CREATE TABLE human_decisions(start_event_id TEXT,end_event_id TEXT,mode TEXT)');ensureIngestionJournal(db,packed);
 const event=makeEvent('hook','tool_start',{eventId:'a',observedAt:10,provider:'p',hostId:'h',sessionId:'s',data:{toolId:'t'}});insertEventRow(db,'a',10,JSON.stringify(event));
 assert.equal(ingestionJournalState(db).sequence,0);
 const field=packed?'payload_data':'payload';db.prepare(`UPDATE events SET ${field}=?`).run(JSON.stringify({...event,observedAt:20}));
 assert.equal(readIngestionChanges(db,0,10)[0]?.old?.observedAt,10);
 assert.equal(readIngestionChanges(db,0,10)[0]?.next?.observedAt,20);
 db.prepare(`INSERT OR REPLACE INTO events(event_id,observed_at,${field}) VALUES(?,?,?)`).run('a',30,JSON.stringify({...event,observedAt:30}));
 assert.equal(readIngestionChanges(db,1,10)[0]?.old?.observedAt,20);
 const beforeReview=ingestionJournalState(db).sequence;
 db.exec("INSERT INTO human_decisions VALUES('a','b','assigned'); UPDATE human_decisions SET end_event_id='c'");
 assert.deepEqual(readIngestionChanges(db,beforeReview+1,10)[0]?.pairs,[['a','b'],['a','c']]);
 const beforeDelete=ingestionJournalState(db).sequence;db.exec('DELETE FROM events');assert.equal(readIngestionChanges(db,beforeDelete,10)[0]?.old?.observedAt,30);db.close();
});
test('tool replay, late arrival, ambiguity, clocks, updates, rollback',()=>{
 const db=openEventDatabase(':memory:'),tools=new ToolReconciliation(db);
 const start=makeEvent('hook','tool_start',{eventId:'s',observedAt:10,monotonicAt:10,provider:'p',hostId:'h',sessionId:'s',data:{toolId:'t'}}),end={...start,eventId:'e',kind:'tool_end',observedAt:20,monotonicAt:20};const id=toolIdentity(start)!;
 tools.ingest([{rowid:2,event:end}]);assert.equal(tools.get(id)?.status,'orphan');
 tools.ingest([{rowid:1,event:start},{rowid:2,event:end}]);assert.equal(tools.get(id)?.status,'complete');assert.equal(tools.get(id)?.boundaries.length,2);
 tools.ingest([{rowid:3,event:{...start,eventId:'s2'}}]);assert.equal(tools.get(id)?.status,'ambiguous');tools.remove('s2');
 tools.ingest([{rowid:2,event:{...end,observedAt:5}}]);assert.equal(tools.get(id)?.status,'clock_conflict');
 db.exec('BEGIN');tools.remove('e');assert.equal(tools.get(id)?.status,'open');db.exec('ROLLBACK');assert.equal(tools.get(id)?.status,'clock_conflict');
 tools.ingest([{rowid:2,event:{...end,kind:'waiting'}}]);assert.equal(tools.get(id)?.status,'open');tools.reset();assert.equal(tools.get(id),undefined);db.close();
});
test('packing identical evidence is invisible; block mutation is conservative',()=>{
 const db=openEventDatabase(':memory:');createPackedEventSchema(db);ensureIngestionJournal(db,true);
 const event=makeEvent('hook','tool_start'),raw=JSON.stringify(event),block=encodeEventBlock([raw]);insertEventRow(db,event.eventId,event.observedAt,raw);
 db.prepare('INSERT INTO at_event_blocks VALUES(?,?,?,?)').run(block.key,block.originalBytes,block.count,block.data);
 db.prepare('UPDATE events SET payload_data=? WHERE event_id=?').run(eventLocator(block.key,0),event.eventId);
 assert.equal(ingestionJournalState(db).sequence,0);
 db.prepare('UPDATE at_event_blocks SET original_bytes=original_bytes+1').run();assert.equal(readIngestionChanges(db,0,10)[0]?.kind,'blocks');
 db.exec('BEGIN; DELETE FROM events; ROLLBACK');assert.equal(ingestionJournalState(db).sequence,1);
 db.exec('DELETE FROM events');assert.equal(readIngestionChanges(db,1,10)[0]?.old?.eventId,event.eventId);
 db.exec('DELETE FROM at_event_blocks');assert.equal(readIngestionChanges(db,2,10)[0]?.kind,'blocks');db.close();
});
test('journal stays bounded and sequence survives pruning',()=>{
 const db=openEventDatabase(':memory:');db.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');ensureIngestionJournal(db,false);
 const event=makeEvent('hook','tool_start');insertEventRow(db,event.eventId,event.observedAt,JSON.stringify(event));
 const update=db.prepare('UPDATE events SET observed_at=?');db.exec('BEGIN');for(let i=0;i<10005;i++)update.run(i);db.exec('COMMIT');
 assert.deepEqual(ingestionJournalState(db),{sequence:10005,firstSequence:6});assert.equal(readIngestionChanges(db,0,20000).length,10000);
 db.exec('DELETE FROM at_ingestion_changes; DELETE FROM events');assert.equal(ingestionJournalState(db).sequence,10006);db.close();
});
test('replacement captures distinct event-id and rowid conflicts',()=>{
 const db=openEventDatabase(':memory:');db.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');ensureIngestionJournal(db,false);
 for(const id of ['a','b']){const e=makeEvent('hook','tool_start',{eventId:id});insertEventRow(db,id,e.observedAt,JSON.stringify(e));}
 const event=makeEvent('hook','tool_end',{eventId:'a'});db.prepare('INSERT OR REPLACE INTO events(rowid,event_id,observed_at,payload) VALUES(2,?,?,?)').run('a',event.observedAt,JSON.stringify(event));
 assert.deepEqual(readIngestionChanges(db,0,10).filter(c=>c.old).map(c=>c.old?.eventId),['a','b']);db.close();
});

for(const packed of [false,true])test(`journal catches separate-connection writes ${packed}`,()=>{
 const folder=mkdtempSync(join(tmpdir(),'ingestion-journal-')),path=join(folder,'source.sqlite');
 const first=openEventDatabase(path);if(packed)createPackedEventSchema(first);else first.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');ensureIngestionJournal(first,packed);
 const second=openEventDatabase(path),event=makeEvent('hook','tool_start',{eventId:'external'});insertEventRow(second,event.eventId,event.observedAt,JSON.stringify(event));
 second.prepare(`UPDATE events SET ${packed?'payload_data':'payload'}=?`).run(JSON.stringify({...event,terminalIncarnation:'new'}));
 assert.equal(readIngestionChanges(first,0,10)[0]?.next?.terminalIncarnation,'new');
 second.exec('BEGIN; DELETE FROM events; ROLLBACK');assert.equal(ingestionJournalState(first).sequence,1);
 second.exec('DELETE FROM events');assert.equal(ingestionJournalState(first).sequence,2);second.close();first.close();rmSync(folder,{recursive:true,force:true});
});
test('tool identity excludes incomplete and distinguishes agent and terminal incarnation',()=>{
 const db=openEventDatabase(':memory:'),tools=new ToolReconciliation(db),start=makeEvent('hook','tool_start',{eventId:'start',provider:'p',hostId:'h',sessionId:'s',terminalHandle:'tty',terminalIncarnation:'old',data:{toolId:'t'}});
 assert.equal(toolIdentity({...start,hostId:undefined}),null);
 const old=toolIdentity(start)!,other=toolIdentity({...start,terminalIncarnation:'new'})!;assert.notEqual(old,other);assert.notEqual(old,toolIdentity({...start,agentId:'child'}));
 tools.ingest([{rowid:1,event:start},{rowid:2,event:{...start,eventId:'end',kind:'tool_end',terminalIncarnation:'new'}}]);
 assert.equal(tools.get(old)?.status,'open');assert.equal(tools.get(other)?.status,'orphan');
 tools.ingest([{rowid:1,event:{...start,terminalIncarnation:'new'}}]);assert.equal(tools.get(old),undefined);assert.equal(tools.get(other)?.status,'complete');
 const before=tools.get(other);assert.throws(()=>tools.ingest([{rowid:1,event:{...start,terminalIncarnation:'new'}},{rowid:NaN,event:{...start,eventId:'invalid'}}]));assert.deepEqual(tools.get(other),before);
 assert.equal(db.prepare('SELECT status FROM tool_executions WHERE identity=?').get(other)?.status,'complete');db.close();
});
for(const packed of [false,true])test(`rowid reuse stays visible and highwater rolls back ${packed}`,()=>{
 const db=openEventDatabase(':memory:');if(packed)createPackedEventSchema(db);else db.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');
 const put=(id:string)=>{const event=makeEvent('hook','tool_start',{eventId:id});insertEventRow(db,id,event.observedAt,JSON.stringify(event));};
 put('historical');ensureIngestionJournal(db,packed);put('maximum');assert.equal(ingestionJournalState(db).sequence,0);
 db.exec("DELETE FROM events WHERE event_id='maximum'");ensureIngestionJournal(db,packed);put('reused');
 const changes=readIngestionChanges(db,0,10);assert.equal(changes.length,2);assert.equal(changes[1]?.next?.eventId,'reused');assert.equal(changes[1]?.old,undefined);
 db.exec("BEGIN; DELETE FROM events; ");put('rolled-back-reuse');put('rolled-back-high');put('rolled-back-higher');db.exec('ROLLBACK');
 assert.equal(ingestionJournalState(db).sequence,2);assert.equal(db.prepare('SELECT max_rowid FROM at_ingestion_highwater WHERE id=1').get()?.max_rowid,2);
 put('increasing');assert.equal(ingestionJournalState(db).sequence,2);db.close();
});

for(const packed of [false,true])test(`journal definitions upgrade transactionally ${packed}`,()=>{
 const db=openEventDatabase(':memory:');try{if(packed)createPackedEventSchema(db);else db.exec('CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at REAL,payload TEXT)');ensureIngestionJournal(db,packed);
 db.exec('UPDATE at_ingestion_sequence SET schema_version=0;DROP TRIGGER at_ingestion_event_update');const old=ingestionJournalState(db).sequence;db.exec('BEGIN');ensureIngestionJournal(db,packed);assert.equal(readIngestionChanges(db,old,10)[0]?.kind,'blocks');db.exec('ROLLBACK');assert.equal(ingestionJournalState(db).sequence,old);assert.equal(db.prepare('SELECT schema_version FROM at_ingestion_sequence').get()!.schema_version,0);
 ensureIngestionJournal(db,packed);const event=makeEvent('macos','activity',{eventId:'move',observedAt:10});insertEventRow(db,event.eventId,10,JSON.stringify(event));const before=ingestionJournalState(db).sequence;db.exec('UPDATE events SET observed_at=20');const change=readIngestionChanges(db,before,10)[0]!;assert.equal(change.old?.indexedAt,10);assert.equal(change.next?.indexedAt,20);assert.equal(change.next?.observedAt,10);
 }finally{db.close();}
});
