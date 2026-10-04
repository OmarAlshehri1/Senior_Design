# Phase 23 performance and requirements evidence

Updated: 2026-10-04. This report measures recorded project targets only, as requested by the project owner. No official rubric was found in the repository or supplied for this run, so this is not a formal rubric mapping. The targets below must not be presented as verified rubric wording.

## Current local transaction-path benchmark

The reproducible harness `backend/scripts/benchmark_local_processing.py` called the real FastAPI `POST /api/v1/transactions` route, five versioned audit rules, Isolation Forest artifact `1.0.0` (400 trees), and versioned 60/40 risk scorer. The benchmark ran on Windows 11, Python 3.12.10, eight logical processors, FastAPI 0.141.1, httpx 0.28.1, NumPy 2.5.3, scikit-learn 1.9.1, and Starlette 1.7.0. The app source was `main` commit `8365692`; the exact harness SHA-256 is recorded in the JSON evidence.

It generated 10,000 synthetic high-risk transactions: 1,250 requests for each of four concurrency levels (1, 4, 8, 16), in each of two Gemini modes. Ten warm-up requests per Gemini mode were excluded. Every measured POST returned `201`, completed scoring, and called the alert-creation stub once; there were zero failed requests. The two Gemini modes were the application's optional-failure path and a deterministic local explanation stub. No Gemini or other external API request was made.

| Gemini mode | Concurrent requests | Throughput (requests/s) | Request p95 (ms) | Stub alert creation p95 (ms) | Failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| Disabled | 1 | 31.507 | 45.893 | 45.136 | 0 |
| Disabled | 4 | 32.036 | 161.371 | 147.164 | 0 |
| Disabled | 8 | 35.145 | 271.341 | 244.114 | 0 |
| Disabled | 16 | 38.061 | 476.836 | 433.807 | 0 |
| Local stub | 1 | 53.352 | 26.489 | 25.773 | 0 |
| Local stub | 4 | 40.089 | 126.715 | 113.121 | 0 |
| Local stub | 8 | 45.070 | 241.879 | 216.024 | 0 |
| Local stub | 16 | 50.240 | 438.105 | 399.845 | 0 |

Request latency measures the in-process request from ASGI dispatch through the API response. Alert latency ends when the in-memory alert-creation stub is called. The committed Isolation Forest artifact was used with `n_jobs=1` for this controlled run; its parallel execution setting was not benchmarked. All Supabase reads/writes, including transaction insert, rule-history reads, score writes, and alert persistence, were replaced with in-memory stubs. There was no network listener, database, or connected WebSocket client.

The measured local path exceeds the recorded project target of 10,000 transactions/day when its observed requests/second are arithmetically scaled to 86,400 seconds. That extrapolation is not a full-day run. Because database and network costs were stubbed and model parallelism differed from normal settings, these results do not establish hosted throughput, production alert latency, Supabase capacity, or a production SLA. The target remains unverified for the deployed system and must be tested in Phase 24's approved topology.

Reproduce from the repository root in PowerShell:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe scripts\benchmark_local_processing.py `
  --requests-per-scenario 1250 `
  --concurrency 1,4,8,16 `
  --warmup-requests 10 `
  --output ..\docs\evidence\phase23_local_processing_2026-10-04.json
```

The script blanks Supabase and Gemini credentials before importing the app and replaces every transaction-related persistence call. It does not inspect live records or write to a database. The machine-readable result is [phase23_local_processing_2026-10-04.json](evidence/phase23_local_processing_2026-10-04.json).

## Existing scoring and coverage evidence

The five versioned rules are Segregation of Duties, Approval Limits, Duplicate Payment, Invoice Splitting, and Ghost Vendors. Their eligibility, independent evaluation, required historical context, rule versions, and scoring behavior have focused tests in `backend/tests/test_audit_rules.py` and integration tests in `backend/tests/test_transactions.py`. The public API exposes the rule catalog and authoritative latest-snapshot coverage through `/api/v1/audit-rules` and `/api/v1/analytics` (PR #33 / Phase 20). Rule score, anomaly score, and combined score version `1.0.0` retain the agreed formula `0.60 * rule_score + 0.40 * ai_score`; relevant tests are in `test_risk_scoring.py`, `test_anomaly_model.py`, and `test_transactions.py`.

Historical records conflict on the Phase 7 coverage denominator: the implementation plan reports 10,001 transactions, while an earlier API-contract entry reported 10,011. The initial persisted anomaly-score backfill separately records 10,001 scores. The current live database was not queried for this phase, so neither the historical count nor the percentage is a current live baseline. The denominator discrepancy remains unresolved pending a controlled historical artifact or approved database verification.

`backend/models/isolation_forest_v1_metrics.json` records model version `1.0.0`, 7,000 training rows, 1,500 validation rows, 1,500 held-out test rows, one record without a label, threshold 90.6, held-out detection rate 87.04%, and held-out false-positive rate 3.45%. The artifact was added in commit `3948c0d` on 2026-10-02 (PR #17). These are saved historical evaluation metrics; model retraining and a fresh labeled-dataset evaluation were not performed in Phase 23 because the training pipeline reads stored transactions. They meet the recorded project targets in that historical run, not a newly repeated test.

The Phase 10 project record reports 3,556.213 ms from request to persisted alert and 4,660.189 ms end-to-end through WebSocket. Those are historical observations from one run. This phase's local stub latency is a separate measurement and does not replace a current hosted alert-delivery benchmark.

## Project-target status and unresolved items

This run distinguishes Omar's requested handoff work from rubric requirements. No official rubric wording was available, and the owner asked to measure the recorded project targets. Therefore no C1/C3/IS1/IS3 grading interpretation is asserted. Coverage, anomaly metrics, five-rule evidence, 60/40 scoring, and daily scheduling are recorded with their source and evidence date/status; live or deployed claims remain pending verification. PDF remains conditional because no confirmed requirement was found.

The automated test suites establish correctness under their fixtures and isolated PGlite database tests. They do not constitute real-world load evidence. A full throughput, persisted-alert-latency, WebSocket-delivery, and Gemini-network comparison requires the Phase 24 approved hosting topology and must not use production data for test payloads.
