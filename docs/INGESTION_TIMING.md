# Staging ingestion timing

Set `INGESTION_TIMING_ENABLED=true` only on the intended staging backend to
diagnose successful producer POST and receipt GET requests. Default is off.
Response bodies, source scope, rate limits and durable worker processing retain
their existing contracts.

Receipt reads now call `read_ingestion_receipts` directly after credential-format
validation. That restricted function validates the currently active credential
and source/organization scope atomically. Removing the earlier redundant
`ingestion_source` lookup saves one database HTTP round trip per poll, without
authorization caching. POST retains its pre-parse source authentication.

`Server-Timing` reports milliseconds spent in `auth_rpc`, `parse`, `persist_rpc`
for POST, `read_rpc` for receipt GET, and total `app` time. RPC durations include thread-pool waiting,
database HTTP transport and database execution; they do not isolate SQL time.
Application time begins in the producer authentication dependency and ends when
the handler prepares its successful response. It excludes platform wake-up,
connection/TLS setup and response transmission. Receipt response serialization
after the handler is also outside this duration.

`X-Ingestion-Instance` is a random process tag and `X-Ingestion-Uptime` reports
process uptime in seconds. They help distinguish a new process from a warmed
one. Neither contains a PID, host identity, user, source or credential. These
headers are emitted only with the timing flag, and no payloads or credentials
are logged by this instrumentation. Failed/unauthorized responses do not receive
timing headers.

Compare these server measurements with monotonic producer wall time and local
TCP/TLS traces. The difference between client and app time includes transport,
platform and unmeasured overhead; do not label all of it as SQL or network time.
Connection reuse and client retries must be declared, and retry time must remain
inside posting-to-confirmation measurements. An insert timestamp alone is not
an exact database commit timestamp.

Cold testing requires a declared idle/startup condition and an observed process
tag/uptime. Do not claim a cold-start pass from a warm-up health request followed
by a warmed transaction. Disable the timing flag to remove these headers; this
does not change source credentials or stored transactions.

## Preparing the approved model before readiness

For the scoped Payments model, an operator can set
`INGESTION_PREWARM_PAYMENTS_BINDING` to a JSON `PaymentsModelApproval` binding.
It must identify the already-approved model version, feature version, artifact
hash, dataset key and private storage object, with the existing validation and
population references. This is server configuration, not producer input, and
must not contain credentials or model bytes.

When ingestion, audit and feed AI are enabled, app startup loads and verifies
that binding before starting workers or yielding readiness. Source-specific
eligibility checks still apply to every job. Missing configuration preserves the
previous lazy loading behavior; disabled AI never preloads a model. Invalid or
unavailable required bindings fail startup without accepting requests or starting
workers, rather than inventing a score. The shared locked model cache is reused
by normal inference. Existing saved results are not changed.

This moves model download/deserialization out of the first admitted transaction.
It does not eliminate a hosting platform's idle spin-up time, which remains part
of a real cold posting request and must be measured separately.
