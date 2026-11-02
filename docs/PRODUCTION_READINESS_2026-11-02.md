# Company imports and feed reports: production readiness

Current update: all 26 schema migrations are applied, PR #40 is merged, and the
production backend is live on `39011d8`. New import/feed/AI flags are explicitly
held off; existing transaction/alert checksums are unchanged. The owner-published
frontend passed [production verification](PRODUCTION_FRONTEND_VERIFICATION_2026-11-02.md). See [the application rollout](PRODUCTION_APPLICATION_ROLLOUT_2026-11-02.md)
and [schema execution record](PRODUCTION_SCHEMA_ROLLOUT_2026-11-02.md).
The pre-rollout review below is retained as a dated checkpoint.

The staging candidate passed the functional release review. **Production has
not been changed, and the release is not yet approved for activation.** The
remaining conditions are the ordered database rollout, production source
onboarding, deployment-owner coordination, and acceptance of the documented
performance and security limits.

## Reviewed candidate

- Main at review: `71ca4a0d5d12e1082ca3f415d5de7e99ca8f056f`.
- Source candidate: `b1ca6416d32454ae0218ed446bc0cda09b087331` on
  `staging/dashboard-business-reports-20261101`.
- Live staging backend: `474165891d8c88c884742eb8d404a97efb6ebc89`.
- Live staging frontend: `845318b40aaa324b1e2d1bca68f82afba1f4351c`.

Git comparisons confirmed that the candidate's backend application/migrations
and frontend exactly match those respective deployed revisions. Later evidence
commits do not change application behavior. The production backend currently
runs `f4f4a7ab4522d10010a39e7bf94b48dbcab5dacd`, which is recorded separately
from main for rollback. Its existing `1c-2g` instance is already always on;
this review made no hosting or billing change.

## Fresh verification

| Area | Result | Evidence |
| --- | --- | --- |
| Backend regression suite | 447 passed | [Check summary](evidence/production_readiness_checks_2026-11-02.json) |
| Frontend tests, lint and production build | 317 tests passed; lint/build passed | [Check summary](evidence/production_readiness_checks_2026-11-02.json) |
| SQL integration | 58 tests passed against fresh isolated PGlite databases | [Check summary](evidence/production_readiness_checks_2026-11-02.json) |
| Real three-role authentication and import permissions | Admin allowed; Supervisor/Auditor import denied; unauthenticated access denied | [40 hosted checks](evidence/production_readiness_api_2026-11-02.json) |
| Source isolation | Unassigned-source import history and report downloads denied | [Hosted checks](evidence/production_readiness_api_2026-11-02.json) |
| CSV/XLSX imports | Preview, confirmation and durable completion passed | [Hosted checks](evidence/production_readiness_api_2026-11-02.json) |
| Data integrity | Replay reused the receipt; invalid amounts blocked; conflicting records could not overwrite originals | [Hosted checks](evidence/production_readiness_api_2026-11-02.json) |
| Dashboard categories | API totals reconciled; category buttons rendered in the real browser | [API checks](evidence/production_readiness_api_2026-11-02.json), [browser checks](evidence/production_readiness_browser_imports_2026-11-02.json) |
| Full browser import | Real sign-in, saved mapping, CSV upload/confirmation, workers, reload recovery and 390px layout passed | [Browser imports](evidence/production_readiness_browser_imports_2026-11-02.json) |
| Feed departments and summary | Listing/detail categories and five grouped departments rendered; no browser runtime exceptions | [Browser reports](evidence/production_readiness_browser_reports_2026-11-02.json) |
| PDF/XLSX exports | Scoped downloads, PDF department labels and structured spreadsheet sheets passed; no executable spreadsheet formulas found | [Hosted checks](evidence/production_readiness_api_2026-11-02.json) |

The first page of the ten-page PDF was visually reviewed: the title, processing
summary, separate currency totals and department table fit cleanly. Its bounded
transaction appendix remains part of this audit snapshot. Exported spreadsheets
preserve exact numeric text. This feed summary is separate from the existing
management Business Reports workflow; the release does not replace it or its
approval requirements.

The initial backend run had four fixture-setup errors because the temporary
parent folder was missing; creating it allowed the full 447-test rerun to pass.
The private hosted driver was aligned with the documented HTTP 201 upload
contract before its successful complete run. The initial partial observation
is retained [here](evidence/production_readiness_api_initial_2026-11-02.json).
No product failure was concealed as a skipped test. Existing Starlette test-client
deprecation remains; it did not fail the suite.

## Conditions before production activation

1. **Database deployment is required.** Read-only production inspection found
   the identity/team/crypto prerequisites, but no `ingestion_sources`, feed-result
   or company-import tables. The candidate adds **26 migration files**. Review
   and apply only those files, in the manifest order, using the established
   production process. Migration history does not represent every previously
   applied numbered baseline file, so a blanket replay/reset is unsafe. See the
   [pinned manifest](evidence/production_release_migration_manifest_2026-11-02.json)
   and [rollout procedure](PRODUCTION_COMPANY_IMPORT_ROLLOUT_2026-11-02.md).
2. **Activation needs production-specific configuration.** New flags default off.
   Verify actual production flags, register a real source, assign its Admin,
   verify field mappings and authoritative reference context, and approve a
   compatible model before enabling scoring. Do not copy synthetic policies,
   simulation clocks, users, passwords or source credentials from staging.
3. **The imported population has its own review/report flow.** Imported source
   records appear in Feed Review and its scoped reports. The existing dashboard
   retains the active Payments population. File upload supports UTF-8 CSV and
   XLSX; JSON uses the authenticated producer API. This is not universal database
   file support. Arbitrary new-company AI accuracy is not established by the
   approved Payments-domain model or these synthetic tests.
4. **S4 remains partial under the conservative client-confirmation test.** The
   latest 60 large requests passed, while the previous soak retained 5.625660-
   and 6.380250-second confirmations and an earlier request took 8.059360 seconds.
   The exact slow-tail cause remains unconfirmed. Database alert insertion and
   client confirmation have different timing boundaries. Browser notification
   delivery is not established by saved-HIGH-alert evidence. See
   [the timing assessment](S4_BODY_SPLIT_STAGING_2026-11-02.md).
5. **Existing security advisories need an owner decision.** Both production and
   staging report the existing anon/authenticated execution warnings for
   `public.rls_auto_enable()` and disabled leaked-password protection. The
   function returns `event_trigger`; no exploitability test or privilege change
   was performed. These are not newly introduced import warnings. Review the
   intended privileges before changing them. Supabase's
   [advisor guidance](https://supabase.com/docs/guides/observability/advisors?lint=0029_authenticated_security_definer_function_executable)
   explains contextual review; [password protection documentation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
   lists its plan requirement. No upgrade was performed.
6. **Coordinate the production deployment.** Render auto-deploys backend changes
   on main. Record the teammate-owned Vercel production deployment and rollback
   reference before merging; this connected account did not inspect or change
   that deployment. The code review is a draft, not merge/deployment approval.

## Test data and cleanup

Only three new synthetic records were confirmed on staging: an API CSV record
in Finance, an API XLSX record in Operations, and a browser CSV record in Finance.
All three completed. Replayed, invalid and conflicting inputs did not create
extra canonical transactions. Unconfirmed test drafts remain subject to the
existing staging retention policy; no historical transaction or result was
deleted. The validation source now has 50,010 receipts. Original Payments-source
records remained at 1,001.

The temporary synthetic Admin was re-disabled through the audited lifecycle
function, revoking its application sessions; no live application session remains
for that user. All three API test sessions returned 204 on logout. Supervisor
and Auditor account states were not changed. The prior latency-test producer
remains disabled. Credentials, sessions, browser profiles, screenshots, downloaded
reports and raw runner logs remain private and are excluded from the release.

Production queries in this review were read-only. No production migration,
record import, source setup, model approval, flag update, deployment, merge or
main push was performed. The previous backend deployment remains
`dep-dbjjrpqvcj2c73f28qjg`.

Recheck the [production preflight](evidence/production_readiness_preflight_2026-11-02.json)
immediately before an approved rollout; it is a dated observation, not a lock
on future infrastructure state.
