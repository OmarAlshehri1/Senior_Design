# Varied-payload staging soak - 2 November 2026

Later follow-up: [separate body-reading, validation and fingerprint timings](S4_BODY_SPLIT_STAGING_2026-11-02.md)
are now deployed. Sixty additional large-payload requests all confirmed within
3.529236 seconds. The earlier three-second combined-stage delay did not recur;
its exact cause remains unconfirmed. The observations below remain preserved.

**Completed:** 86/86 transactions received full scoring and saved HIGH alerts.
**84/86 client confirmations met five seconds.** Two large-payload requests
took 5.625660 and 6.380250 seconds. Overall S4 remains partial under the existing
conservative request-to-confirmation check. The test source is disabled again;
production and billing are unchanged.

## Test contract

This is a bounded staging-only experiment on the already deployed transport
diagnostic application `82d40138225356686d2129f3b725378a09975d30`, using one
Singapore `0.5c-512mb` backend instance. No production, frontend, model,
authorization, rate-limit, retry or billing settings are changed for this test.

Ten rounds start one minute apart. Every round posts one sequential seed of
each payload size, then submits a burst of duplicate-payment test transactions.
Burst widths are **1, 3, 6, 9, 3, 6, 9, 3, 6, 9**. One final seed is scheduled
at 600 seconds, giving **86 planned requests**. Burst submission is concurrent;
completion time includes intake, processing and receipt polling. A shared
producer HTTP client allows up to 12 connections. Polls occur approximately
every 0.15 seconds after each receipt response. No failed POST is retried.

| Payload class | Typical body bytes | Synthetic amount (USD) |
| --- | ---: | ---: |
| Small | 530-543 | 1,000,000,000,000 |
| Medium | Approximately 16,560 | 2,000,000,000,000 |
| Large | Approximately 192,590 | 3,000,000,000,000 |

Additional payload volume is an unmapped `synthetic_notes` array. All strings
remain within the existing 16,384-byte field limit and every envelope is below
the existing 256 KiB transaction-event limit. All 86 planned envelopes were
validated offline with the application's existing parser before network use.
The sizes above apply to individual events, not company file-upload limits.
Padding consists of repeated synthetic characters and is highly compressible;
this does not model every possible database storage or payload-entropy pattern.

Every row belongs to the existing isolated
`SYNTHETIC-s4-latency-20261102` source and has a unique `PERF-soak-` event ID.
All names and amounts are fictional extreme-value integration fixtures. This
does not validate model accuracy on typical company transactions. The existing
source approval, trusted model, five audit rules and scoring formula are used.
Seed and duplicate cases are expected to produce HIGH alerts with all five
rules evaluated. These are business duplicate-payment cases with different
event IDs, not transport retries or repeated submission of the same event.

The runner saves each observation and live progress atomically, including
failed or late cases. It records actual round starts and stops if scheduling
drift exceeds 15 seconds, so local suspension cannot masquerade as a controlled
ten-minute workload. Request bodies and credentials are not published in the
trace evidence; payload byte counts and SHA-256 digests are recorded instead.

## Result

The experiment ran from **12:10:43 to 12:20:45 UTC** (15:10:43-15:20:45 Riyadh),
lasting 601.797 seconds. All ten scheduled rounds ran; maximum round-start
drift was 0.313 seconds. One backend process handled every observed call. All
86 POSTs were accepted and completed, with no transport errors, rejected
requests, blocked jobs or automatic retries in this run.

Overall median client confirmation was **2.119972 seconds**; nearest-rank sample
p95 was **3.360304 seconds** and sample p99 was **6.380250 seconds**. These are
sample statistics, not service-wide guarantees.

| Payload class | Confirmed within 5 seconds | Median | Maximum |
| --- | ---: | ---: | ---: |
| Small | 30/30 | 1.758408 s | 3.360304 s |
| Medium | 28/28 | 2.030032 s | 3.299747 s |
| Large | 26/28 | 2.651294 s | 6.380250 s |

| Concurrent burst width | Duplicate target requests within 5 seconds | Maximum |
| --- | ---: | ---: |
| 1 | 1/1 | 1.503592 s |
| 3 | 9/9 | 2.826711 s |
| 6 | 18/18 | 4.580449 s |
| 9 | 26/27 | 6.380250 s |

The burst table excludes 31 sequential setup/final seeds, of which 30 met five
seconds. It groups only concurrently submitted duplicate targets. Every missed
deadline remains in the observations and summary.

## Review of the two missed deadlines

| Event | Context | Client confirmation | Body-reading/parsing phase | Intake persistence RPC | DB receipt to alert insertion |
| --- | --- | ---: | ---: | ---: | ---: |
| `PERF-soak-07-large-duplicate-5` | 192,596 bytes, burst of nine | 6.380250 s | 2.997998 s | 0.219104 s | 0.699476 s |
| `PERF-soak-09-large-seed-0` | 192,586 bytes, sequential seed | 5.625660 s | 3.310238 s | 0.268425 s | 0.681217 s |

The existing `parse` phase starts before reading the request stream, then
includes envelope validation, fingerprint construction and hashing. Thus three
seconds in that phase does **not** establish three seconds of CPU parsing.
It can include waiting for the inbound body and event-loop scheduling. One
case occurred before its burst, so the evidence does not establish concurrency
as the sole cause. The exact transport/CPU split remains unmeasured.

Both cases show a delay before receipt persistence, followed by completed
scoring and saved alerts. The earlier six-second persistence-RPC wall delay did
not recur: the largest POST persistence-RPC duration in this run was
0.601449 seconds. These new deadline misses therefore do not reproduce that
specific earlier delay. Client response transport and polling also contribute
to the confirmation upper bound.

**Next diagnostic:** measure request-body receiving separately from JSON
validation/fingerprinting, then compare large-payload requests under sequential
and burst traffic. The current evidence does not justify a particular SQL,
worker-count or compute-plan change. No application change or claimed latency
fix was made during this experiment.

## Database reconciliation and cleanup

All 86 event IDs, stored payload byte counts, results and HIGH alerts were
matched. All **430 expected rule outcomes** were checked. Every audit completed
in one attempt, with AI score 100 and unchanged combined scores (76 for seeds,
88 for duplicates). Recorded database receipt-to-alert insertion intervals were
at most **1.530439 seconds**. These timestamps do not identify the exact commit
instant and do not prove browser-notification delivery. The conservative client
clock starts before upload; the database interval starts after the recorded
receipt. These are different measurement boundaries.

The test producer was disabled again, and its credential was verified rejected
with 401 and no timing headers. Its historical receipts now total 170, including
86 new ones. Other-source receipts remained 51,082; the original Payments source
remained 1,001. No existing records were reset, reimported or deleted. Earlier
Free-hosting, paid-hosting and connection-failure evidence remains preserved.

Evidence: [live progress](evidence/s4_soak_progress_2026-11-02.json),
[all observations](evidence/s4_soak_probe_2026-11-02.json),
[summary and late cases](evidence/s4_soak_summary_2026-11-02.json),
[database verification](evidence/s4_soak_database_2026-11-02.json),
[cleanup](evidence/s4_soak_cleanup_2026-11-02.json), and
[previous transport investigation](S4_INTAKE_TRANSPORT_2026-11-02.md).
