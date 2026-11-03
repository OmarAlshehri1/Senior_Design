# Remaining Payments: verified audit-context candidate

3 November 2026 (Asia/Riyadh). Status: **registered and verified after explicit
approval**. Only the selected source context pointer changed. No imported record,
saved result, model approval, environment flag or migration changed in this step.

## What was verified

- All 100 approved local sample rows exactly match the existing verified workbook
  preparation. The source workbook and original preparation remain unchanged.
- All creators/approvers resolve to the 19 simulated workbook actors. Their
  uppercase identifiers have no case-fold collisions. Case-insensitive comparison
  is declared only for this simulated actor namespace, not arbitrary companies.
- Every sample approval limit and USD currency agrees with the actor reference.
  File-supplied limits alone are not used as policy authority.
- All 25 distinct sample vendors were looked up exactly in the complete 68,117-entry
  reference registry; source names and statuses match. These are simulated registry
  references, not independent real-company evidence.
- A local arrival-order simulation exercises all five rules on the known cohort.
  Independent predicates match all 500 rule outcomes. Outcomes include 8 Approval
  Limits failures and 14 Invoice Splitting failures under simulation assumptions;
  they are not findings of real fraud or historical policy violations.
- A server-side aggregate-only comparison of all 100 live prefix/history counts
  and splitting totals has **zero mismatches** against the local calculation.
  Actual live arrivals span 0.06238 seconds, so the whole prefix is within 24 hours.
  Local fixture timestamps are not presented as exact production receipt times.

## Registered production context

Source: `payments-workbook-remaining-20261102`.
New immutable context: `simulated-arrival-references-v2`.
Mapping remains `remaining-date-only-v1`.

The registered context enables verified actor comparison and source-specific simulated
approval policies, and declares complete **delivered source-prefix** history.
Temporal evaluation uses `SIMULATED_ARRIVAL_TIME`; original historical dates
remain unchanged. Coverage means the complete posted prefix of this source,
not the entire 355,426-row workbook or a company's complete historical ledger.
References are explicitly bounded from 1 November through 10 November 2026 UTC
(end exclusive); they require review before expiry.

Four rules are eligible under this context in the verified local exercise. No new
production records were imported to exercise it end to end; zero hosted records
currently use v2. Ghost Vendors remains NOT_EVALUATED:
the complete 68,117-entry registry exceeds the current 10,000-entry context limit.
The 25-vendor cohort projection is used only for bounded local verification and
is **not** installed as an authoritative registry for future arbitrary uploads.
AI stays disabled, with no model approval, no combined-risk score and no invented
department. No additional records will be imported as part of registration.

## Existing results and outstanding work

The immutable shared-configuration reference for v2 was verified after registration.
All four evaluated engine files match deployed commit `d81279c`.
The complete legacy transaction and alert checksums are unchanged, and migration
history remains 34. No deployment or frontend change was needed.

The existing 100 saved outcomes remain pinned to `simulated-workbook-partial-v1`,
with zero eligible rules. Their complete-row digest at this checkpoint is
`1542ad1998d60bc6e19c9f79bddfa53b`. A source pointer change affects future records;
it does not retroactively update these outcomes. A retrospective result revision
requires an explicit append-only re-evaluation design; that flow is not present.

Before claiming all five rules work for general uploads, implement full-registry
support or an equivalent complete membership lookup with preserved authorization,
provenance and scope. Before importing more, agree the controlled next cohort and
its context. S4 and AI validation are not newly established by this work.

Automatic approval review rejected a live row-payload export. Work continued
using the existing private local sample and aggregate-only live checks. It also
initially rejected persistent source-context registration because explicit approval
for that production pointer/configuration change was required. The user then
explicitly approved this exact context change; the same guarded transaction
succeeded and was verified. The rejected row-payload export was not retried or
performed through another path.

Evidence: [reference validation](evidence/remaining_payments_reference_validation_2026-11-03.json).
See [the original controlled import](REMAINING_PAYMENTS_FIRST_IMPORT_2026-11-02.md).
