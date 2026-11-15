# Ingestion reconciliation and persistent credited periods

Goal: keep tool reconciliation and prepared credited-period inputs current as evidence arrives, so a first report does not replay history. Preserve original evidence, reducer/billing results, clock semantics and fallback.

Architecture: a separate bounded `ingestion.sqlite` read model, maintained off the capture request thread. Source event writes stay authoritative. A bounded transactional source change journal covers logical updates/deletes/replacements and review corrections; append ingestion uses a resumable rowid cursor. Source packing with identical logical payload does not dirty periods. Derived tools are conservative identity-complete boundary matches; the existing reducer remains the credit authority. Persist the original prepared billing input as typed period rows plus compressed metadata and filesystem dependencies. Reports may use it only against their pinned source snapshot/configuration/clock. UI caches are independent.

## Constraints
- No source-event deletion, format contraction, formula or billing policy changes; no publication.
- Missing/stale/corrupt/full projection falls back to the original calculation. Saving evidence must not depend on successful preparation.
- Existing history requires a measured one-time backfill, explicitly separate from first-report latency; no claim of eliminating that work.
- Metadata scan and recalculation batches yield and run off the main request thread; restart/cancellation are resumable.
- Entire source epoch/inode identity and logical mutation/review cursors must match. Pinned older snapshots never consume a newer materialization.
- Target ordinary appends by sample/agent window, resource +/-31-day window, native session metadata and referenced task IDs; review pairs target their evidence times. Missing pruned journal history or block mutation conservatively rebuilds.
- Original full reports/proofs compare equal; new sidecar participates in storage accounting and leaves >=1 GiB plus capture budget headroom.

## Task 1: transactional change journal and tool execution index
Files: new capture/ingestion-journal.ts and capture/tool-reconciliation.ts; dedicated tests. No edits to Collector/store/integration yet.
API journal: IngestMeta (eventId/source/kind/observedAt and optional provider/hostId/sessionId/agentId/terminalHandle/terminalIncarnation/toolId/taskCounterId); ingestionMeta(CaptureEvent); ensureIngestionJournal(db,packed); ingestionJournalState(db) -> {sequence,firstSequence}; readIngestionChanges(db,after,limit) -> {sequence,kind:'event'|'review'|'blocks',old?:IngestMeta,next?:IngestMeta,pairs?:[string,string][]}[]. Keep at most10,000 entries with monotone sequence table, no AUTOINCREMENT. Ignore logically identical packing updates; capture replacement BEFORE INSERT, changed/deleted events, decision/split keys including one-sided updates, block UPDATE/DELETE. No full payload duplication. SQL-only triggers compatible with existing registered payload readers.
Tool API: ToolReconciliation(db), ingest(rows:{rowid,event:CaptureEvent}[]), remove(eventId), get(identity), reset(). Identity complete provider/host/session/toolId plus agent and terminal identity; unique start+end pairs, orphan/open/ambiguous/clock_conflict explicit. Keep both original IDs, times and rowid refs; never fabricate completion. Idempotent replay/update and transaction rollback tests.
RED -> GREEN focused tests; commit owned files; no subagents.

## Task 2: materialized periods and targeted maintenance
New ingestion-model.ts plus integration in billing-service/data: durable typed credited_periods and metadata, bounded source ingestion cursor, dependency relations and dirty slices, configuration/filesystem guards. Reuse computeDayInput and original billing engine. Prepare completed days; support safe live reuse only with explicit clock expiry/partial-end validation, otherwise original current-day computation. Ordinary appends must leave unrelated prepared dates clean. Export bounded prepare/backfill API for worker/benchmark, never save unsolicited billing reports.
Tests: first report after ingestion with UI cache deleted; complete report equality; late end/start, adjacent days, review, project ownership/settings/filesystem changes, pinned transaction, missing/old/corrupt state and capacity; unchanged day rebuild counts zero.

## Task 3: capture lifecycle and storage
Wake background ingestion after source writes, poll external writers, resume historical backfill in bounded slices, cancel/close cleanly. Status exposes actual ingestion/backfill progress/error. Accounting includes sidecar and journals; optional preparation pauses rather than blocking capture or filling disk. Legacy source journal may be absent for standalone read-only clients: fallback.

## Task 4: proof, performance, review
Run full tests/build and independent correctness review. Frozen private DB: exact baseline report plus first report after ingestion with derived UI cache removed; record backfill/ingestion cost, subsequent targeted work, time/RAM and storage separately. Delete only owned private DB copies after validation. Commit technical validation artifact; no release.

## Completion ledger

- Tasks 1-3 implemented: transactional journal, normalized tool index, dependency-scoped credited slices, source-pinned lookup, background lifecycle and capacity accounting.
- Ruling: raw reducer remains the authority for credits, including ambiguous/missing/late tool evidence; the index never replaces its duration rules.
- Ruling: reserve capacity for credited periods by suspending the entire optional tool index rather than pruning partial identities; proofs remain untouched.
- Validation and measurement complete: 30-day first report 43.64 s to 136 ms, peak RSS 1070.25 to 135.89 MiB; initial backfill 78.81 s/474.98 MiB; late pair rebuilds 3 days, 35 unrelated days retained. See docs/validation/2026-11-15-ingestion-periods.md and JSON.
- Independent review corrections covered newest-row deletion, exact-clock expiry, normalized-index migration, oversized batches, transactional trigger upgrades and pinned tool reads.
- Full suite: 782 passed; final regression/storage/archive subset: 58 passed; build passed. No release/publication.
