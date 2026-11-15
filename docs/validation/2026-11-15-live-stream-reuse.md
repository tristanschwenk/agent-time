# Lot 3: bounded live stream reuse

Implemented a conservative independent stream seam, not per-session agent partitions. Ordered hook updates retain settled human intervals and replay only bounded non-activity evidence through the original reducer. Interval injection occurs at the original chronological emission position, before finalization; complete interval/session/issue arrays, metadata and source IDs remain authoritative. The original timing formulas are unchanged.

Why this narrower scope: native-to-dispatch promotion, tool bindings, background ownership and worker lookahead cross session boundaries. Independent agent partitions are not proven safe. The human stream has only its previous sample as state when new capture fences and clock reorderings are absent. Existing fences/settings and worker observations remain in the fully replayed agent evidence; historical resets use the same optional-map predicate as the original reducer. Agent reduction and final grouping still execute; the optimization removes repeated historical sample reads, decoding, normalization and activity attribution.

Admission/fallback:
- Strictly increasing wall times globally and monotonic times within each epoch. Equal times, late rows, rollbacks, new capture fences/settings, new workers, and non-Mac activity reject reuse and invalidate the day for full recomputation.
- At most 4,096 non-activity source events, 128 epochs, and 4 MiB extra source payload estimate (also limited to a quarter of the day-cache budget).
- Only the latest Mac sample is retained; human interval objects are shared with the existing raw summary. The whole entry, including the reference array, participates in the existing day-cache retained-byte accounting. Oversized entries discard disposable stream state first.
- Terminal payload insertion order is preserved separately from reducer chronological ordering, and latest terminal lookup is applied on each successful append.
- Changed thresholds reject reuse. External corrections remain subject to Collector/store invalidation.

Verification:
- RED: new focused test failed because createLiveSummary/appendLiveSummary did not exist.
- GREEN: four new focused tests pass, with full deep equality after every open/closed transition and each mixed batch; includes same session IDs across providers/hosts, child lifecycle, epochs, background tasks, native promotion, terminal titles, issue ordering, settings, late evidence, fences and retention rejection.
- Direct DaySummaries test observed zero window rereads for six ordered mixed batches, then full rereads for a capture fence and late correction.
- Existing live computation-count regression now uses today's date: historical raw eviction from lot 1 intentionally makes the old 1970 fixture unsuitable for testing the live path.
- Typecheck passed.

Synthetic benchmark (same frozen in-memory evidence, 15 iterations, median; complete output equality asserted): 12,000 human samples + 200 hooks, one appended hook. Full summarize 7.91 ms; stream append 3.00 ms (2.64x). Retained source payloads: 201 (200 non-activity plus last sample). This isolates reducer CPU; no claims about storage/decode I/O timing. Reproduce with `node scripts/benchmark-live-summary.ts`.

No source evidence, user database, release or remote changes. Broader resumable agent reduction remains outside this proven seam.
