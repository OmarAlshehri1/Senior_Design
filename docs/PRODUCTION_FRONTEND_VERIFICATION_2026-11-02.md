# Production frontend verification - 2 November 2026

Current activation update: the user approved a separate remaining-Payments source
and its first 100-row import. Import/intake/validation/audit/review are now enabled;
AI remains off. Import and report checks passed, but all five rules are unavailable
until reference context is configured. Existing Payments counts/checksums are unchanged.
See [the first import and its limits](REMAINING_PAYMENTS_FIRST_IMPORT_2026-11-02.md).
The rollout status below records the earlier deployment checkpoint.

The owner clarified that frontend deployment-trigger commit `d81279c` is live at
https://senior-design-gold.vercel.app. Public asset and signed-in Admin browser
checks passed against the production backend. The application rollout is complete;
company imports, feed processing and feed AI remain disabled pending source onboarding.

The public site now serves `/assets/index-DZUv1KLE.js`, containing the new
company-import module and the production backend reference, with no staging
backend reference. Its SHA-256 is
`df79ec8733bdf346d639bed4aefa0438955bd99fb9555fb095a598b6c69934b0`.
Remote `main` is confirmed at `d81279c6c3898663087bba7740b3d6774d50e315`.
Its message is `Trigger Vercel deployment`; it is an empty commit with the same
repository and frontend source tree as `39011d8` (frontend tree
`0b951b3fc11f69964e8232739c5a3e47473255be`). The browser checks therefore
cover the same frontend source. The exact deployed commit is owner-reported: the connected account still lacks access
to the owner's Vercel metadata. Public asset checks establish that the new
frontend is published; they do not independently establish the provider's Git SHA.

Read-only checks on the newly published frontend passed:

- Admin import page shows imports are disabled and has no upload control.
- Feed review shows its disabled message; both capability APIs return false.
- Dashboard category totals reconcile to 47,531 active transactions; selection works.
- All five alert-rule choices, combined filters, alert search and vendor search work.
- An existing saved business report previews and downloads as valid PDF and Excel.
  The spreadsheet count matches the report snapshot. Previous downloads were
  archived before this check, so validation used fresh downloads.
- Desktop and 390px layouts have no page overflow; browser runtime exceptions: zero.
- Only the isolated Admin test session was logged out afterward (HTTP 204).

No import, report generation, dataset replay, migration or business-record write
was performed. Other roles were not retested in this production browser session;
their prior staging/authorization coverage remains recorded. Production schema
and legacy checksums were verified during the preceding backend rollout; they
were not remeasured in this frontend-only check. S4 remains partial.

Evidence: [public assets](evidence/production_frontend_publication_2026-11-02.json),
[Admin flow](evidence/production_frontend_admin_verification_2026-11-02.json),
[session cleanup](evidence/production_frontend_session_cleanup_2026-11-02.json).
See [the application rollout](PRODUCTION_APPLICATION_ROLLOUT_2026-11-02.md).
