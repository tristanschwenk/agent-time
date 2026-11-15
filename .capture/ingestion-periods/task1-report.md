# Task 1: ingestion journal and tool execution projection

Implemented only new journal/reconciliation modules and their dedicated tests. No user database was opened or changed.

Journal source tables: `at_ingestion_sequence`, `at_ingestion_changes`. SQL-only triggers record compact OLD/NEW identity and time metadata, review OLD/NEW interval pairs and conservative packed-block changes. Source appends remain on the separate rowid ingestion cursor. Packing identical payloads emits no mutation. Sequence survives pruning and the journal retains at most 10,000 rows. Replacement records both conflicting original events when rowid and event ID target different rows. No new SQLite function or reader contract is required.

Sidecar tables: `tool_boundaries`, `tool_executions`. Ingestion/removal reconciles only touched identities within savepoints; reads fetch the persisted execution. Both original proof IDs, rowid references, times, collector epochs and monotonic times remain present. Provider, host, session and tool ID are required; agent, terminal handle and incarnation distinguish identities. Ambiguous boundaries do not pick an arbitrary pair; clock conflicts do not become completed tools. Missing boundaries remain open/orphan. Source evidence is unchanged.

Validation: `node --test tests/ingestion-journal.test.ts` passes all 9 tests on Node v26.9.0. Covers legacy/packed mutations, replacements, packing, block invalidation, review key updates, journal pruning and monotone sequence, separate writer connections, rollback, replay, late arrivals, identity changes, clock conflicts and persisted execution records. Initial execution failed on Node's unsupported parameter-property syntax, which was removed; subsequent focused runs pass. `npx vue-tsc --noEmit` produced no errors at the time run.

Integration requirements: install journal only on writable EventStore source connections after review table creation. Sidecar reset should call `ToolReconciliation.reset()`. Missing/pruned journal history must force conservative rebuild in the ingestion model. Read-only clients need not install these triggers or tables.
