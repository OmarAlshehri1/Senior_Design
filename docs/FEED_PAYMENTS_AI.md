# Payments AI on the company-feed path

The existing Payments primary dataset uses the source-specific
`payments-primary-no-calendar-1.0.0` model. The feed worker now supports the same
trusted artifact for newly received Payments records, using a separately pinned
source context. This does not approve the model for unrelated companies.

The model's four features describe original payment amount and frozen exact
source-name frequency/deviation. Arrival time, simulated actors/limits,
department, rule results and fraud labels do not enter this model. A precise
original timestamp or original date is accepted by the source adapter; year-only
dates, missing names, non-positive amounts and non-USD inputs remain unscored.
No missing department or approver role is invented to satisfy the older retail
feature contract.

`PaymentsModelApproval` pins the exact model/feature versions, artifact hash,
dataset key, private bucket/object, population/validation references and USD
currency. It lives in immutable operator-managed context, outside producer
payloads. The private loader checks the downloaded hash and dataset binding,
serializes first loads and caches the verified model. There is no retail-model
fallback. Unavailable or corrupt approved artifacts block the job rather than
returning a substitute score.

AI inference can run when deterministic audit context is incomplete because its
features do not use those rules. Combined risk remains null until all five rules
are evaluated. With complete coverage, the existing 60% rule / 40% AI calculation
and risk thresholds remain unchanged. Database commit checks independently
verify the model identity, source-feature declaration, currency, coverage and
combined score. Existing simulation-clock evidence and clock labels remain in
place; allowing source-only inference does not turn simulated rule timing into
actual business-event evidence. The older retail model remains ineligible for
simulation-clock scoring.

Feed Review details expose the saved AI score through the existing source-scoped
read RPC. They explain its meaning and why combined risk can remain unavailable.
Private model objects, hashes and source configuration are not added to the
review response.

Rollout uses the two additive migrations
`20261102064921_payments_feed_source_model.sql` and
`20261102065319_feed_ai_score_visibility.sql`, the compatible backend/frontend
release, private model provisioning and a new context version for the selected
Payments source. Enable `INGESTION_FEED_ANOMALY_ENABLED` only in the intended
staging backend. Record hosted acceptance separately before production rollout.
Existing contexts, results, scores, receipts and completed jobs are retained;
activation applies to future transactions and does not rescore old imports.

Rollback disables the staging scoring flag and restores the source's previous
context pointer for future work. Keep both immutable context versions and saved
results. No database reset, dataset replay or model retraining is required.

Scores are ranks relative to the Fit payment population, not fraud probabilities.
The existing source-model validation and provenance are documented in
[the Payments release](PAYMENTS_PRIMARY_DATASET_RELEASE.md). Runtime integration
acceptance does not establish detection or false-positive rates for new company
data, and AI scoring alone does not establish S4 alert timing.
