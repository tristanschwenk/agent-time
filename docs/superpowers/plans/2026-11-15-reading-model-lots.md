# Four read-model optimizations

**Goal:** Accelerate Review, Reports and live-day reads and reduce stored repetitions without changing calculations or deleting evidence.
**Architecture:** Reuse bounded disposable PeriodProjection, original reducers, and version-1 lossless event blocks. Original SQLite evidence remains authoritative.
**Constraints:** No release/push. Preserve exact typed summaries, report results, identifiers, payload bytes/order, undo and compatibility. Derived cache shares existing 64 MiB/128 MiB admission and evicts before source capture stops. Unknown/changed dependencies use original computation. No timing formula changes.

## Tasks
1. Persist final closed-day Review summaries and persisted-only billing snapshots using existing bounded projection. Cache keys include all source, settings, review, resources and counter dependencies; frozen read transactions must never label another snapshot. Corrupt/missing/full cache falls back. Tests compare full output across restart, late evidence, decisions, settings and external modifications. Do not cache live counters as final historical values.
2. Target dependency validation: durable trigger-maintained resource/report/review revisions and cached window signatures; unrelated samples do not reread/decompress resources/counters or all decisions. External edits and deletes/replacements must invalidate. Existing legacy/read-only database fallback retained. Test external SQLite writes, packing, late evidence and time-based lease expiry.
3. Incremental live-day computation: reuse settled independent reducer partitions for ordered agent evidence, not just activity samples, retaining full replay for fences, late events and unsupported cases. Match full summarize output, interval/session ordering and terminal metadata. Bound retained input and test interleaved providers/hosts, turn/tool open ends, epochs and capture boundaries.
4. Storage dictionaries: improve compression within existing version-1 block format by sharing canonical repeated context for additional event classes, retaining raw fallback for arbitrary JSON. Exact payload strings must roundtrip, old decoder must read new blocks. Benchmark current encoder vs candidate on same representative evidence; no speculative incompatible global schema migration.

## Validation
For each lot add failing regression, implement, focused green test and commit. Run full Node suite, typecheck/build; benchmark cold/warm/restart, live append and codec on identical frozen private copies/synthetic workloads. Report cache disk separately from authoritative evidence. Final independent review required.

## Review focus
- Cache state from a different database/snapshot/timezone must never validate.
- External writes, late events and packing must not cause stale figures.
- Live terminal/counter ends must not freeze.
- Incremental output order affects existing review fingerprints.
- Compression must preserve raw bytes and bounded expansion, including malformed/noncanonical JSON.

Execution: sequential implementation agents with scoped ownership, followed by independent review. User authorized all four lots; no additional confirmation required.
