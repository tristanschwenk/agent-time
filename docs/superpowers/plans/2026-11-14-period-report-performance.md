# Period report performance implementation plan

> Execute inline using superpowers:executing-plans. User explicitly requested implementation without another design approval round. Preserve all results; no release requested.

Goal: reduce 30-day report compute/RAM and show actual day progress. Existing Time baseline: 183–217 s and 690–805 MiB on an isolated 646 MiB database. Keep counting, attribution, policies, reports and exports unchanged. No schema changes or data deletion.

Design: profile frozen copies, remove repeated work at existing seams, keep mathematical reducers and iteration order. Add bounded job progress keyed by UUID, poll it from the retained Time report view; Billing keeps its existing real progress. Progress reaches completion only when the result is ready, and stale responses cannot replace a newer scope. Counters, split decisions, midnight/DST, filtered exports and saved billing snapshots are differential/regression gates.

### Task 1: Remove profiled repeated work

- [x] Profile seven days, record an exact 30-day baseline and peak RSS on fresh clones.
- [x] Lock down counter credits and packed-window equality with tests before edits.
- [x] Index counter ranges once by the existing agent key; update the index when a counter adds ranges, preserving all formulas and ordering.
- [x] Retain the original fingerprint validation on saved reviews; avoid constructing review fingerprints on unmarked days.
- [x] Cache retained-size accounting by summary version and release completed report-only day caches before moving on, without changing the day reducer.
- [x] Optimize packed row reads only if the profile and query plan demonstrate avoidable per-row crossings, preserving row order, decoder bounds and legacy-format behavior.
- [x] Re-run differential baselines and focused tests; commit.

### Task 2: Report actual progress

- [x] Add bounded, read-only UUID progress records for period reports and strict protocol/native validation.
- [x] Emit reading/completed-day/success/failure states from the actual reduction loop; retain legacy callers without progress IDs.
- [x] Poll progress in Time, preserve jobs across navigation, discard stale scope updates, and display completed days/current date with a real progress bar.
- [x] Test polling during work, failures, stale scopes, invalid IDs and retained-page lifecycle; commit.

### Task 3: Prove equivalence and measured improvement

- [ ] Compare complete JSON results, reviewed CSV and all day/project totals for baseline/candidate on the same frozen 30-day history, cold and warm.
- [ ] Check representative Billing reports remain equivalent, including saved report IDs/exports.
- [ ] Run full Node tests, typecheck/build and native bridge tests. Inspect browser loading feedback and navigation on the isolated database.
- [ ] Fresh-context whole-branch final review, fix important findings, document actual timings/RSS and remaining limits. Keep ready for review; do not publish without a new request.
