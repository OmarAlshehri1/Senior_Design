# Request-body timing verification - 2 November 2026

**The timing split is deployed and verified.** All 60 new approximately 192 KB
requests completed with full scoring and saved HIGH alerts within five seconds.
Validation plus fingerprinting took at most **9.798 ms** per request; observed
body reception reached **512.622 ms**. The earlier three-second combined-stage
delay was not reproduced, so its exact cause remains unconfirmed. S4 remains
partial under the existing conservative client-confirmation assessment; earlier
misses are retained.

## Change

The successful POST timing now reports `body_read`, `validate` and `fingerprint`
separately. The existing `parse` field remains their enclosing duration, which
preserves comparisons with earlier evidence. Source authentication still runs
before body reading. Payload bounds, original text, source checks, fingerprints,
rate limits, model scoring and alert processing retain their existing behavior.
No retry or transport setting was changed.

`body_read` measures reading the ASGI request stream, including waits, buffering
and scheduling during that phase. Some bytes may already have arrived or been
buffered by the platform before authentication or before the read starts; this
is not a measurement of total client upload time. Validation and fingerprint
timings are elapsed durations, not CPU-profiler measurements. Parent and child
durations overlap and must not be summed together. See [the timing contract](INGESTION_TIMING.md).

Application commit `474165891d8c88c884742eb8d404a97efb6ebc89` became live on
staging in deploy `dep-dbkalkp42hec73f4j3qg` at 15:24:09 UTC. The backend remains
one `0.5c-512mb` Singapore instance, with opt-in diagnostics enabled only on
staging. Production, frontend, schema and billing were unchanged.

## Validation

**90 focused tests passed.** The new deterministic test advances a simulated
clock during two body receives, envelope validation and fingerprinting. It
verifies that each delay enters only its corresponding child phase, that
`parse` still encloses them, and that the submitted original text and fingerprint
are unchanged. Existing tests cover default-off headers, failed authorization,
payload bounds, privacy, concurrent RPC collectors, model readiness and worker
lifecycle. The existing Starlette test-client deprecation warning remains.

All 60 planned envelopes were validated offline before network use. The hosted
test ran from **15:25:03 to 15:26:30 UTC** (18:25:03-18:26:30 Riyadh), with one
backend process throughout. It used the existing isolated
`SYNTHETIC-s4-latency-20261102` source. Twelve sequential requests were followed
by four batches of three sequential setup seeds and nine simultaneously
submitted duplicate targets. Ten seconds separated consecutive burst batches.
No delays, failures or retries were artificially injected.

| Cohort | Requests | Median confirmation | Maximum confirmation |
| --- | ---: | ---: | ---: |
| Initial sequential requests | 12 | 1.640227 s | 3.154706 s |
| Sequential burst-setup seeds | 12 | 1.847776 s | 2.163026 s |
| Four bursts of nine targets | 36 | 2.892578 s | 3.529236 s |
| Overall | 60 | 2.444617 s | 3.529236 s |

All 60 client confirmations met five seconds; sample nearest-rank p95 was
3.368723 seconds. Every request used 192,586-192,609 bytes. Repeated unmapped
synthetic notes provide highly compressible padding, and fictional extreme
amounts exercise scoring integration. This is not validation of all possible
payload entropy patterns or model accuracy on actual company transactions.

| POST phase | Median elapsed time | Maximum elapsed time |
| --- | ---: | ---: |
| Body reading | 0.7665 ms | 512.622 ms |
| Envelope validation/source matching | 0.4285 ms | 8.622 ms |
| Fingerprint construction/hash | 0.8935 ms | 5.121 ms |
| Enclosing body/validation/fingerprint phase | 2.000 ms | 515.356 ms |

The per-request maximum for **validation plus fingerprinting** was 9.798 ms;
adding the individual maxima would combine different requests. The observed
longer combined-phase intervals in this run occurred during body reading.
There is no observed sustained validation/fingerprint bottleneck here. This
does not retrospectively prove that body transfer caused the earlier
2.997998- or 3.310238-second combined-phase observations, because those did not
have separate timing fields.

## Outcome and retained limits

The instrumentation now makes a future slow body-receive interval distinguishable
from validation/fingerprinting work. The earlier slow tail did not recur in this
fixed-size sample; **no latency improvement or root-cause fix is claimed** from
adding timing counters. Earlier request and connection failures are retained in
the linked reports. These sample confirmations do not prove an unconditional
latency guarantee or browser notification delivery.

All 60 event IDs and payload byte counts matched stored results and HIGH alerts.
All **300 expected rule outcomes** were verified, with one audit attempt each,
AI score 100, and combined risk 76 for seeds or 88 for duplicate cases under the
unchanged formula. Recorded database receipt-to-alert insertion intervals were
at most 1.659924 seconds; those timestamps do not establish the exact commit
instant. The client clock starts before uploading, whereas this database
interval starts after the recorded receipt.

The synthetic test source was disabled again and its credential returned 401
without timing headers. Its historical receipts total 230, including 60 new
ones. Other-source receipts remained 51,082 and the original Payments source
remained 1,001. Existing records and previous evidence were retained.

Evidence: [all 60 request traces](evidence/s4_body_split_probe_2026-11-02.json),
[summary](evidence/s4_body_split_summary_2026-11-02.json),
[database verification](evidence/s4_body_split_database_2026-11-02.json),
[cleanup](evidence/s4_body_split_cleanup_2026-11-02.json), and
[previous varied-payload soak](S4_SOAK_STAGING_2026-11-02.md).
