# Business audit memoranda — local implementation, 2026-10-19

Status: application implemented locally, not deployed. The owner reported applying
migration 025 successfully to M004 Supabase on 2026-10-19 and supplied a read-only
result with all six checks true: table/source/save/read presence, service-role save
EXECUTE permission and denied authenticated direct table SELECT. This is
owner-supplied live marker evidence, not an independent full-definition comparison
or end-to-end report-generation check. Publishing this feature was approved by
the owner; deployment and live report verification remain pending. No packages
were installed for this feature. Existing uncommitted requirements, migration 022
and deployment documentation are independent work and remain intact.

## User flow

Reports defaults to Business Audit Reports. Select a UTC day or leave the day
empty for the latest dated transaction **within the caller's scope**. Specify To,
From and a user-declared data context. Every generation creates a new immutable
draft identified by a UUID (`BR-<uuid>` in the rendered document). Generation
completion does not mean review or approval. No sign-off is invented or accepted
from request fields. A review/approval workflow is outside this implementation.

The saved document includes memorandum header, terms of reference, methodology,
numbered findings, bounded conclusion, proposed recommendations, blank review
fields, transaction/rule/workflow evidence schedules, risk chart and glossary.
HTML preview, standalone HTML download, printing (including browser Save as PDF)
and Excel appendices all use the saved document, never newly queried business
data. No server-side PDF generator is required. Gemini commentary is optional;
the baseline document remains complete without it. No new packages are needed.

## Scope and compatibility

- Admin: organization transaction cohort and related alerts/cases.
- Supervisor: the active supervised team's transactions linked to its current
  alert-assignment rows (including the team's unassigned queue) or cases. Global
  unclaimed alerts and transactions with no such team link are excluded.
- Auditor: no report access.
- Date cohort: transaction timestamps in `[start, end)` for one exact UTC day.
  Latest stored evaluation/risk snapshots are used as of evidence extraction.
  Rule evaluation and risk snapshots carry independent IDs/versions/dates;
  their source inputs must not be assumed identical.
- Workflow states: current at extraction, **not** historical period-end states.
  Alert/case dates can be later than the transaction period.
- Undated cohort count: disclosed separately, not assigned to any selected day.
- Read/list/download recheck active identity/team/evidence scope. If evidence
  moves out of the team's scope, the old draft becomes inaccessible to that
  Supervisor; Admin can still access it. No partial rewriting of a saved draft.
- To avoid exposing global data through old endpoints, `/reports`,
  `/reports/latest` and the legacy Excel download are now Admin-only. Admin's
  Reports page retains an **Open Legacy Daily Summaries** switch.
- Existing `audit_reports`, scheduler history, scheduled daily summaries and
  old Excel files retain their storage semantics. The scheduler still generates
  legacy summaries, not new business memoranda. New business drafts are generated
  explicitly; no historical business drafts are fabricated or backfilled.

This role-policy change is deliberate: the previous global SQL report summary
does not accept an actor. Returning it to a team Supervisor would expose a
different scope from the new team memorandum.

## Content rules

The backend aggregates saved evidence without running rules or anomaly scoring.
It distinguishes failed-rule occurrences from distinct transactions;
each known rule contributes at most one failure per transaction. It groups money
by currency, excludes missing amount/currency from monetary totals and reports
their count. It does not convert currencies or call recorded transaction values
losses. Zero transactions produce no assurance conclusion; missing scores and
coverage are unavailable, not zero-risk assertions. Average/coverage rounding is
decimal half-up. Rule eligibility exclusions are reported for each rule.

Data context is `UNVERIFIED` by default. `DEMONSTRATION` and `OPERATIONAL` are
explicit user declarations, not automated source validation. All drafts disclose
that supporting documents were not inspected by the generator. Labels are
escaped in HTML and retained as text in Excel. Preview runs in a sandboxed iframe;
download HTML prohibits script/network/form execution using CSP.

## API (all business routes require active Supervisor/Admin)

| Method / path | Behavior |
| --- | --- |
| `POST /api/v1/reports/business` | Generate and atomically save a new immutable draft; append creation audit event. |
| `GET /api/v1/reports/business?page=1&page_size=25` | Scoped, paginated saved-draft metadata. |
| `GET /api/v1/reports/business/{uuid}` | Reauthorized saved document. |
| `GET /api/v1/reports/business/{uuid}/download?format=html` | Standalone memorandum, or `format=xlsx` for workbook. |

Creation request (omit **both** dates for latest activity):

```json
{
  "period_start": "2026-10-03T00:00:00Z",
  "period_end": "2026-10-04T00:00:00Z",
  "recipient": "Management and Audit Supervisor",
  "sender": "Continuous Auditing System — automated preparation",
  "data_context": "DEMONSTRATION",
  "use_gemini": true
}
```

Unknown fields, client-supplied scope/team and partial/invalid dates are rejected.
Read response: `{id, created_by, scope, team_id, period_start, period_end,
created_at, document}`. Document schema `2.0.0` contains metadata, terms,
methodology, limitations, metrics, per-rule coverage, findings, recommendations,
conclusion, blank review fields, and `evidence: {transactions, alerts, cases}`.
The source query never selects transaction metadata or `ground_truth`.

SQL RPCs are executable only by `service_role`; application roles cannot directly
read or mutate the table. Insert and `BUSINESS_REPORT_CREATED` audit event commit
together. `can_read_business_report` checks object scope on every list/read.
Invalid scope/role returns 403, inaccessible/missing draft 404, invalid request
422, missing schema/storage fails closed (503); no fake successful draft appears.

## Offline preview and checks

From `backend`, using the existing environment:

```powershell
.\.venv\Scripts\python.exe -B -m scripts.preview_business_report
.\.venv\Scripts\python.exe -B -m pytest -p no:cacheprovider -q
```

The preview script writes `docs/evidence/business_report_preview.html` and `.xlsx`.
It uses **three illustrative synthetic records**, not the nine-record production
report shown during walkthrough. It never reads credentials or calls a database.
The HTML opens independently in a browser; print it to inspect pagination.

From `backend/test-support`: `npm test` runs all installed PGlite suites against
in-memory PostgreSQL, including migration 025. From `frontend`: `npm test`,
`npm run lint`, `npm run build`. No dependency installation is required.

## Production activation — not performed

1. Review migration `025_create_business_reports.sql`, its grants and scope policy.
   Confirm the real production schema includes prerequisites 001–024 and compare
   any locally untracked migration 022 before release; this feature does not
   establish equivalence of those deployed definitions.
2. Apply migration 025 only with database-owner approval. It creates new objects
   and does not rewrite existing reports, transactions, alerts or cases.
3. Deploy backend and frontend together after local review. Ensure the coordinated
   legacy Admin-only behavior is communicated; old Supervisor clients must reload.
4. Verify Admin and Supervisor creation, same-day separate draft IDs, persistence
   across reload, cross-team denial, Auditor denial, HTML/Excel equality, browser
   printing and sign-off remaining blank. Confirm no old report was overwritten.

Local tests do not prove deployment, browser printing, real role sessions or
production query latency. Full interactive browser QA and a new live E2E check
remain required after approved activation.

## Optional Gemini findings commentary

The owner subsequently approved Gemini integration for finding explanations.
Creation requests default to `use_gemini: true`; the UI offers an opt-out.
`REPORT_GEMINI_ENABLED=false` is a server-side disable switch (default enabled).
The integration reuses the existing server-only `GEMINI_API_KEY` and `GEMINI_MODEL`
configuration and installed httpx client; there are no new credentials or packages.
No real provider request was made during this local implementation/testing.

Each finding always contains `analysis` with `interpretation`,
`business_implication`, `recommended_review` and `limitations`, plus
`analysis_source: BASELINE|GEMINI`. Even disabled/offline reports have detailed
rule-specific standard explanations. The authoritative finding `text`, metrics,
evidence, recommendations, conclusion and review fields are never overwritten
with model output.

One request (90-second read timeout; 10-second connect/write/pool timeouts,
no retry/redirect, bounded output)
sends only the canonical finding facts, finding IDs, scope/data-context enums
and methodology definitions. No organization/vendor/user names, transaction IDs,
recipient/sender labels, free-form notes or raw evidence are sent. Report generation
may take longer while waiting for this optional request; httpx timeout is a
per-operation timeout, not a guaranteed total wall-clock deadline.

The response uses a JSON schema, then independent strict Pydantic validation.
Finding IDs must match exactly without missing/extra/duplicate findings. Extra
fields, truncation, malformed/oversized output, links/markup, numeric claims and
selected unsupported assertions are rejected. Commentary deliberately does not
repeat quantities: authoritative facts and tables supply those. Semantic accuracy
of prose cannot be proven by schema or these checks; all AI prose remains labelled
advisory and requires human review.

Any disabled, unconfigured, empty-period, HTTP-error or rejected-response path
uses the full baseline explanations for the entire report. No partial AI response,
raw provider error or secret is persisted. Saved `narrative` metadata records provider,
status, prompt version, successful model, generation timestamp and review requirement.
The accepted prose is saved before report commit and reused in HTML/Excel/printing;
reading or downloading never regenerates it. Old drafts are not rewritten.

The offline preview script never calls Gemini; its explanations are clearly
marked standard/baseline. Successful provider output must be checked later during
approved live verification. Migration 025 stores the additional JSON fields as-is;
this integration needs no further database migration.

Provider contract references:
[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[generateContent configuration](https://ai.google.dev/api/generate-content).

Post-integration verification on 2026-10-19: backend **263 passed**, frontend
**243 passed**, lint and production build passed, and `git diff --check` passed.
The additional provider tests use mocked HTTP responses, including success,
strict schema/reference validation, timeouts/rate limits/provider errors,
disabled/unconfigured/empty fallback, unchanged facts and persisted shared
HTML/Excel commentary. They do not establish a successful live Gemini call.
The 34 isolated migration tests above remain the unchanged database baseline;
the commentary integration adds JSON fields and does not change migration 025.

## Local verification record

After owner-supplied production evidence changed from `TIMEOUT` to `REJECTED`,
validation failures now also persist/log fixed safe classifications: output token
limit, invalid JSON, response structure/size, schema mismatch, finding-reference
mismatch, quantities, prose format or unsupported assertions. Validation rules,
model, thinking level and timeout remain unchanged in this diagnostic update.
No provider prose, validation inputs, error messages or credentials are logged.
The specific live rejection cause remains unknown until a new draft records it.

Following owner-supplied production evidence of `TIMEOUT` with
`gemini-3.8-flash`, the provider read timeout was increased from 20 to 90 seconds;
connect/write/pool remain bounded at 10 seconds. Gemini 3 requests use
`thinkingConfig.thinkingLevel=low` and omit the deprecated `temperature` sampling
parameter, following Google's Gemini 3.8 Generate Content guide:
https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.8
The model ID is unchanged. The frontend API client has no independent request
timeout to extend. No retry is added; failed requests still save baseline drafts.
These changes do not prove that the production provider call will succeed.

2026-10-19 troubleshooting: new drafts record `attempted_model` and a bounded
`failure_code` for Gemini transport failures (`HTTP_<status>`, `TIMEOUT`, or
`NETWORK_ERROR`). These appear in HTML metadata and the Excel Memorandum sheet.
Only the failure code is logged; exception text, headers, provider response bodies
and report contents are excluded. Existing immutable drafts are unchanged. No
model, timeout or retry policy was changed. The focused report, narrative,
identity and alert-stream suites passed 63 tests. Live Gemini success is pending.

2026-10-19: backend 239 tests passed (one pre-existing Starlette TestClient
deprecation warning), frontend 243 tests passed, isolated PGlite 34 tests passed,
lint and production build passed, and `git diff --check` passed. The report UI
is lazy loaded; no package was installed. The tests cover role/scope restrictions,
immutable revisions, audit-insert rollback, changed-team access, UTC/DST boundaries,
private source-field exclusion, rule coverage, distinct transaction counts,
currencies, missing values, half-up rounding, HTML escaping, Excel formula safety
and API request/download validation.

The offline HTML was visually inspected using isolated headless Chrome. Chrome
also printed the local illustrative document to a six-page temporary PDF. This
checks standalone rendering/browser printing, not the signed-in iframe controls
or deployed generation flow. Full real-session E2E remains pending.
