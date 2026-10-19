# Business reports: production verification, 2026-10-19

This records the checks performed with the owner during the production walkthrough.
The report data was user-declared `DEMONSTRATION`; it is not evidence of operational
fraud, financial loss or control effectiveness. These checks do not complete Phase 24.

## Evidence provenance

- The owner operated authenticated browser sessions for Badr (Admin), Omar
  (Supervisor) and Ali (Auditor), and supplied screenshots/console results in the
  conversation. The agent did not control these sessions.
- The agent read owner-supplied downloaded PDF/XLSX files locally, comparing extracted
  PDF text with workbook cells. Production files, screenshots, tokens and credentials
  are not copied into this repository. The report IDs below identify the evidence.
- Production URLs were `https://senior-design-gold.vercel.app` and
  `https://senior-design-1ypl.onrender.com`. Render Live for initial feature commit
  `3e3f765` was shown by the owner. PDF was pushed in `ee83c00`, and transient-provider
  retries in `4db3dc5`. Later exported content demonstrates those behaviors; exact
  deployed commit identity was not independently established for every request.
- The owner supplied six true migration-025 checks: table/source/save/read existence,
  service-role save permission and denied authenticated direct table SELECT. These
  markers do not establish equivalence of all live function definitions.

## Observed results

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Admin generation and downloads | Passed for the inspected revision | `cc993d5c-fde2-46c8-8174-4f3d7d36a607`: organization scope, UTC day 2026-10-03, nine transactions, twenty failed-rule occurrences across nine unique transactions, average score 48.79. The PDF opens and has 17 pages. |
| PDF/XLSX narrative consistency | Passed for inspected exports | Revision `cc993d5c-fde2-46c8-8174-4f3d7d36a607`: seven finding facts and 28 Gemini commentary fields matched across PDF/XLSX, as did conclusion and recommendation content. Revision `d66f1954-b1e4-4d21-bf67-0b56827e5489` also matched, with 28 baseline commentary fields. These formats have different schedules: Excel additionally exposes separate rule/anomaly score inputs; they are not identical files. |
| Live Gemini acceptance | Observed | Revision `cc993d5c-fde2-46c8-8174-4f3d7d36a607` records `GEMINI / GENERATED`, `gemini-3.8-flash`, prompt `business-findings-1.0.1`. This does not establish live Gemini acceptance under prompt 1.0.2. |
| Baseline fallback and bounded retries | Observed | Revision `d0d6112b-0e82-4640-8afe-e48a377a09ae` records `BASELINE / UNAVAILABLE`, `HTTP_503`, three attempts, prompt 1.0.2. The report remains available with all memorandum sections. Recovery on a later successful retry is covered locally, not demonstrated live. |
| Provider diagnosis | Owner-supplied shell output | A minimal request from Render to the same model returned HTTP 503 after 10.7 seconds. Google's message stated high model demand. No report evidence was submitted in that probe. Provider availability cannot be guaranteed by retries or paid billing; the owner chose to leave paid billing disabled. |
| Supervisor explicit-day report | Observed empty cohort | Omar's revision `0325604a-a93a-415d-a5d9-64de92828faa` has `TEAM — Retail Audit Team`, UTC day 2026-10-03, zero transactions, `EMPTY_PERIOD` and zero provider attempts. This is not an independent verification of the underlying assignments. |
| Supervisor latest-in-scope report and PDF | Observed nonempty cohort | Omar's revision `20951686-caac-4e1f-bd93-0af67ebde460` selects UTC day 2026-05-15, team scope, one transaction (`EXP-2026-009209`), two failed rules, one active alert, no cases and medium score 61.92. The 10-page PDF opens. Gemini returned HTTP 503 after three attempts. Team membership/source ownership was not independently queried. |
| Auditor page denial | Passed in owner session | Ali's direct `/reports` navigation displayed Access Denied. This alone does not establish API authorization. |
| Auditor API list/read/PDF denial | Passed for tested routes | A browser diagnostic verified `/auth/me` returned role `AUDITOR`, then reported HTTP 403 for `GET /reports/business`, the known Admin revision read, and its `download?format=pdf` route. The owner supplied the console screenshot. |
| Auditor API create/XLSX denial | Owner-reported pass | A follow-up diagnostic verified the Auditor role, submitted a valid demonstration-period POST with `use_gemini:false`, then requested the known Admin revision's XLSX. The owner supplied `Create HTTP: 403` and `Excel HTTP: 403` as text. No report creation was reported. |
| Supervisor cannot read Admin revision | Passed for tested revision | A browser diagnostic verified `/auth/me` returned role `SUPERVISOR`, then got HTTP 404 for `GET /reports/business/cc993d5c-fde2-46c8-8174-4f3d7d36a607`. That revision was known from the Admin export. HTTP 404 intentionally hides inaccessible reports. |
| Supervisor cannot download Admin PDF | Passed for tested revision | The same Supervisor session got HTTP 404 for that revision's `download?format=pdf` route. This does not test a different Supervisor's team report. |
| Supervisor cannot download Admin XLSX | Owner-confirmed result | The owner confirmed the expected `Excel download HTTP: 404` after running the role-checked diagnostic against the same Admin revision. No screenshot/raw response was supplied for this follow-up. |
| Attributable creation audit event | Observed | Admin Audit Log shows Omar, `SUPERVISOR`, `BUSINESS_REPORT_CREATED`, `SUCCESS`, resource `20951686-caac-4e1f-bd93-0af67ebde460`, timestamp `2026-10-19T14:10:38.816954+00:00`, scope `TEAM`, and period `[2026-05-15, 2026-05-16)` UTC. The PDF metadata matches the actor, resource and period. No approval is inferred from successful creation. |

## Isolated verification and available production accounts

The owner supplied an Admin User Management screenshot showing three active
accounts: Badr (Admin), Omar (Supervisor) and Ali (Auditor). Omar is the only
Supervisor shown. No second production test account/team was provisioned, and
existing roles or assignments were not changed during this check.

The agent ran `node --test business-reports.test.mjs` from `backend/test-support`:
four tests passed in isolated in-memory PGlite. The suite loads the local migration
directory, including the existing untracked migration 022; this is evidence for
the current local workspace, not a comparison with the live deployed functions.
It uses fictional test users/teams and never reads credentials or connects to the
production database. The assertions cover:

- Source transactions and workflow evidence confined to the supervised team.
- A second Supervisor unable to list/read another team's saved report.
- Saved evidence remaining immutable after a source field changes.
- The original Supervisor losing list/read access when an evidence assignment
  moves to the other team, while Admin access remains available.
- Denial after disabling the Supervisor or deactivating the team.
- Database grants, atomic creation/audit rollback and UTC day boundaries.

This supplements the live role checks; it does not establish deployed cross-team
or reassignment behavior. The direct live cross-team/revocation tests remain
unperformed pending an appropriate approved test setup.

## Remaining checks

1. Use an approved second team/actor to verify denial of another team's report,
   and independently reconcile source transactions against current authorized
   assignments/cases. Do not modify real team assignments solely for a casual test.
2. Verify access revocation after an approved assignment/team change, and continued
   access to older immutable revisions where still authorized.
3. Check session expiry/refresh and report access after revocation. Earlier transient
   AUTH_UNAVAILABLE screenshots do not establish the precise root cause or resolution.
4. Confirm fresh Gemini success with prompt 1.0.2 when the provider is available;
   inspect writing quality and consistency across formats. Do not mark a baseline
   report as successful AI generation.
5. Refine generic baseline risk guidance for empty/no-high-risk cohorts; the inspected
   reports can still suggest starting with higher-risk transactions when none are
   present. This is a content-quality gap, not evidence of an unauthorized data leak.

The broader project still needs the remaining Phase 24 workflows, current hosted
scheduler/recovery/SLA and WebSocket evidence, live function-definition comparison,
and formal rubric/performance evidence. Local tests and this report walkthrough
must not be represented as completion of the whole production verification phase.
