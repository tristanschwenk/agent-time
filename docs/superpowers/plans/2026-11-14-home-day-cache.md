# Home day cache and counter evidence reuse

User approved bounded lightweight per-day caching and counter evidence reuse, exact results, before/after timings/RAM. Follow-up storage comparison is delivered in `docs/validation/2026-11-14-timing-comparison.html`. Implement the original cache request inline; the larger persistent projection/normalization proposals remain separate.

Design: compressed, bounded in-memory snapshots of closed-day summaries, validating exact evidence-window metadata, review/external revisions, settings, resources and freshly evaluated counters. Preserve transport tokens for unchanged validated snapshots. Release only report-created raw graphs once a closed-day snapshot is stored. Reuse SQL counter evidence across reads, while recalculating leases/status/end bounds with current clock, and invalidate on new declarations/session endings, external edits or clock changes. Today/future days retain the existing live reducer path.

Client: a small compressed in-memory day cache, never localStorage; validate its token with the collector before displaying it. Preserve stale-response guards. No schema migration, collection change, timing formulas, data deletion, productivity scores or release.

### Task 1: Backend
 tests first for exact snapshots, revisits, unaffected capture, corrections/external writes, late evidence, settings/resources, running/expired counters and future session ends/clock rollback. Bound compressed/evidence caches by bytes and entry count.
### Task 2: UI
 compressed validated token cache, bounded transient encoding, lazy restore, guarded async scope; test unchanged hits, stale tokens, navigation races, unsupported compression and cache limits.
### Task 3: Measure
 isolated frozen history before/after with identical dates/settings, complete-result hashes, true UI-ready marks and process RSS; run focused/full suites, build/native bridge smoke as appropriate, one final fresh-context branch review required by executing-plans. Keep work local, un-released. Remove owned temporary database clones after verification.
