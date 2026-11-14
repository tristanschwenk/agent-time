# Persistent periods and compact Home

Approved by the user's explicit go following the Timing database comparison. Preserve original evidence and reducer/formulas, attribution, filtering and chart results. No release.

Design: separate disposable derived SQLite read model, schema-versioned and bounded, containing ordered periods with typed endpoints/state and shared contexts; proof IDs stored separately and loaded only for full-detail reads. Persist reducer window output before mutable review/resources/counter credit, so those are still applied freshly. Closed dates only; today remains live. Stable signature includes exact evidence-window row metadata, durable update/delete generation, terminal evidence, options and timezone/bounds. Corrupt/unavailable/old derived data falls back to reducer, no effect on source DB.

Home endpoint compacts exact intervals by removing proof IDs and merging contiguous intervals only with identical display/filter metadata. Preserve all scalar durations, sessions, issues and confidence proof-presence; exact review counts computed from original evidence. Full details are fetched before assignment/inspection/expanding project or human detail. Review/Reports retain full transport. Guard navigation and scope changes; show loading and retryable detail errors. Existing clients retain summary endpoint.

### Task 1: Persistent model
Tests first: exact roundtrip/order/undefined, restarts avoiding reducer, new/late evidence and update/delete invalidation, terminal/options/timezone, bounds, corruption/failure, disk budget. Lazy cache initialization; rollback is ignore/delete derived database, originals untouched.

### Task 2: Compact Home and lazy details
Tests first: exact time and filtering/chart equivalence; small transport; full proof detail restore; protocol validation, native bridge whitelist, navigation races, Home/full mode switching and review edits. Do not fabricate proof IDs.

### Task 3: Verification
Same frozen history baseline/current, first-process read and restart, payload, latency/RSS and complete-result fingerprints. Full tests/typecheck/build, packaged bridge smoke, fresh-context final review. Record limits and clean owned DB clones. No release.
