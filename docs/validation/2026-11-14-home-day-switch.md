# Home day switching measurements

Measurement only; no product code or timing rules changed. Current implementation: `5978f88`, compared with beta.57 source `817942b`. Same isolated 631.5 MiB history containing 1,512,772 observations, with task counters enabled and capture paused. No live database, hooks, installed app or user decisions changed.

## Visible Home response

Local browser preview, Chrome IAB, 659×965 viewport. A temporary ignored Vite transform measured the selected-day watcher through two animation frames after the summary became ready. Only the first ready mark for each navigation counts; later five-second polls are excluded. No arbitrary sleeps or tool-call durations were used as the measurement clock. The native Mac WebView was not benchmarked.

| Selected day | Visit | Until Home graphs/numbers ready | Summary fetch/response | Payload |
| --- | --- | ---: | ---: | ---: |
| 2026-11-07 | First | 3.561 s | 3.139 s | 11.62 MiB |
| 2026-11-12 | First | 3.340 s | 2.047 s | 13.07 MiB |
| 2026-11-06 | First | 3.084 s | 2.704 s | 8.85 MiB |
| 2026-11-12 | Return after another day | 1.843 s | 1.315 s | 13.07 MiB |
| 2026-11-07 | Return after other days | 3.776 s | 3.352 s | 11.62 MiB |

The 12 November first load also waited about 698 ms before starting its fetch. The remainder after the summary response is roughly 0.38–0.60 s in these samples; first-day scheduling contributes to the total too. This is not a complete main-thread CPU profile, but the majority of the observed wait precedes rendering.

## Collector calculation, independently of browser

Each implementation ran the sequence 07 → 12 → 06 → 12 → 07 → 07 November in one Collector process. Fresh in-memory caches; the OS disk cache was not purged. The harness discards each result graph before the next navigation and does not parse client JSON inside the collector process. Baseline/current complete summary hashes match for all six calls after excluding their random transport tokens.

| Day/visit | beta.57 computation | Current computation | Raw day recomputed? | Current JSON encoding |
| --- | ---: | ---: | --- | ---: |
| 07 first | 4.138 s | 2.554 s | Yes | 46 ms |
| 12 first | 1.551 s | 1.402 s | Yes | 63 ms |
| 06 first | 2.883 s | 1.848 s | Yes | 30 ms |
| 12 return | 1.222 s | 1.022 s | Yes | 60 ms |
| 07 return | 3.795 s | 2.157 s | Yes | 33 ms |
| 07 immediate reread | 1.113 s | 0.912 s | No | 41 ms |

A particularly busy day still sends 33,383 intervals and 290 sessions. These are the existing bounded-window payload contents, not newly collected data.

## Memory and causes

Collector process peak RSS over this sequence is approximately 714 MiB before and 705 MiB after. This single pair does not establish a meaningful Home memory improvement; budget around 700 MiB for this workload. Browser JavaScript heap samples were approximately 84–94 MiB; that is not the renderer's complete RSS or peak. The monthly report improvement should not be advertised as a comparable Home memory reduction.

Observed causes:

1. These raw day graphs exceed the existing cache budgets. The cache retains only the current raw day in this sequence, so every return after another day recomputes it. KeepAlive preserves the page instance, not all previously selected day datasets. The immediate same-day reread does reuse its raw day.
2. Opted-in task-counter evidence costs 0.71–0.91 s per read on 06/07 November. On the immediate reread, 911 ms of the 912 ms computation is `reportedWork`, despite no raw summary recomputation. `daySummary` loads that evidence before checking its derived memo. Home additionally requests the reported-work list for its separate declarations block; the optional list is not awaited for summary loading, but both requests share the collector.
3. Every date change downloads the whole 8.85–13.07 MiB summary again. Version tokens avoid a repeat download for unchanged polling of the current date, but `store.ts` clears the selected summary/token on date navigation.

Next useful work would be a bounded per-day derived/aggregate cache with evidence-aware invalidation, reuse of task-counter evidence within a refresh, and a lighter Home response with details loaded on demand. These are findings, not changes made during this measurement task. Counting and attribution must remain identical.

Aggregate timings, stage measurements, retained-day lists and result checksums are in `2026-11-14-home-day-switch.json`. Temporary database clones and the measurement preview are removed/stopped after collection; private harnesses remain ignored under `.capture/home-switch`.
