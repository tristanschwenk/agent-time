# Storage audit corrections

Goal: fix A01–A11 from `.capture/storage-audit/consolidated.json`, preserving authoritative proofs and all timing/billing formulas, with regression tests, bounded performance comparison and a fresh independent review before preparing a release. No publication authorized by this request.

## Safety constraints
- Synthetic fixtures/owned copies only; no real profile mutation, evidence deletion or opportunistic history cleanup.
- Preserve existing rollback archives, manual backups, saved reports and source-calculation fallback.
- No counter/timing/billing reducer changes. Keep source/configuration/timezone/path invalidation correct.
- Files owned by separate implementers must not overlap; main thread integrates and reviews.

## Ordered tasks
1. A01/A02: archive WAL self-containment and concurrent-writer protection in archive-storage.ts/storage-migration.ts. Reproduce existing lost-WAL fixtures first; refuse unsafe candidates/compression rather than mutate an external live archive. Regression tests for closed/gzip archive, crash WAL, changes during preparation/compression and replacement rollback.
2. A06: explicit Stop cancels storage auto-resume independently of running/lock state; internal storage stop/close retain their contract. Collector regression covers blocked/compressing/relaunch cases.
3. A07/A08/A09: recover only proven abandoned owned export/compression staging; count billing-exports in fast/detailed usage; select real pause cause in UI. Preserve live workers, archives, exports and symlink rules. Tests for lifecycle/accounting and cause rendering.
4. A03/A04: ingestion discovers dates from surviving journal events and supports all valid rowids on initial/rebuild scans. Tests far-date correction, reused rowid, negative/zero/positive data, replay and pinned snapshots.
5. A05: legacy Review backlog signature follows effective resource expiry/source dependencies without replaying all raw days. Regression parity with direct review after expiry/correction/restart.
6. A10: bound/cache historical date registration by source buckets, project configuration/timezone and local-day changes. Avoid repeated idle registration and preserve ownership invalidation and late history discovery. Measure the same 1,095-day/10-project fixture before/after.
7. A11: remove repeated non-hook tail scan using compatible bounded cursor/index handling. Preserve native hook/session identity, late appends, restored/compacted sources and legacy support. Measure actual packed 200,001-row fixture before/after.
8. Run affected/full suites and build, prove unchanged report/evidence behavior, fresh independent whole-change review, address findings and rerun relevant checks. Record per-finding closure and performance/RAM evidence. Only then prepare release notes/version candidate; do not publish.

## Completion ledger
- Baseline: fdc0622, audit reproduced 11 findings; prior representative performance numbers are fixture-specific.
- All eleven findings corrected with regression coverage; native archive picker bypass also closed at c36ca0c.
- Independent storage/native and ingestion/performance reviews completed without confirmed blockers.
- Final 830 JavaScript tests, 38 native tests, production build/typecheck and packaged archive helper smoke passed; 100 packaged modules match source.
- Paired operation benchmarks and limitations recorded in docs/validation/2026-11-16-storage-audit-fixes.md, including the observed RSS increase.
- beta.59 candidate prepared locally after verification; publication remains a separate action.
