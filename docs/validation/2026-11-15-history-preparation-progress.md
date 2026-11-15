# Visible report-history preparation

Scope: expose the existing background preparation in Billing reports and a persistent compact footer action that opens that view. No report eligibility, pricing, evidence, timing or preparation scheduling changes. No new request/poller, raw-history count, dependency or storage schema. Uses the existing five-second capture-status refresh.

Display states:

- Reading saved activity (step 1 of 2): indeterminate. Source rowids are sparse and are deliberately not turned into a fake event percentage.
- Preparing daily periods (step 2 of 2): real prepared/total closed daily-period counts, current project/date and a determinate progress bar. Reports can run throughout; available prepared periods are reused and the rest retain original calculation.
- Report history ready: persistent completion state, including the prepared-period count; recent or changed activity can still need calculation.
- No historical periods yet, missing status, paused capacity and failed/retrying states remain distinct. No configured billing project hides the additional indicator.

The worker counts only closed daily slices for current billing projects; live work and deleted-project slices cannot keep the historical completion indicator pending. Aggregation reads only small sidecar metadata, never proof payloads or source row counts. Status does not start as idle/ready before a worker result arrives. Late changes can reopen preparation through existing invalidation.

Verified: 62 focused tests (ingestion, closed/active-project accounting, worker restart, billing UI/context, protocol, Vue rendering and frontend bundle boundaries) and production typecheck/build passed. Component rendering checks live progress values, completion while a live period remains pending, indeterminate reading and footer navigation. No local profile or customer database modified. Implementation is local for the next release.
