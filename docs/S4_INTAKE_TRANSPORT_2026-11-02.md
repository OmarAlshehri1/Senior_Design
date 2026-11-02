# Intake transport investigation - 2 November 2026

Later follow-up: the [ten-minute varied-payload soak](S4_SOAK_STAGING_2026-11-02.md)
completed 86 additional transactions with full scoring and HIGH alerts. Of
these, 84 client confirmations met five seconds; two large-payload requests
took 5.625660 and 6.380250 seconds, including about three seconds in the combined
body-reading/parsing phase. The previous six-second persistence-RPC delay was
not reproduced. The original 37-case observations below remain preserved.

The earlier **8.059360-second** request was **not reproduced** in 37 new staging
requests. Every new request completed with five evaluated rules, a real AI score
and a saved HIGH alert within five seconds. The previous miss remains recorded;
this investigation does not establish its exact cause or an unconditional S4
guarantee. **Overall S4 remains partial because historical misses remain.**

## Change and scope

Application commit `82d40138225356686d2129f3b725378a09975d30` was deployed to
`m004-reports-staging-api` by `dep-dbk76oflk1mc73b29i00`, live at
11:27:34 UTC. The service remains one `0.5c-512mb` Singapore instance. This work
changed no production service, frontend, schema, model, threshold, retry policy
or billing configuration.

The existing opt-in timing flag now separates RPC thread dispatch, shared-client
acquisition, full HTTP duration, TCP/TLS connection events, HTTP/1.1 sending,
response-header waiting, body reads and JSON decoding. A request-local context
passes the collector into the worker thread and resets it after the call.
Workers without an explicit collector do not emit these measurements.

Only fixed phase durations enter successful authorized producer responses.
Transport metadata is never inspected, logged or exposed by the callback.
Credentials, URLs, source records and transport exception details stay out of
the headers. Tracing is off by default. See [the timing contract](INGESTION_TIMING.md).
The trace mechanism follows the [HTTPX extension documentation](https://www.python-httpx.org/advanced/extensions/).

## Measurements

| Cohort | Requests | Confirmation interval | Result |
| --- | ---: | --- | --- |
| First measured post after deployment | 1 | 2.125896 s | Within 5 s |
| Sequential requests with a persistent producer connection | 30 | 1.352844-1.702538 s | 30/30 within 5 s |
| Concurrent cohort, including setup | 6 | 1.455417-2.086781 s | 6/6 within 5 s |

The concurrent cohort consists of three sequential setup seeds followed by
three simultaneously submitted duplicate targets. It does not represent six
simultaneous submissions. Across all 37 requests, median confirmation was
**1.461707 seconds**, nearest-rank sample p95 was **2.086781 seconds**, and the
maximum was **2.125896 seconds**. No requests failed or were retried in this run.

Measured maxima across authorized route RPCs were:

| Stage | Maximum observed |
| --- | ---: |
| Dispatch into repository worker | 0.012533 s |
| Shared HTTP-client acquisition | 0.000029 s |
| Complete RPC HTTP call | 0.371594 s |
| TCP setup event, including DNS work within that event | 0.004895 s |
| TLS setup event | 0.008892 s |
| HTTP response-header waiting | 0.269494 s |
| Response-body reading | 0.093044 s |

These are per-stage maxima from different calls, not components of one worst
request. Enclosing and nested durations overlap. Zero connection durations mean
no corresponding setup event was observed, typically on a reused connection.
HTTP-header waiting combines transport and upstream waiting; it does not isolate
SQL execution. Unattributed HTTP time can include connection-pool and scheduling
waits, so it must not be labelled measured pool contention.

No sustained dispatch/client-acquisition bottleneck or six-second upstream
wait was observed in this run. The previous intake RPC was not instrumented at
this detail, so these newer traces cannot retrospectively classify its 6.156521
seconds. That earlier request had a 0.805988-second recorded database
receipt-to-alert insertion interval; the delay was before or around intake.
The current data supports collecting another slow detailed trace before
selecting a transport, SQL or pool change.

## Verification and cleanup

Focused API, transport, model and worker-lifecycle validation passed **89 tests**.
The four new transport tests cover propagation through real thread dispatch,
concurrent collector isolation, default-off behavior, privacy, context cleanup,
no automatic retry after transport failure, and no timing headers on a failed
authorization response. Existing Starlette test-client deprecation and local
pytest cache-permission warnings remain.

All 37 accepted requests were matched by event ID against stored audit results
and HIGH alerts. All **185 rule outcomes** matched the expected synthetic case,
and audit attempts were one per transaction. AI scores were 100; combined scores
were 76 for seeds and 88 for duplicates under the unchanged formula. These
fictional extreme amounts exercise integration, not model accuracy. Recorded
database receipt-to-alert insertion intervals were at most 0.952312 seconds;
insertion timestamps do not establish the exact commit instant. Client
confirmation times conservatively include intake, processing and polling.

The isolated `SYNTHETIC-s4-latency-20261102` source was disabled again and its
credential returned 401 without timing headers. Its historical receipts total
84, including the 37 new requests. Other-source receipts remained 51,082 and
the original Payments source remained 1,001. Earlier late and failed samples
were preserved. Production was untouched.

Evidence: [all 37 transport traces](evidence/s4_intake_transport_probe_2026-11-02.json),
[summary](evidence/s4_intake_transport_summary_2026-11-02.json),
[database verification](evidence/s4_intake_transport_database_2026-11-02.json),
[cleanup](evidence/s4_intake_transport_cleanup_2026-11-02.json), and
[earlier paid-instance observations](S4_ALWAYS_ON_STAGING_2026-11-02.md).
