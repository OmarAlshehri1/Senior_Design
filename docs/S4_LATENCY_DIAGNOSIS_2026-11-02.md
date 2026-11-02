# S4 latency diagnosis - 2 November 2026

Later update: the user upgraded staging to always-on compute. The successful
after-inactivity follow-up took 2.347501 seconds on the same process, while an
8.059360-second intake outlier and an interrupted connection attempt remain
recorded. See [the paid-instance verification](S4_ALWAYS_ON_STAGING_2026-11-02.md).
The Free-service findings below are retained as historical evidence.

Warmed and small-concurrency staging checks now meet the five-second confirmation
target in the measured samples. The actual idle cold post took **66.404687
seconds**, with a verified new process. **Overall S4 remains not attained for
posting after inactivity on the current Free service.** Production and billing
were not changed.

## Measured causes and fixes

Opt-in producer timing separated app work from TCP/TLS and client wall time.
Posting app time was about 0.26 seconds in the baseline median. Fresh producer
connections repeatedly added connection/TLS and response overhead. The existing
producer simulator already uses a persistent client; the diagnostic comparison
confirms why a new client should not be created for every poll. The sample
median confirmation was 3.975450 seconds with fresh connections and 2.042691
seconds with a persistent client. The fresh cohort includes its first model-cold
request; these are declared conditions, not identical independent populations or
a statistically established speedup.

Receipt polling also made two authentication-related database HTTP calls.
`read_ingestion_receipts` already validates the active credential and source/
organization scope. The API now calls that atomic lookup directly, removing the
redundant preflight. No credential is cached. Observed median receipt app time
changed from 0.390418 to 0.146326 seconds in the compared samples. The remaining
client time includes transport, platform and other overhead; it is not all SQL.

The first transaction after a restart also carried model-loading work. Before
prewarm, that post took 6.858066 seconds to confirm. Database receipt-to-result
time was 5.165648 seconds; the interval from claim capture to result insertion
was 4.218127 seconds, versus roughly 0.4-0.5 seconds in nearby warmed cases.
The optional `INGESTION_PREWARM_PAYMENTS_BINDING` now loads and hash-verifies the
already-approved artifact before workers start or application readiness yields.
The first admitted transaction after that deployment confirmed in 2.867095
seconds. This is a controlled one-case before/after observation, not a guarantee.
Source/model eligibility, scoring thresholds and saved results were preserved.

## Observations retained

| Condition | Samples | Confirmed within 5 s | Maximum observed confirmation |
| --- | ---: | ---: | ---: |
| Original fresh connections, including first model load | 6 | 5 | 7.992328 s |
| Original persistent client | 6 | 6 | 2.406979 s |
| Receipt-read fix, first model-cold post | 1 | 0 | 6.858066 s |
| Receipt-read fix, warmed persistent client | 6 | 6 | 2.786018 s |
| Prewarm enabled, first admitted post after deployment | 1 | 1 | 2.867095 s |
| Both fixes, warmed persistent client | 6 | 6 | 2.220918 s |
| Both fixes, three simultaneous target posts | 3 | 3 | 3.363264 s |
| Both fixes, first HIGH post after verified idle restart | 1 | 0 | **66.404687 s** |

The concurrency phase also has three preparatory seed posts, all within five
seconds. Across all diagnostic phases, 33 transactions completed with real
AI/combined scores and corresponding HIGH alerts. All 165 rule outcomes and the
combined-score arithmetic matched expectations. The synthetic USD
1,000,000,000,000 fixtures exercise the alert path; they establish no fraud
detection accuracy or general model suitability. No earlier late observation is
discarded by the later successful cohorts.

Client durations use a monotonic timer from logical posting start to observed
committed HIGH result. Actual alert rows are verified independently, and HIGH
result/alert/job completion commit atomically. These are conservative commit
upper bounds. App timing headers exclude platform startup and response transport;
database insert times are not exact commit times. All these boundaries remain
separate.

## Actual idle cold-post experiment

The helper waited locally for 980 seconds without touching the staging backend.
The first HIGH post was scheduled for November 2 at 11:57:01 Riyadh time, with
no health warm-up. It completed at approximately 11:58:08. The process tag
changed, and app uptime at posting acknowledgment was only 12.446 seconds,
confirming that a newly started process handled this request. See
[cold experiment status](evidence/s4_latency_cold_status_2026-11-02.json).

The request acknowledged in 65.318744 seconds and its committed HIGH result was
observed in **66.404687 seconds**. TCP/TLS accounted for 1.713510 seconds, and
waiting for POST response headers accounted for 63.594866 seconds. The app's
timed POST handler took only 0.346124 seconds. Database receipt-to-alert insert
time was 1.145221 seconds. The long delay is outside the timed handler and
includes hosting/application startup; it is not explained by slow rule execution.
The insert duration does not replace the full cold posting measurement.

Render documents that Free web services sleep after 15 minutes without inbound
traffic and take about a minute to wake. Model prewarm prepares the model before
readiness but cannot remove that hosting delay. See
[Render Free service behavior](https://render.com/docs/free).

An always-on backend environment is the remaining hosting decision. Removing
Free idle behavior requires changing compute/hosting, followed by revalidation;
it does not justify an untested production latency guarantee. No paid upgrade,
keep-alive workaround or production deployment was performed.

## Verification and scope

The fixes run only on the existing staging backend. The final app release is
`be6d664a1aacd837ff1873ff420fdb4f5c5f8637`; the frontend was not redeployed.
Timing remains off by default. Only durations and random process tags are exposed
with the staging timing flag; no payloads, credentials, source identity or model
objects are included. Model prewarm is opt-in, uses the existing private verified
binding, and cannot authorize an otherwise ineligible source. A required invalid
binding prevents readiness rather than returning invented scores.

Focused validation passed 35 initial instrumentation/wakeup tests, 38 API/wakeup/
pipeline tests after the lookup change, and 85 API/model/lifecycle tests for the
final startup behavior. Tests cover one-RPC receipt reads, fresh credential
checks, revoked/invalid credentials, disabled feature behavior, timing privacy,
prewarm disabled/malformed/unavailable cases and prewarm before worker startup.
Hosted negative checks returned 401 for invalid credentials and 404 for another
source's receipt. Existing test-client deprecation warnings remain.

All performance fixtures belong to the separate
`SYNTHETIC-s4-latency-20261102` source. Original Payments records and earlier test
evidence are retained. After the cold experiment, the test producer was disabled
and its credential was verified rejected (401), with no timing headers. The
earlier temporary Admin remained disabled throughout this performance exercise.
All 33 test receipts/results/alerts remain. Other-source receipts stayed 51,082,
active Payments stayed 10,001, and the original Payments source stayed at 1,001.
No source credential or real transaction was included in published evidence.

Evidence: [phase summary](evidence/s4_latency_summary_2026-11-02.json),
[baseline fresh](evidence/s4_latency_baseline_fresh_2026-11-02.json),
[baseline pooled](evidence/s4_latency_baseline_pooled_2026-11-02.json),
[model-cold post](evidence/s4_latency_postdeploy_model_cold_2026-11-02.json),
[lookup fix](evidence/s4_latency_after_pooled_2026-11-02.json),
[prewarmed first post](evidence/s4_latency_postdeploy_prewarmed_2026-11-02.json),
[final warmed](evidence/s4_latency_final_pooled_2026-11-02.json),
[concurrent](evidence/s4_latency_final_concurrent_2026-11-02.json),
[actual cold request](evidence/s4_latency_actual_idle_cold_2026-11-02.json),
[database verification](evidence/s4_latency_database_2026-11-02.json),
[hosted access checks](evidence/s4_latency_access_2026-11-02.json), and
[cleanup](evidence/s4_latency_cleanup_2026-11-02.json).
