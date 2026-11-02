# Frontend production handoff

The production backend is live on merged PR #40, commit
`39011d838e8f009d61ffd2ec1e462ee54f9b0562`. Database migrations are complete.
The Vercel owner has now clarified `d81279c` is live (an empty deployment-trigger
commit with identical source to `39011d8`), and public-asset plus Admin
browser checks passed. See [the completed verification](PRODUCTION_FRONTEND_VERIFICATION_2026-11-02.md).
The handoff below is retained as history; no redeployment is needed.

Message to the frontend teammate:

> PR #40 is merged. Please deploy main commit `39011d8` to the existing
> `senior-design` Vercel project in `omar22222`, using the existing production
> settings and the `frontend` root directory. The backend is already live.
> Send back the deployment URL and deployed commit when finished. No database
> migrations or dataset reimport are needed.

Deployment details:

- Repository: `OmarAlshehri1/Senior_Design`; branch: `main`.
- Target URL: https://senior-design-gold.vercel.app
- Project root: `frontend`; build: `npm run build`; output: `dist`.
- Keep `VITE_API_BASE_URL=https://senior-design-1ypl.onrender.com/api/v1` and the
  existing production `VITE_WS_URL`. Do not copy staging environment settings.
- Use the existing owner account and project. The connected account does not
  have access to this Vercel scope (403), and the Git integration reports that
  the commit author is not a member of the private Hobby team.
- New imports/feed AI must remain disabled during this code rollout. Source
  registration, policy/reference context and compatible model approval are a
  later activation step. S4 remains partial.

After publication, verify the new frontend references the production backend,
the dashboard still reconciles to the active dataset, report previews/downloads
work, and the Admin import page reports that imports are disabled. Record the
actual deployment URL/commit before considering the frontend step complete.

Before owner publication, the public site still served
`/assets/index-CyHVaEqz.js` without the new company-import module. Its existing
dashboard, filters, vendor search and saved-report downloads passed against the
new backend. Those checks do not establish that the new frontend is published.

See [the application rollout record](PRODUCTION_APPLICATION_ROLLOUT_2026-11-02.md).
