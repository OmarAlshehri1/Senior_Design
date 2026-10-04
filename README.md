# Continuous Auditing System for SMEs in the Retail Sector Using Real-Time Transaction Monitoring

Senior Design project for team **M004**.

This repository is a monorepo containing the React frontend, FastAPI backend, and shared API contract. The system monitors standardized retail transactions, evaluates audit rules and anomalous behavior, produces a unified risk assessment, and delivers high-risk alerts.

Main includes PR #22 and PRs #26-35: transaction/audit/report integration, Auth/RBAC, reviews/audit history, team-scoped assignments, notifications, case/SLA workflows, vendor monitoring, authoritative analytics, and Admin-managed organization settings. The project owner reports Supabase migrations 012-020 applied successfully; this was not independently queried.

Phases 17-21 are merged. Automatic report scheduling and performance evidence remain Phases 22-23. Private evidence storage/scanner configuration, approved deployment settings, and final three-role E2E remain in Phase 24. Phase 13A separates insert-only runtime creation (`409` on duplicate ID) from offline seed upsert. `TRANSACTION_RECOVERY_ENABLED` remains false; the legacy processing path while disabled still uses separate persistence steps. See [the recovery design](docs/TRANSACTION_RECOVERY_DESIGN.md).

See [the backend plan](docs/BACKEND_IMPLEMENTATION_PLAN.md) and [frontend evidence](docs/FRONTEND_IMPLEMENTATION_PLAN.md). Omar's [handoff requests](docs/Backend_Final_Handoff_Tasks.docx) define the approved remaining scope; no official rubric was found in the repository. PDF is conditional on a confirmed requirement. Render/Vercel were selected. Merging PR #26 triggered a successful Vercel Production deployment; planned deployment configuration, security review, and final E2E remain in Phase 24. The Render free/paid plan is undecided.

## Architecture

The target data flow is (ERP/POS integration is not established by the offline seed tool):

```text
ERP/POS
  -> FastAPI
  -> PostgreSQL/Supabase
  -> Audit Rule Engine + Isolation Forest
  -> Backend-owned unified risk score
  -> WebSocket alerts and REST API
  -> React dashboard
```

The frontend displays backend results but is never the authoritative source for audit decisions. The backend owns validation, rule evaluation, anomaly scoring, risk classification, alert creation, and persistence. Excel is an offline seed/evaluation source, not a runtime website data source.

## Repository structure

```text
.
├── frontend/                 React and Vite application
│   ├── public/
│   ├── src/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.js
├── backend/                  FastAPI API, persistence, rules, and scoring
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   ├── migrations/           SQL migrations 001–014; 013–014 live application unverified
│   ├── scripts/              Offline seed, training, and backfill tools
│   ├── models/               Versioned Isolation Forest artifact and metrics
│   ├── .env.example
│   └── requirements.txt
├── docs/
│   ├── API_CONTRACT.md       Implemented and planned REST/WebSocket contracts
│   ├── BACKEND_IMPLEMENTATION_PLAN.md
│   └── FRONTEND_IMPLEMENTATION_PLAN.md
├── .gitignore
└── README.md
```

## Frontend setup

Requirements: Node.js and npm.

```powershell
cd frontend
npm install
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
npm run dev
```

Create a production build with:

```bash
npm run build
```

Connected domains display backend results. Other domain services retain unavailable/preview states until deliberately activated; development role preview is not authentication or backend authorization.

## Backend setup

Tested Python version: 3.12.10. Compatibility with other Python versions has not been verified against the pinned dependencies. Install development dependencies to run tests/offline workbook tooling.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Verify service health at:

```text
GET http://localhost:8000/api/v1/health
```

Implemented routes include health; authenticated transaction, alert, report, identity, review, team, notification, case, vendor, analytics, and settings APIs; Admin-only report schedule status; and `/ws/alerts`. Routes enforce backend Auth/RBAC according to role and object scope. Only Admins can update the persisted organization name; other settings are read-only. The scheduled report worker is opt-in through `DAILY_REPORT_SCHEDULER_ENABLED` and deployment activation remains in Phase 24. See [API_CONTRACT.md](docs/API_CONTRACT.md) for endpoint details and remaining boundaries.

## Verification baseline

Local inspection on 2026-10-03 at `f9c7dd5`: backend `129 passed` with the known Starlette TestClient warning; frontend `204 passed`; frontend lint and `git diff --check` passed. Tests use mocked external services and do not prove live database state or deployed role workflows. Production build was not run in that inspection; previous build successes in the frontend plan are historical results, not a fresh build verification.

Historical documentation-commit checks on 2026-10-03 at `f9c7dd5`: backend `129 passed`, frontend `204 passed`, lint passed, and an actual production build passed (138 modules). After PR #26 merged to `main`, the verified baseline was backend `179 passed` (one known Starlette/httpx deprecation warning), frontend `212 passed`, 16 isolated migration/recovery tests, lint and production build passed. Later phase checks are recorded against their merged main commits in the backend plan. The local `requirements.txt` edit remains outside the documentation and unrelated phase commits.

Main verification after PR #33 on 2026-10-04: backend `213 passed` with one known Starlette TestClient deprecation warning, 28 isolated PGlite tests passed, frontend `227 passed`, lint and production build passed. `git diff --check` passed; migration 019 application is owner-reported and was not independently queried. These results do not prove deployed end-to-end behavior.

Main verification after PR #34 on 2026-10-04: backend `214 passed` with one known Starlette TestClient deprecation warning, 29 isolated PGlite tests passed, frontend `227 passed`, lint and production build passed. The owner reported Migration 020 applied; this was not independently queried. These results do not prove deployed end-to-end behavior.

Migration files 001–021 are present. The project owner reported migrations 012–020 applied successfully; this was not independently queried. Migration 021 is the Phase 22 report scheduler schema and remains pending owner application before merge. Stored model metrics report held-out detection 87.04% and false positives 3.45%; training was not rerun. Historical coverage/latency measurements are retained in the backend plan. A 10,000-row dataset does not prove throughput.

## Technology stack

- Frontend: React, Vite, React Router
- Backend: Python, FastAPI, Uvicorn
- Database: PostgreSQL through Supabase
- Anomaly detection: Isolation Forest with scikit-learn
- Real-time delivery: FastAPI WebSocket; current connection manager is process-local
- Risk explanations: Gemini API, advisory and optional after scoring
- Tests: Node test runner and pytest; performance/load testing remains pending
- Selected hosting, not deployed in this verification: Vercel frontend and Render backend

## Responsibility boundary

### Frontend responsibilities

- React UI and navigation
- Dashboard, transaction, alert, and report views
- Search, filter, and sort controls
- Loading, error, and empty states
- REST API client and WebSocket client
- Displaying results supplied by the backend

### Backend responsibilities

- Transaction ingestion and validation
- Missing-field handling
- PostgreSQL persistence
- The five audit rules and rule score
- Isolation Forest and AI anomaly score
- The 60/40 risk calculation and risk classification
- Alert creation and WebSocket publication
- Gemini explanation calls
- Report generation
- Authentication and authorization enforcement

The React frontend must never become the authoritative source for audit decisions.
