# Production application rollout - 2 November 2026

Current activation update: the user approved a separate remaining-Payments source
and its first 100-row import. Import/intake/validation/audit/review are now enabled;
AI remains off. Import and report checks passed, but all five rules are unavailable
until reference context is configured. Existing Payments counts/checksums are unchanged.
See [the first import and its limits](REMAINING_PAYMENTS_FIRST_IMPORT_2026-11-02.md).
The rollout status below records the earlier deployment checkpoint.

**PR #40 is merged and the production backend is live.** New company imports,
feed processing, feed AI and diagnostic timing remain disabled. The owner has now
published the frontend, and public-asset plus signed-in Admin checks passed.
See [new-frontend verification](PRODUCTION_FRONTEND_VERIFICATION_2026-11-02.md).

## Release and configuration

The normal merge completed at 17:03:59 UTC with merge commit
`39011d838e8f009d61ffd2ec1e462ee54f9b0562`, guarded against changes to the
reviewed PR head `2163dbd9240ba1f524184a9525812105f0e2a546`. No administrative
merge override was used. Its backend/frontend tree matches the reviewed source.
The earlier validation of 447 backend, 317 frontend and 58 SQL tests therefore
applies to this same application tree.

Before merging, these production backend variables were explicitly set to
`false` through a merge-only environment update: `COMPANY_IMPORTS_ENABLED`,
`INGESTION_ENABLED`, `INGESTION_VALIDATION_ENABLED`, `INGESTION_AUDIT_ENABLED`,
`FEED_REVIEW_ENABLED`, `INGESTION_FEED_ANOMALY_ENABLED` and
`INGESTION_TIMING_ENABLED`. `INGESTION_PREWARM_PAYMENTS_BINDING` was cleared.
Other environment variables, including production secrets and existing model
configuration, were preserved. No staging secret was copied to production.

Render first activated that configuration on the old main revision in deploy
`dep-dbkc3fk9v7es73cb30eg`. Its commit
`71ca4a0d5d12e1082ca3f415d5de7e99ca8f056f` is the immediately preceding
known-good configuration/rollback point. After the merge, Render automatically
deployed `39011d8` as **`dep-dbkc50h5efls73f016k0`**, live at 17:04:59 UTC.
The service remains `srv-db14j6m0tbcc739gavig` on its existing `1c-2g` plan;
no billing or scaling change was made.

## Read-only production verification

- Health and OpenAPI returned HTTP 200, and the new import routes are loaded.
- A real signed-in Admin session returned disabled import/feed capabilities.
  Producer POST and receipt lookup returned 404 while ingestion is disabled,
  without diagnostic timing headers.
- Dashboard totals and category totals reconciled to **47,531 active
  transactions**; category selection worked.
- All five audit-rule filter choices, combined status/severity filters and
  search worked on the existing Alerts view. Vendor search also passed.
- An existing saved Daily Business Report preview used the plain-language
  layout and downloaded successfully as PDF and Excel. The spreadsheet's
  transaction total matched the saved report snapshot; no report was generated
  or rewritten for the check.
- Desktop and 390px mobile checks passed without page overflow. No browser
  runtime exceptions were observed.
- The user's isolated Admin test session was logged out with HTTP 204 after
  verification. Other user sessions and account states were not changed.

The browser checks above used the **existing frontend** against the new backend.
Other roles were not signed into production in this session; their release
coverage remains the prior staging and SQL/authorization validation.

## Data and migration boundary

The already-applied 26 migrations were **not rerun**. Production migration
history remains at 34 entries. No source, receipt, company import or feed audit
result exists in the new tables. No simulated reference context or model
approval was inserted.

The legacy transaction table remains at **57,384 rows**, and alerts at **4,150**.
Their complete-row aggregate digests still match the pre-migration baseline.
Whole-table counts and the active-dataset dashboard count use different
populations. No reset, reimport or business-record mutation was used during
rollout or smoke testing. Normal sign-in/sign-out session bookkeeping is separate.

## Frontend publication history

The initial deferral below is historical. The owner subsequently reported
`39011d8` live; the new public bundle and Admin flows are now verified.
[Current verification](PRODUCTION_FRONTEND_VERIFICATION_2026-11-02.md) records
the checks and the distinction between owner-reported commit and public evidence.

### Earlier owner handoff

The Vercel Git status reports a blocked deployment because the commit author is
not a member of the teammate's private Hobby team. The connected account also
received 403 for scope `omar22222`. No repository-visibility, membership, paid
plan or project-ownership change was made.

After the backend merge, the public frontend still served
`/assets/index-CyHVaEqz.js` with SHA-256
`44c97e8ca8c937d4d61e66f09c46a1bcd6fd9c271ce5e552ca8d63cf4db67e13`.
It references the production backend and no staging backend, but does not
contain the new company-import module. The user explicitly selected
**“Teammate will deploy later.”** The [owner handoff](FRONTEND_PRODUCTION_HANDOFF_2026-11-02.md)
contains the target commit, project and settings. New-frontend verification
must follow that owner deployment; the existing-frontend checks do not replace it.

Source-specific onboarding and feature activation remain separate future work.
The partial S4 assessment and existing security advisories are unchanged by
this application rollout.

Evidence: [rollout summary](evidence/production_application_rollout_2026-11-02.json),
[runtime guards](evidence/production_application_runtime_2026-11-02.json),
[signed-in browser checks](evidence/production_application_admin_verification_2026-11-02.json),
[test-session cleanup](evidence/production_application_session_cleanup_2026-11-02.json), and
[completed schema step](PRODUCTION_SCHEMA_ROLLOUT_2026-11-02.md).
