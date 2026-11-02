# Combined-risk and alert verification - 2 November 2026

Later update: [latency diagnosis and fixes](S4_LATENCY_DIAGNOSIS_2026-11-02.md)
verified faster warm/concurrent requests, but an actual idle cold post took
66.40 seconds on Free hosting. Overall S4 remains open. The observations below
are retained as the earlier checkpoint.

**Combined-risk scoring and HIGH alerts work on staging. S4 remains partial.**
Five of six timed HIGH results were confirmed within five seconds of posting;
one confirmation took 6.939203 seconds. A separate earlier HIGH alert has no
valid end-to-end completion observation after a transport failure. No production
or unconditional five-second guarantee is claimed.

## Current simulation references

The operator appended `payments-simulation-ai-20261102` for the existing staging
`payments-file-local` source. Its fictional history, registry and approval
references now expire **9 November 2026 at 03:00 Riyadh time**
(`2026-11-09T00:00:00Z`). These remain explicitly SIMULATED references and are not
real-company policy approval. Original valid-from dates, approver identities,
limits, currencies, registry entries, model binding and other settings were
preserved. The previous context, 1,001 source transactions and all 1,001 saved
results remain intact. Renewal affects future evaluations; it does not rescore
old imports or extend reference validity silently at application startup.

This was an explicit [staging operator action](sql/renew_payments_staging_simulation_references_20261102.sql),
not a schema migration. Application code remains the verified release
`845318b40aaa324b1e2d1bca68f82afba1f4351c`; no redeploy or paid resource was needed.
The actual Payments model, 60/40 risk formula, HIGH threshold and subthreshold
invoice-splitting rule were unchanged.

## Controlled hosted exercise

A separate source, `SYNTHETIC-combined-s4-20261102`, used current fictional
references, explicit actor/vendor namespaces, complete test fields, USD and
BUSINESS_EVENT_TIME. Its model declaration applies only to synthetic runtime
integration checks; it does not validate model accuracy or approve a new company
population. Original test timestamps are preserved. All requests used the public
staging intake API and actual hosted workers, without inserting results or alerts
from the harness.

The first 30 sequential cases exercised controls, all five individual violations,
duplicate/splitting history seeds and four-rule combinations. All completed with
full coverage, AI and combined risk. The planned four-rule combinations scored
MEDIUM (rule 80, AI 43.34, combined 65.34), so the initial expectation of HIGH
alerts failed. Those observations were retained, not relabeled or dropped.

A separate predeclared extreme-value extension used fictional USD
1,000,000,000,000 payments to exercise the HIGH branch. Its first seed generated
an actual HIGH alert, but receipt polling ended in `RemoteProtocolError`; that
pilot stopped after one accepted transaction. Its completion latency is
unavailable. The database later verified the saved alert. No error log entries
were returned for the checked one-minute backend window; the cause of the client
transport failure was not established.

A new predeclared follow-up used six fresh IDs and vendor/invoice groups with
the same extreme-value definition. It used fresh connections, bounded safe read
retries, and retained all elapsed retry time. Its six transactions produced AI
100 with combined risk 76 (three failures) or 88 (four failures). All generated
the expected HIGH alerts. Large single payments are outside below-limit
splitting candidates, so approval-limit and splitting failures are not forced to
coexist artificially.

Across all phases, **37/37 transactions completed**, all **185 rule outcomes**
matched the declared scenarios, all 37 had real AI and combined scores, and
**7 alerts** matched the HIGH-only policy. Combined-score arithmetic matched for
every record. Each audit completed in one attempt. These extreme synthetic cases
test execution paths and cannot establish detection or false-positive rates.

## Timing boundaries and result

| Timed follow-up | Risk score | Posting to observed committed HIGH result |
| --- | ---: | ---: |
| Group 1 seed | 76 | 4.853992 s |
| Group 1 duplicate | 88 | 2.668787 s |
| Group 2 seed | 76 | 3.327055 s |
| Group 2 duplicate | 88 | **6.939203 s** |
| Group 3 seed | 76 | 2.638734 s |
| Group 3 duplicate | 88 | 2.149187 s |

The producer used one monotonic clock from logical HTTP posting start through
the successful completed-result receipt response. A saved HIGH result commits
atomically with its alert; actual corresponding alert rows were independently
verified. The measured duration therefore gives a conservative upper bound on
posting-to-alert commit. Five upper bounds prove completion within five seconds
for those cases. The 6.939203-second bound does not prove that its exact commit
was late, but it cannot certify that case against the five-second deadline.
No read retry was needed in this six-case follow-up.

The late confirmation's posting acknowledgment alone took 4.302846 seconds.
Database receipt-to-alert **insert** time across all seven alerts ranged from
0.879213 to 1.434396 seconds. These same-database timestamps help separate worker
work from posting/observation delays. They start after posting began and are
insert timestamps, not exact commit timestamps. PostgreSQL commit timestamp
tracking is off and was not changed. These shorter values do not replace the
end-to-end result or close the missing pilot observation.

The initial health warm-up took 63.658305 seconds. The first non-alert control
also needed 6.977866 seconds to observe completion. The exercise was sequential
on a warmed service/model, with no initial queue backlog. It does not certify
cold-post, concurrent-load, production, WebSocket or browser-notification latency.
S4 is therefore **PARTIAL / not demonstrated for every deadline**, even though
combined-risk calculation and alert creation are verified.

## Access, replay and cleanup

Actual test-account login verified an authorized HIGH detail and denied an
unassigned source (403). Exact producer replay returned the same receipt (200);
the replayed transaction still had exactly one alert. The deployed browser showed
AI 100/100, combined risk 88 HIGH and five rule outcomes, with no runtime
exceptions or 390px page overflow. No human review decisions were created.

After verification, the temporary source was disabled, its producer credential
was rejected (401), and the temporary Admin was disabled through the audited
operation. Test sessions were logged out. All 37 receipts/results and 7 alerts
were retained. Other-source receipts remained 51,045; the original Payments
source remained at 1,001 records and active Payments at 10,001. Production,
main and deployment settings were not changed.

Next work is to diagnose posting/confirmation variability, test a first HIGH post
during cold start and declared concurrent load, and repeat the same timing
criteria with every interruption and over-deadline observation retained. Renewed
simulation references do not supply real-company policies. Production rollout
should not be presented as completion of S4 on this evidence.

Evidence: [reference renewal](evidence/payments_simulation_reference_renewal_2026-11-02.json),
[all initial HTTP observations](evidence/s4_combined_staging_http_2026-11-02.json),
[interrupted pilot](evidence/s4_combined_staging_extreme_http_2026-11-02.json),
[timed follow-up](evidence/s4_combined_staging_timed_http_2026-11-02.json),
[database rows and timestamps](evidence/s4_combined_staging_database_2026-11-02.json),
[aggregate assessment](evidence/s4_combined_staging_result_2026-11-02.json),
[browser checks](evidence/s4_combined_staging_browser_2026-11-02.json),
[access and replay](evidence/s4_combined_staging_access_replay_2026-11-02.json),
and [cleanup](evidence/s4_combined_staging_cleanup_2026-11-02.json).

Declared fixture plans: [initial cases](evidence/s4_combined_plan_base_2026-11-02.json),
[extreme-value pilot](evidence/s4_combined_plan_extreme_2026-11-02.json), and
[timed follow-up](evidence/s4_combined_plan_timed_2026-11-02.json). Their hashes
are recorded in the corresponding HTTP observations. Producer credentials and
browser sessions are excluded from these artifacts.
