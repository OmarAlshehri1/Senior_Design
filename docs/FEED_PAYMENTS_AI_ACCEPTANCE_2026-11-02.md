# Payments feed AI staging acceptance ? 2 November 2026


The source-specific Payments model is now connected to newly received eligible
Payments records on staging. Application release
`845318b40aaa324b1e2d1bca68f82afba1f4351c` is live on both staging services.
The additive migrations `20261102064921_payments_feed_source_model.sql` and
`20261102065319_feed_ai_score_visibility.sql` were applied once. Only the staging
backend's `INGESTION_FEED_ANOMALY_ENABLED` flag was enabled; other environment
variables and production services were preserved.

This uses the same `payments-primary-no-calendar-1.0.0` artifact already bound to
the active Payments primary dataset, not the retail model. Its SHA-256 is
`85b034c6c247e4be4532e7b1f76bd2ec1ab7eac4a76514edccd9ce83910bdbc8`.
The 2,903,899-byte artifact was provisioned into private staging storage,
download-hash verified, and denied anonymous public download (HTTP 400).
Thirty existing local Payments inputs produced identical direct-model and
feed-engine scores. No source records or executable artifacts were uploaded to
the public repository. The operator-managed context for `payments-file-local`
now selects `payments-source-ai-20261102`; its previous context and 1,001 saved
unscored results remain intact. Activation applies to future receipts only.

Hosted acceptance added only seven clearly identified verification receipts in
a separate source: three bounded existing Payments inputs with new test IDs,
two altered negative controls, one CSV record and one Excel record. These are
source-backed inference fixtures, not new fraud labels or a dataset replay.
All seven completed. Five eligible records received real AI scores; the three
JSON positives scored 71.29, 70.16 and 53.61. CSV and XLSX matched their equivalent
JSON scores exactly. Missing names and unsupported currency correctly withheld
AI scores. Unsupported currency is retained as PARTIAL with null canonical
currency; the initial test harness incorrectly expected rejection, and was
corrected against the same saved receipt without another insertion.

Actual Admin sign-in verified source-scoped listing/detail AI values, exact
producer replay and denied unassigned-source access (403). A fresh deployed
browser verified real login, the saved 71.29/100 score, plain-language meaning,
partial-coverage explanation, no runtime exceptions and no overflow at 390px.
The temporary producer source was disabled after verification and its credential
returned 401. The temporary Admin was disabled through the audited operation;
its login returned 403. Other-source receipts stayed 51,038 and active Payments
stayed 10,001. All seven verification receipts/results were retained.

Validation passed 61 Python tests, SQL groups of 16 and 3 tests (including the
updated AI visibility checks), frontend build and lint. The final private-loader
failure test also passed after sharing the locked loader. Existing build-size
and test-client warnings remain; security advisors added no warning.

**Limits:** the current source's simulated reference policies expired on October
25. AI source features remain usable independently, but combined risk stays null
when fewer than five rules can be evaluated. Original amounts, names and dates
are used for AI; simulated arrival time or controls do not enter this model.
No policy validity period was silently extended. The 50,000-row synthetic SAR
batch, unrelated companies and old immutable results were not retrospectively
scored. Scores describe unusualness relative to the Fit population, not fraud
probability. S4 posting-to-alert timing remains unverified; the first observed
completion after model startup took 7.923 seconds, and no alert-latency pass is
inferred from this inference test.

A read-only production check confirmed all 47,531 active Payments records
already had AI scores. Production data/model/configuration was not modified.
Remote main remained `71ca4a0d5d12e1082ca3f415d5de7e99ca8f056f`; the staging
branch alone contains the new application release. This successful branch check
supersedes the earlier usage-limit interruption recorded above.

Evidence: [private storage checks](evidence/payments_feed_model_storage_2026-11-02.json),
[actual-model parity](evidence/payments_feed_model_parity_2026-11-02.json),
[hosted intake](evidence/payments_feed_ai_hosted_2026-11-02.json),
[CSV/XLSX acceptance](evidence/payments_feed_ai_uploads_2026-11-02.json),
[deployed browser](evidence/payments_feed_ai_browser_2026-11-02.json),
and [cleanup checks](evidence/payments_feed_ai_cleanup_2026-11-02.json).
See [model behavior and rollback](FEED_PAYMENTS_AI.md).

[Release summary](evidence/payments_feed_ai_release_2026-11-02.json).
