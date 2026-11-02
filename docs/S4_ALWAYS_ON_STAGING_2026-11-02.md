# Always-on staging latency verification - 2 November 2026

Later follow-up: [detailed intake transport investigation](S4_INTAKE_TRANSPORT_2026-11-02.md)
added duration-only tracing and measured 37 additional requests, all confirmed
within 2.125896 seconds. The earlier 8.059360-second miss was not reproduced;
its exact cause remains unestablished. The observations below are preserved.

## Scope

The user upgraded only `m004-reports-staging-api` to the `0.5c-512mb` compute
plan. Render confirmed one Singapore instance and a live service-update deploy,
`dep-dbk5p4vlk1mc73auas1g`, at 09:50:13 UTC. Deployed commit:
`241da96a8cb2e06a10ec30e10cb83472ca8930c8`. This contains the same application
code as `be6d664a1aacd837ff1873ff420fdb4f5c5f8637` plus evidence documentation.
No production, frontend, migration, model, scoring formula or threshold changes
were made for this verification.

## Initial measurements

The existing isolated `SYNTHETIC-s4-latency-20261102` producer was temporarily
enabled for these tests. Cases use fictional HIGH-risk Payments transactions,
all five rules and the previously approved model. This exercises integration,
not model accuracy on actual company data.

| Cohort | Cases | Confirmation time | Confirmed within 5 seconds |
| --- | ---: | --- | ---: |
| First measured post after upgrade | 1 | 2.139995 s | 1/1 |
| Sequential pooled requests | 6 | 1.271105–8.059360 s | 5/6 |
| Three concurrent duplicate submissions | 3 | 1.512615–2.316614 s | 3/3 |

The concurrent cohort also includes three sequential setup seed transactions;
these are not counted as simultaneous submissions. All initial 13 transactions
completed in one audit attempt, with real AI scores, all five rules evaluated
and saved HIGH alerts.

One pooled case took 8.059360 seconds. Its intake RPC wall duration was
6.156521 seconds, while the application authentication call took 0.095569
seconds. The recorded database receipt-to-alert insertion interval was 0.805988
seconds. This places the observed delay before or around intake persistence,
not in the rule/model evaluation pipeline. The timing includes transport,
pooling and upstream waiting; it does not prove SQL execution itself was slow.
No retries or discarded measurements hide this case.

Confirmation times are conservative client observations of completed results.
The result and alert are committed atomically and independently checked in the
database. Database insertion timestamps support diagnosis but do not establish
the exact commit instant. The client interval includes upload, intake,
processing, polling and response transport.

## Inactivity check

The scheduled probe waited locally without test requests. Its planned post was
10:08:14 UTC, but local execution was delayed: the recorded attempt started at
10:31:08 UTC and failed during TCP connection with `ConnectError` in 0.027193
seconds, before any backend response. Database verification found no receipt
for that event. The reason for the local scheduling delay was not established;
the interrupted probe cannot establish a latency or process-restart result.

A separately recorded follow-up at 11:20:19 UTC completed in **2.347501 seconds**.
This was approximately 89 minutes after the last successful test request. The
POST reported the same process tag, `b6245eb8b8034d42a730ac7958f14f15`, with
5387.658 seconds uptime. The process therefore remained running across this
interval, and the earlier 66.404687-second Free-service restart delay did not
recur in this successful after-inactivity observation. No automated keepalive
requests were used. This describes test traffic; other people's traffic was
not independently excluded.

The failed connection and its delayed scheduling are retained, rather than
relabelled as a successful 980-second experiment. The prior Free-service
measurement is preserved in the earlier assessment.

## Assessment

**The observed inactivity restart problem is resolved in the successful paid
follow-up, but overall S4 remains partial under the conservative client
request-to-confirmation check.** Of 14 accepted requests, 13 confirmed within
five seconds; one took 8.059360 seconds. One additional connection attempt
failed before intake. Every accepted transaction completed with all five rules,
an AI score and a saved HIGH alert in one audit attempt. Recorded database
receipt-to-alert insertion intervals ranged from 0.487592 to 1.145205 seconds.
These small synthetic samples and insertion timestamps do not prove an
unconditional latency guarantee or browser notification delivery.

The remaining investigation is intermittent backend-to-database intake latency,
including transport and upstream waiting. Do not attribute the six-second RPC
wall interval to SQL alone or change scoring behavior to mask it.

The test source was disabled again and its credential returned 401 without
timing headers. Its 47 historical receipts remain, including 14 from this
exercise. Other-source receipts stayed at 51,082 and the original Payments
source stayed at 1,001. No production changes were made. The user's paid staging
plan remains enabled; this verification made no further billing changes.

Evidence: [first post](evidence/s4_latency_paid_first_2026-11-02.json),
[pooled requests](evidence/s4_latency_paid_pooled_2026-11-02.json),
[concurrent requests](evidence/s4_latency_paid_concurrent_2026-11-02.json),
[interrupted inactivity probe](evidence/s4_latency_paid_after_idle_2026-11-02.json),
[probe status](evidence/s4_latency_paid_idle_status_2026-11-02.json),
[successful after-inactivity follow-up](evidence/s4_latency_paid_idle_followup_2026-11-02.json),
[database checks](evidence/s4_latency_paid_database_2026-11-02.json),
[cleanup](evidence/s4_latency_paid_cleanup_2026-11-02.json),
and [prior Free-service assessment](S4_LATENCY_DIAGNOSIS_2026-11-02.md).
