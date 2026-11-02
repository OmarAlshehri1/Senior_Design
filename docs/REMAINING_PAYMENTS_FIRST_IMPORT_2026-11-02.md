# First remaining-Payments production import

2 November 2026 (Asia/Riyadh). The user selected the existing Payments remainder,
provided the existing Admin account and explicitly approved production activation
and a controlled 100-row import. No new-company identity was invented.

**The import/reporting flow passed; audit context is incomplete.** All 100 records
are saved and processed, with zero pending, blocked, rejected or reused rows.
All five audit rules remain NOT_EVALUATED for every record. Processing completion
does not establish that the transactions passed audit checks or are low risk.
AI is off and all 100 combined-risk scores are unavailable.

## Scope and configuration

- Source: `payments-workbook-remaining-20261102`, active and audit-enabled.
  Only the explicitly selected active Admin has a direct source assignment.
- Original Payments population: 355,426; retained active Payments: 47,531;
  excluded at reduction: 307,895. A 100-row sample was prepared from the existing
  verified offline workbook preparation, with no IDs present in live transactions.
- Stable import reference: `SOURCE_ROW`; mapping version `remaining-date-only-v1`;
  context version `simulated-workbook-partial-v1`. These are immutable snapshots.
- Five import/intake/validation/audit/review flags are now enabled service-wide.
  This is the sole registered source. AI and timing diagnostics remain disabled.
- Render configuration deployment `dep-dbkdvue7bikc73fefkeg` is live on `d81279c`.
  No application source change, new migration, scheduler, cleanup or model approval
  was needed. Secret values and unrelated settings were preserved.

## Verified behavior

The selected real Admin used the deployed UI to upload the private CSV, select
columns and date/currency formats, check every row and confirm exactly 100 rows.
Preview showed 100 limited-evaluation rows and zero invalid rows. Server workers
completed 100/100; reload recovered the confirmed import, and source-scoped Feed
Review and summaries both reconciled to 100. PDF and Excel exports downloaded and
parsed successfully. Desktop and 390px layouts passed without runtime exceptions.
Only the isolated test session was logged out afterward (HTTP 204).

The existing Payments dashboard remains 47,531. The complete legacy transaction
table remains 57,384 rows and alerts remain 4,150; full-row aggregate checksums
match before and after. Migration history remains 34. The new feed contains 100
receipts, 100 transactions and 100 saved results. The full excluded dataset was
not restored, and no additional rows were imported.

## Audit limitations and next work

- Segregation of Duties: actor comparison semantics are not verified in this context.
- Approval Limits: no verified approval policy is attached.
- Duplicate Payments and Invoice Splitting: precise event times and authoritative
  history coverage are unavailable. Splitting also lacks a verified approval policy.
- Ghost Vendors: precise event times and an authoritative registry are unavailable.
- Department/category is absent, so the report correctly shows Uncategorized.
- Workbook actor, approval, registry and clock additions include simulation. They
  must remain labeled as simulation if used for a later audit exercise.

Before importing more records, prepare and validate a versioned reference context
from the retained workbook/reference evidence, establish actor comparison and
history/time semantics, and identify which controls can truthfully run. Do not
invent departments, timestamps, authoritative history or model approval. Existing
saved results retain their original context; changing the source context affects
future records and does not silently rewrite these 100 outcomes. S4 remains partial.

Evidence: [browser import and reports](evidence/remaining_payments_first_import_2026-11-02.json),
[activation and database verification](evidence/remaining_payments_activation_2026-11-02.json),
[test-session cleanup](evidence/remaining_payments_session_cleanup_2026-11-02.json).
