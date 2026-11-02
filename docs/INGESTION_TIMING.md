# Staging ingestion timing

With the same opt-in flag, each RPC also reports duration-only fields prefixed
by its route phase (for example, `persist_rpc_tcp` and `read_rpc_wait`):

- `dispatch`: elapsed time before the repository begins, including thread dispatch.
- `lease`: acquiring the shared HTTP client, including initial construction or shutdown waiting.
- `http`: the complete HTTP call, including transport/pool/upstream waiting.
- `tcp`: observed TCP connection events, including DNS work within that event.
- `tls`: observed TLS setup events.
- `send`: observed HTTP/1.1 header/body sends.
- `wait`: waiting for HTTP/1.1 response headers; this includes network and upstream waiting, not just SQL.
- `body`: observed response-body reads.
- `decode`: JSON decoding after the HTTP response succeeds.

Zero TCP/TLS duration means no such event was observed, as with a reused
connection. These subdurations overlap the enclosing RPC/http durations and
must not be summed with their parents. Unattributed HTTP time can include pool
waiting and scheduling; it is not separately established as pool contention.
The collector uses request context propagated into the worker thread and is
reset after every call. Background worker calls do not enable it implicitly.
The trace callback ignores all transport event metadata and records only a
fixed allowlist of phase durations. No headers, URLs, payloads, response bodies,
credentials, retry behavior or network settings are changed by tracing.

The HTTP trace interface is documented in [HTTPX extensions](https://www.python-httpx.org/advanced/extensions/).

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
producer-to-backend connection/TLS setup and response transmission. Backend-to-database
transport is included in the RPC measurements. Receipt response serialization
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
