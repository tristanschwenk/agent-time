# Thirty-day report performance

Status: implemented on `codex/period-report-performance`; not released.

## Method and first results

Frozen, isolated 631.5 MiB SQLite copy with 1,512,772 observations. Capture stayed paused; hooks, the live database and user configuration were untouched. Same settings, including opted-in task counters, and local Europe/Paris period 2026-10-14 through 2026-11-12 (30 active calendar days, spanning DST). Node 26.9.0 on the same Mac. Baseline source: `817942b` (beta.57). Fresh Collector/report caches; OS file cache was not purged. Time starts after Collector construction; peak RSS includes construction and is process-wide. These are local measurements, not resource limits or universal guarantees.

| Report | Before | After | Peak RSS before | Peak RSS after |
| --- | ---: | ---: | ---: | ---: |
| Time, all projects, 30 days | 171.783 s | 43.044 s | 796.9 MiB | 733.3 MiB |
| Billing, configured project, same 30 days | 59.349 s | 53.650 s | 742.4 MiB | 687.5 MiB |

Time improvement: 74.9% less calculation time, 8.0% lower peak RSS in this pair. Billing: 9.6% less time, 7.4% lower peak RSS. RSS varies with garbage collection; there is no artificial GC call or raised heap allowance. Repeated same-process runs are recorded separately below.

## Repeated same-process runs

| Run | Baseline time | Candidate time | Baseline process peak RSS | Candidate process peak RSS |
| --- | ---: | ---: | ---: | ---: |
| First report in fresh process | 167.636 s | 43.605 s | 756.6 MiB | 709.7 MiB |
| Immediate repeat, same Collector | 170.372 s | 41.262 s | 758.7 MiB | 721.3 MiB |

All four complete results match the baseline exactly. Each process peak is cumulative, including the preceding run. The same-process repetition confirms roughly fourfold speedup and 5–8% lower peak RSS across the measured pairs; it does not claim instant cached reports. Aggregate machine-readable evidence is in `2026-11-14-period-report-performance.json`.

## Changes

- Index measured ranges once per existing agent identity when crediting task counters. Preserve raw overlap sums, peer ordering, minute credits and the order in which counters add ranges.
- Skip session-end scans on days with no hydrated task starts. Context declarations cannot use those endings; days with counters retain the original end-evidence bounds.
- Build reviewed-day fingerprints only for saved reviews. Saved reviews keep their original complete validation path, including stale and legacy fingerprint checks.
- Memoize cache-size accounting per day version; release report-created day caches after accumulation, retaining preexisting interactive caches within their existing budgets. The day generator no longer holds the previous summary across its yield.
- Read matching packed payloads through one ordered stream, replacing a payload lookup per row. SQLite filters/materializes only row IDs; decoding remains in JavaScript in insertion order. The plan uses the timestamp index for IDs and integer primary-key lookup for the outer stream. Legacy/raw format and decoder limits are unchanged.
- Keep reducers, counting formulas, project attribution, local-midnight clipping, rounding, policy versions and stored observations unchanged. No schema migration or data deletion.

Two alternative agent-report queries were tested and discarded: they produced the same results but took 114.3 s and 101.7 s for Time, compared with the simpler 97.8 s intermediate candidate. The final improvement comes from removing unnecessary session-end scans; no agent-report query change remains.

## Real progress and navigation

The optional UUID on `period_review` exposes read-only `period_review_progress`. It counts days actually reduced, publishes the next calendar date between days, and finishes only once the result is ready. Failures retain the actual completed count. At most eight small progress records are retained, with terminal expiry; no events/results are stored there. Legacy callers remain supported.

Time polls every 500 ms after the previous poll settles. Progress survives KeepAlive navigation and is also visible in the bottom bar; clicking it returns to Time. Old requests/polls cannot replace the result or progress for a newer scope. Poll failures do not fail the report itself. No localStorage page state was introduced.

Native validation rejects foreign fields and non-UUID IDs. Period computation now uses the same 15-minute long-request allowance as Billing, fixing the previous 45-second desktop deadline; progress/status calls keep their short deadline.

The progress unit is a completed day, not a fabricated timer percentage. A particularly busy single day can take longer, and the count will wait while that day is being read. Other collector work can run at the day boundaries.

## Equivalence and verification

- Complete Time JSON before/after is deeply equal, including every project/day, reviewed entry, totals and filter options. SHA-256: `bce83f2a3c0e0a30ce70da31e7272f7b596c19938536f76f00d30217db433006`.
- Exact stored-event/sequence hash before and after: `70905d08ed3d03516fbdaaef6e01875cdb5dd9bd447563e935593454448dc53d`. All 1,512,772 observations, human decisions, splits, day reviews, billing project configurations and existing saved reports are unchanged.
- Reviewed CSV SHA-256: `11dae84e0c16fc2fa66ed7053d870b2db97a076b181dfe2eff8ec808307b197f`.
- Billing report contents are deeply equal except the expected new-run `createdAt`. Report ID and exported CSV are identical. CSV SHA-256: `e2a1c9e35a1bc2dd2505221729878d0bc789822b46fa2f844372b7d8f9d1c621`.
- Full Node suite: 701 passed. Native bridge: 36 passed. Typecheck/build, sidecar packaging and a packaged-Node period/progress smoke passed. Existing build warning about the main bundle exceeding 500 kB remains.
- New regressions cover many counters, raw insertion order, saved/stale review handling, cache release/accounting, absent counters, real progress before/between days, failure, reused/invalid IDs, bounded records, stale UI polls and navigation.
- Browser on the isolated history: observed 3/30, Settings while the bottom bar reached 13/30, return to Time at 17/30, then completed daily/project results with the reviewed export available. Capture remained paused.

Fresh-context whole-branch review found no actionable findings or declined items; independent focused verification passed 37 tests.

Temporary database clones were removed after the final comparisons to reclaim test disk space. Full result JSON, the CPU profile and run logs remain in ignored `.capture/period-performance`; only aggregate evidence belongs in Git. The original database and the earlier UI preview were untouched by this cleanup.
