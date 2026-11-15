# Storage and data audit corrections — 2026-11-16

Scope: close the eleven reproduced findings, preserve original proof events and timing/billing formulas, independently review the integrated changes, then prepare a local release candidate. No publication is part of this request. Tests use synthetic databases or owned scratch copies; no customer profile is modified.

## Closure

| ID | Correction | Regression evidence |
| --- | --- | --- |
| A01 | Reject plain restore/import archives with active committed WAL or rollback journals; retain exclusive SQLite guard through verification and replacement. Native file-picker staging uses the same guarded worker. | WAL-bearing archive rejected without losing committed evidence; closed/gzip imports and rollback paths preserved; native picker regression. |
| A02 | Hold SQLite writer exclusion throughout compression, byte verification, publication and original removal. | Concurrent compliant writer cannot commit unnoticed; mutation/failure preserves original. |
| A06 | Explicit Stop revokes storage auto-resume even when capture is already stopped. Internal storage stop retains recovery intent. | Blocked/compressing/relaunch intent tests and unchanged proofs. |
| A07 | Export, compression and native staging use private directories with process ownership locks; reclaim only proven abandoned owners. | Real killed export/compression/import workers recover staging; live/malformed/manual files preserved. Legacy unowned flat temporary files remain intact and are now visible in storage usage. |
| A08 | Storage UI distinguishes low disk, quota and incomplete measurements. | Pause-cause rendering tests, including conflicting/stale measurements. |
| A09 | Count billing exports in both fast quota checks and detailed storage usage exactly once. | Accounting and symlink exclusion regressions. |
| A03 | Journal-only correction and reused rowids discover both logical event dates and physical observed dates. | Far-date relocation, reuse, correction and pinned-source tests. |
| A04 | Separate an unstarted ingestion cursor from rowid zero; rebuild accepts negative and zero rowids. | Mixed/negative-only rowids, deletion, discard, journal gaps and schema-2 migration. |
| A05 | Review backlog uses effective resource/source/review dependencies, including resource expiry. | Clock advance plus restart produces the same backlog/direct review result and unchanged evidence. |
| A10 | Persist bounded historical-date registration cursors and skip unchanged idle registration. | Restart, late buckets, ownership/config/timezone/day changes, large idle windows and worker completion. Exact date-set parity asserted. |
| A11 | Add packed and legacy partial hook indexes to avoid repeatedly scanning non-hook tails. | Hookless/packed/legacy tails, appends, restore, compaction and earliest child timing parity. |

## Measured performance

Measurements isolate the identified redundant operations; they are not end-to-end report or Home loading benchmarks.

| Operation / fixture | Before | After |
| --- | --- | --- |
| Idle date registration; 1,095 days, 10 Europe/Paris projects | 1,063–1,081 ms | 8.32–9.39 ms |
| Initial date registration, same exact 11,000 keys | 8,204.95 ms | 1,685.09 ms total over 86 batches; maximum batch 34.12 ms |
| Warm usage polling; one hook plus 200,000 foreground rows | 6.24–7.14 ms | 0.032–0.053 ms |
| Warm usage polling; no hooks | 8.28–10.60 ms | 0.027–0.035 ms |

Registration peak RSS was **132.77 → 135.97 MiB**, so this run shows no RAM reduction. Earlier after runs approached 146 MiB; process lifetimes/call counts differ. Registration metadata was marked ready only after complete registration to isolate idle cost: this is not a benchmark of credited-history computation. Source event count and exact registered date keys are checked. Default bounds are 128 project/bucket pairs and 896 candidate dates per batch, including persisted within-bucket offsets.

Hook index construction still scans existing history once (~9.3 ms in this fixture). Reopen/new-hook covered-count validation remains (~8–10 ms for 200,002 rows). First indexed call was 8.44 → 8.75 ms; the gain is subsequent polling, not first setup. Neither benchmark establishes a universal memory or user-interface latency guarantee.

Reproduction: `node scripts/bench-ingestion-registration.ts`; recorded paired measurements and logs under `.capture/storage-fixes/registration/` and `.capture/storage-fixes/usage/`.

## Preservation and compatibility

The timing reducer and billing engine have no changes relative to fdc0622. Full-result parity and original proof comparisons are exercised by existing and added regressions. Saved reports and manual archives are retained. Ingestion schema 3 can require a one-time derived-history rebuild; source proofs remain unchanged and existing calculation fallback remains available. External live SQLite archives with journals are refused rather than silently copied without their committed changes. Writer exclusion covers SQLite-compliant writers; it is not a guarantee against hostile direct filesystem writes.

Legacy unowned temporary files cannot safely be proved abandoned and are not deleted automatically. The UI reports their size and folder. New owned staging is safely recoverable after process death.

## Final validation

- First integrated pass: 826 JavaScript tests passed. The final integrated pass including the new native-picker helper regressions passed **830 tests**, zero failures, in 364.16 seconds.
- Production typecheck/build passed after the helper change. Vite retains the existing >500 kB chunk-size warning; it is not an audit regression fixed here.
- Native suite: 38 passed with the normal parallel command after integration. An earlier run under concurrent heavy test load failed one unrelated collector-restart timing assertion; serialized rerun and the final standard rerun both passed all 38. No restart behavior was changed to hide that failure.
- Sidecar packaging succeeded. All 100 capture/usage/MCP TypeScript modules recursively match current sources. Packaged Node and the new import helper preserved exact SQLite bytes in an isolated smoke test. This is not a signed/notarized application release or manual UI validation.
- Independent storage review found no confirmed blocker; the final c36ca0c native/helper integration was reviewed separately, including packaging and bounded worker output. It did not execute a packaged app. Slow/removable-storage timeout behavior remains untested; the worker has no new deadline.
- Independent data review found no blocker in A03/A04/A05/A10/A11; ran 31 targeted tests, independent mixed-rowid/journal/date checks, then checked final A10 bounded idle-window behavior and final 19-test integration. Its initial written review predates the final commit; final follow-up confirmed 1d23a99.
- No source proof database, timing reducer or billing formula was edited. The final JavaScript suite passed before beta.59 candidate preparation.

## Local release candidate

beta.59 version agrees across package, both lockfiles, Tauri and Cargo. After the version bump, 22 release/update regression tests passed, production typecheck/build passed again, and sidecar/widget packaging completed for beta.59. These local resources are not a signed distributable. No push, publication workflow, updater promotion or customer installation was performed.
