# Ingestion reconciliation and persistent credited periods

Validation date: 2026-11-15. Baseline: `774c412`. Implementation does not alter the billing engine, original timing reducer, sleep/pause rules, source payload codec or recorded evidence. No release or publication is part of this change.

## Measured first-report result

Frozen coherent SQLite backup of the local profile: **1,602,946 events**. CAEX, **2026-10-16 through 2026-11-14**, fixed measurement clock 2026-11-15T12:00Z, existing settings and project ownership. Each report runs in a fresh Node 26.9 process. Delete only the derived display cache before measuring; retain the ingestion model. The baseline code never reads that new model. Both calculate the report without a saved report ID; existing saved reports are looked up only after calculation and content hashing.

| Measurement | Baseline | Persistent ingestion periods |
|---|---:|---:|
| First report, isolated rerun | 43,640 ms | 136 ms |
| Peak process RSS | 1,070.25 MiB | 135.89 MiB |
| Complete JSON reply | 21,302 bytes | 21,302 bytes, exactly equal |

Approximately **321× faster**, **87.3% less peak report RAM**. Initial run while tests also ran: 47,160 ms /972.55 MiB; first candidate run 130 ms /135.45 MiB. These are local measurements, not latency guarantees on every Mac. The retained report calculations and output are identical, including daily values, totals, warnings and saved-report identity.

This is the first report **after evidence preparation**, not elimination of historical work. One-time history preparation took **78.81 s**, with **474.98 MiB peak RSS**, under a **256 MiB old-generation heap limit**. It indexed all 1,602,946 events and prepared 38 project days, 14,008 credited spans and 174,693 tool identities. On-disk model: **130.18 MiB** initially. The heap limit is not an RSS limit: SQLite, buffers, runtime and other V8 memory also contribute.

Preparation runs in a separate worker, in resumable metadata batches (up to 32,768 events, internal chunks of 4,096) and one project day at a time. The app does not wait for that worker to save proof events. If a requested day is not prepared yet, the original calculation remains available. Existing history therefore still has a first-upgrade backfill cost; ordinary future capture maintains affected periods rather than repeatedly scanning the history at report time.

## Targeted late-data verification

On the same private copy, append a controlled start/end pair dated 2026-10-20. Exactly **3 days** became dirty: October 19, 20 and 21, matching the original agent lookback/lookahead margins. They were rebuilt in **6.20 s**, with **433.95 MiB peak RSS** under the same heap limit. The other **35 prepared days retained their exact digests**. A fresh report after this update took 158 ms; its complete JSON reply equals a fresh baseline computation against the modified evidence.

Before and after initial preparation, byte-level hashes and row counts of all source events, packed blocks, human decisions and splits were identical. The source holds both tool boundaries; the derived index never substitutes its physical start/end duration for the original credit reducer. Full private replies and profile copies are not committed. Aggregate results and proof digests are in the adjacent JSON file.

## What is persisted

`events.sqlite` remains authoritative. SQL triggers maintain a compact transactional mutation journal (10,000 retained entries, monotone sequence) and rowid highwater; normal increasing appends use a resumable cursor. Logical updates, deletes, replacements, reused rowids, human assignments/splits and changed packed blocks are tracked. Identical logical repacking does not invalidate credited periods. Journal writes roll back with source transactions.

`ingestion.sqlite` is separate from the evictable display cache:

- Tool identity is provider, host, session, tool ID, agent and terminal incarnation. Each identity is interned once with an integer key. Typed boundary rows preserve IDs, source row references, both clocks and collector epochs. Persisted states distinguish open, orphan, complete, ambiguous and clock-conflict executions. Missing identities cannot collapse together.
- Project/day slices contain typed credited spans, shared contexts, compressed non-span metadata and the original filesystem dependencies. Only exactly adjacent spans with identical billing contexts coalesce. No gaps are filled and no source evidence is removed.
- Dependencies cover sample margins, agent windows, relevant historical session contexts, task-start references, normalized resource URLs and attribution pairs. Configuration keys cover all project ownership, timezones and measurement thresholds. Commercial policies still run through the unchanged engine, so changing a rate does not require replaying proof events.
- Reports validate source identity/inode, committed append and mutation cursors, configuration, clock validity, filesystem dependencies and a content digest. Pinned older source snapshots cannot use or overwrite a newer model. Stale, missing, corrupt, unavailable or full models fall back to the original calculation.
- Closed days persist across restarts. Live inputs are reused only when all relevant spans/exclusions have settled, with explicit expiry at future proof boundaries (including an event exactly at the preparation clock), coverage expiry and midnight. Open live intervals use the original calculation.

A mutation targets its dependent days. New ownership/settings invalidate corresponding configuration; path changes invalidate affected prepared inputs on access. A pruned journal gap, source replacement or changed compressed block conservatively rebuilds rather than guessing. Deleting the newest event can lower max(rowid); its newer mutation sequence permits ingestion to resume, while genuinely older pinned snapshots are rejected.

## Capacity and compatibility

The sidecar has a **256 MiB physical SQLite page cap**, a 2 MiB page cache, no mmap, disk-budget accounting and admission that leaves **1 GiB free** plus conservative rollback/growth headroom. The optional tool index reserves capacity for credited periods: at 192 MiB of used pages, or before an incoming batch could exceed its allowance, it clears and disables the entire optional index atomically. It does not retain partial identities that could conceal earlier duplicates. Credited-period preparation continues from original proofs; `toolIndexAvailable` exposes the state. A fresh source epoch/rebuild can re-enable the index. This deliberately favors correct credited periods over unlimited secondary tool history.

The source journal is additive. The sidecar is rebuildable, versioned independently and upgrades the earlier duplicated tool schema without touching proofs or decisions. Compaction verification excludes only the new derived journal bookkeeping, not user tables. Existing archive/compaction safeguards remain active. Storage-pressure recovery can discard the derived model; later reports then fall back until it has been rebuilt.

The new model uses extra disk space to avoid repeated computation; it does **not** claim to shrink the authoritative proof database. Capacity refusal never authorizes deleting evidence. The immutable source still needs the existing bounded packing/retention controls for long-term disk usage.

## Checks and reproduction

Focused tests cover full-report equality with no display cache, all four billing bases, second/minute counting, presence gates, caps and rounding; cross-day late boundaries, review edits, old contexts, unrelated URLs/dates, changed configurations, corrupted spans, exact-clock evidence, pinned readers, source-row deletion/reuse, physical timestamp corrections, transaction rollback, worker restart, migration and oversized batch capacity fallback. The worker test confirms the request event loop continues while preparation runs.

Use `scripts/benchmark-ingestion.ts` on an owned frozen copy. `clone COPY SOURCE` opens the source read-only and marks the private copy. `proofs COPY PREFIX` hashes its evidence tables. `ingest COPY PREFIX` runs bounded preparation (invoke with `--max-old-space-size=256` to match the worker). `report COPY PREFIX CODE_ROOT [EXPECTED_REPLY_JSON]` measures a first calculation and optionally compares the full private reply. For baseline code, extract commit `774c412` into a private code directory; delete the copy's display cache between runs, never its ingestion model. Environment overrides: `AGENT_TIME_BENCH_AS_OF`, `AGENT_TIME_BENCH_FROM`, `AGENT_TIME_BENCH_TO`.

Final gates: **782 tests passed** in the complete suite, then **58 focused tests passed** after the final trigger-upgrade and concurrent-read fixes (including compaction, archive, store and storage accounting). Production build/typecheck passed; Vite retained its existing large-chunk warning. Independent review found no remaining actionable issues. Final reusable-script smoke test: **137 ms /132.64 MiB**, complete reply equal, **no display cache created**. Owned frozen database copies and full private replies were removed after validation; scripts and aggregate results remain.
