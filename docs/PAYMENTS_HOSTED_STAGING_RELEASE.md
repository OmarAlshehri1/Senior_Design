# Payments Hosted Staging release candidate

Prepared on 25 October 2026. The owner confirmed that only Production hosting services exist. No new Render/Vercel service or deployment has been created. Database cutover is complete, and the local API remains backed by the enabled Supabase Staging dataset.

## Intended targets

Create separate services after confirming the connected hosting workspace: a Render Python backend and a Vercel Vite frontend. Names may be `payments-auditor-staging-api` and `payments-auditor-staging-ui` if available. Do not reuse `senior-design-1ypl.onrender.com` or `senior-design-gold.vercel.app`; these are the documented Production services. Do not push the mixed workspace to `main`: prior records describe Production auto-deployment from that branch.

The Render and Vercel connections were discovered but are not yet installed/connected to this session. Connect both before inspecting workspace ownership, plan availability, existing services, repository access and auto-deploy settings. No paid plan, extra service or deployment is claimed by this document.

## Backend configuration

Use a scoped reviewed release branch containing the source candidate and all required runtime files. Pin its actual commit before deployment; the manifest's `workspace_base_commit` identifies the starting point, not a release commit. The source candidate includes uncommitted source files and is not itself a pushed branch. Never add ignored `.feed-simulator` content or environment files to Git.

Render settings:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Runtime | Python, compatible with the verified local Python 3.12 environment |
| Build command | `pip install -r requirements.txt` |
| Start command | `python -m scripts.run_payments_hosted_staging` |
| Health check | `/api/v1/health` |
| Auto-deploy | Off for the initial pinned Staging acceptance |

Set these variables on the **new Staging backend only**:

| Variable | Value |
| --- | --- |
| `PAYMENTS_DEPLOYMENT_ENV` | `staging` |
| `SUPABASE_URL` | `https://gunvsnvxipetxavpajjv.supabase.co` |
| `SUPABASE_SECRET_KEY` | Existing Staging backend secret, supplied privately; never a browser variable |
| `PAYMENTS_MODEL_REVIEW_STORAGE` | `supabase` |
| `PAYMENTS_MODEL_REVIEW_DATASET` | `f64553fac65cc640dbdb7eb043f15f56893e0e159e47da15e67e9df8a2a1f324` |
| `PAYMENTS_MODEL_REVIEW_ENABLED` | Start with `false`; enable only on the intended Staging service during acceptance |
| `FRONTEND_ORIGINS` | Exact HTTPS origin of the new Staging frontend, without a trailing slash |
| `SUPABASE_AUTH_REDIRECT_URL` | The same frontend origin followed by `/auth/callback` |
| `PORT` | Use the port assigned by Render |

The entry point rejects the wrong database, dataset, missing feature flag, localhost/wildcard/known Production origins, invalid redirect and invalid provider port. It disables intake, audit/validation workers, anomaly inference, transaction recovery, report scheduling, case escalation and Gemini narratives. It prevents dotenv fallback and local package loading. It does not install schema, import data or enable the dataset.

## Frontend configuration

On the **new Vercel project**, use root `frontend`, build `npm run build`, output `dist` and the existing SPA rewrite in `frontend/vercel.json`. Scope variables to the environment used by this separate Staging project:

- `VITE_PAYMENTS_DEPLOYMENT_ENV=staging`
- `VITE_API_BASE_URL=https://<new-staging-backend>/api/v1`
- `VITE_WS_URL=wss://<new-staging-backend>/ws/alerts`

The Staging build rejects local defaults, known Production targets, mismatched API/WS hosts and incorrect endpoint paths. No backend secret or private dataset file belongs in a `VITE_` variable. Build checks used non-live example URLs; generated local `dist` is not a deployment artifact for the eventual real service.

The backend capability endpoint requires a real session and current source access. Experimental review navigation is shown only for its enabled, authorized source. Direct review endpoints remain protected independently. Inline Feed diagnostics are deliberately unavailable in this candidate: the earlier component fetched the entire sample and matched record aliases without a general source-bound endpoint. The separate 60-case review page still displays its saved, precomputed scores. This limitation avoids claiming the general diagnostic integration is complete.

## Source candidate and acceptance

`scripts/build_payments_hosted_candidate.py` copies allowlisted backend/frontend runtime source into a private candidate archive, recording every file hash. It excludes credentials, SQLite, review notes, workbook data, private manifests and the experimental Payments executable artifact. The existing tracked retail artifact is copied unchanged for compatibility, not replaced by the Payments candidate. No live services are changed by packaging.

Verified locally: 24 targeted backend tests, six frontend tests, and a Staging frontend build. The build still reports its existing bundle-size warning. Provider provisioning, clean dependency installation on Render, deployed commit identity, hosted CORS/Auth routing, browser login, WebSocket behavior and hosted restart/redeploy persistence remain unverified.

Before enabling the hosted feature, verify exact Staging URLs and commit, anonymous denial, actual source-assigned account access, paginated summaries, private actor notes and stale-write conflicts. Use a separate explicitly automated fixture for write tests; do not edit the six imported assessments merely to demonstrate persistence. Preserve the frozen SQLite backup. On failure, disable the hosted feature and retain authoritative Supabase events; do not fall back to stale SQLite or change Production.

References: [Render FastAPI deployment](https://render.com/docs/deploy-fastapi), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [integration plan](PAYMENTS_INTEGRATION_RELEASE_PLAN.md), [completed local cutover](PAYMENTS_MODEL_REVIEW_STORAGE.md).
