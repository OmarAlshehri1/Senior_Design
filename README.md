# Continuous Auditing System for SMEs in the Retail Sector Using Real-Time Transaction Monitoring

Senior Design project for team **M004**.

This repository is a monorepo containing the React frontend, the FastAPI backend foundation, and the shared API contract. The system is intended to monitor retail transactions, evaluate audit rules and anomalous behavior, produce a unified risk assessment, and notify auditors of high-risk activity.

The current repository is only the shared development foundation. The existing frontend uses simulated/mock data until backend integration is completed. The audit rules, Isolation Forest model, unified risk calculation, database integration, WebSocket alerts, Gemini explanations, authentication, and report generation are not implemented yet.

## Architecture

The planned data flow is:

```text
ERP/POS
  -> FastAPI
  -> PostgreSQL/Supabase
  -> Audit Rule Engine + Isolation Forest
  -> Backend-owned unified risk score
  -> WebSocket alerts and REST API
  -> React dashboard
```

The frontend displays backend results but is never the authoritative source for audit decisions. The backend will own validation, rule evaluation, anomaly scoring, risk classification, alert creation, and persistence.

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
├── backend/                  FastAPI foundation
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   ├── .env.example
│   └── requirements.txt
├── docs/
│   └── API_CONTRACT.md       Planned shared REST/WebSocket contract
├── .gitignore
└── README.md
```

## Frontend setup

Requirements: Node.js and npm.

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Create a production build with:

```bash
npm run build
```

The current frontend behavior and data are simulated. Its risk values and audit outcomes must not be treated as authoritative.

## Backend setup

Requirements: Python 3.11 or later.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Verify the initial service at:

```text
GET http://localhost:8000/api/v1/health
```

Only the health endpoint is currently implemented. See `docs/API_CONTRACT.md` for the planned shared contract.

## Technology stack

- Frontend: React, Vite, React Router
- Backend: Python, FastAPI, Uvicorn
- Planned database: PostgreSQL through Supabase
- Planned anomaly detection: Isolation Forest with scikit-learn
- Planned real-time delivery: FastAPI WebSocket
- Planned risk explanations: Gemini API
- Planned testing: frontend tests, pytest, and Locust
- Planned hosting: Vercel for the frontend and Render for the backend

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
