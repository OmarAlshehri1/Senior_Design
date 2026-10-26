# Payments code-only Production release

The owner approved Production release preparation with Experimental Review disabled. This supersedes provisioning separate Staging services for the initial release. No Production code, environment or database was changed during preparation.

## Verified baseline — 25 October 2026

- Existing backend: `https://senior-design-1ypl.onrender.com`; health 200, anonymous reports/alerts 401. Both new capability endpoints return 404 in the currently deployed version.
- Existing frontend: `https://senior-design-gold.vercel.app`.
- Production Supabase: `senior-design-m004`, project `sqiqspqfpbotmwrerbsi`. Its host matches the local Production configuration. Identity/session/team tables exist; all inspected Feed ingestion/review and model-review tables are absent. No business rows or credentials were retrieved during preflight.
- Public GitHub `main` still has the earlier backend entry point without Feed/model-review imports. The exact commit currently deployed on Render/Vercel is unverified until hosting access is available.
- Render and Vercel are not connected to this session. Supabase access alone cannot configure their environment variables, inspect auto-deploy settings or publish code. No push to `main` was performed.

## Initial release scope

Deploy a reviewed code candidate with `FEED_REVIEW_ENABLED=false` and `PAYMENTS_MODEL_REVIEW_ENABLED=false`. Feed RPC calls are rejected before database access when disabled. Sidebar navigation follows the authenticated capability endpoint, and a direct Feed page visit shows the disabled state. Production defaults to Feed disabled when no flag exists; the known separate Staging host retains its existing behavior. Experimental model storage remains restricted to the known Staging host, so this release does not authorize Production model activation.

Set `INGESTION_ENABLED=false`, `INGESTION_VALIDATION_ENABLED=false`, `INGESTION_AUDIT_ENABLED=false` and `INGESTION_FEED_ANOMALY_ENABLED=false` before deploying the new backend. Preserve existing Production Supabase credentials, frontend origins, auth redirects and all pre-existing recovery/report/SLA worker settings. Do not use the Staging-only launcher on Production. Retain the existing start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT` after verifying it in Render.

No new Production tables are required for this disabled code release. Do not execute the Staging schema installer, private import/enable SQL, test-user provisioning or automated fixture SQL on Production. Later Feed/model activation requires its own exact source, organization, user/team grant and dataset setup and validation.

## Candidate and publishing sequence

The private candidate is built by `python -m scripts.build_payments_hosted_candidate --target production`. Its manifest hashes each file and identifies the base commit. It is a source snapshot, not a pushed release commit. The builder restores unrelated modified tracked frontend files from the base commit within the candidate only, leaving the user's working files unchanged. It retains only the reviewed tracked Payments changes plus new runtime dependencies. Credentials, private data, reviews, imports and experimental model artifacts are excluded.

1. Connect Render and Vercel and inspect the existing Production projects, owners, deployment commits and auto-deploy behavior. Do not create replacements for these existing services.
2. Validate the extracted candidate in isolation, prepare a scoped branch/PR and record its exact commit. Do not stage the entire mixed workspace or publish private source data.
3. Configure the disabled feature/intake flags on the existing backend. Preserve all other existing settings. Verify frontend API/WS variables still point to the Production backend. A repository file is not proof of the deployed provider configuration.
4. Publish the compatible disabled backend before publishing the frontend that requests its capability endpoints. Record prior deployment IDs for rollback.
5. Verify health, CORS for the real frontend, existing authenticated role workflows, anonymous denials and unavailable Feed/model features through a clean browser. Do not invent live transactions or alter business records merely to obtain a passing check.

Local verification: 33 targeted backend tests and the workspace frontend build passed. The extracted candidate differs intentionally from the mixed workspace and must receive its own validation before publication. Hosting, deployed-commit and Production authenticated browser checks remain outstanding.

Rollback uses the recorded prior application deployments and preserved Production settings. This initial code-only release does not import or move Staging reviews, change Combined Risk or approve the experimental model. Keep the Staging SQLite backup frozen.
