# Frontend Implementation Plan — Team M004

Last updated: 2026-10-03  
Owner scope: ICS — SWE

## How to use this file

- `[x]` completed and verified.
- `[ ]` not completed or dependent on backend implementation/integration.
- This document tracks the SWE/frontend implementation, validation evidence, and backend integration boundaries.
- Dates and commit identifiers below come from repository Git history, including the verified Phase 8.12B implementation commit.
- Frontend permission checks are presentation and UX controls. Authoritative authentication, authorization, and data access must be enforced by the backend.

## Frontend Phase Index

| Phase | Date | Main Scope | Commit(s) | Status |
| --- | --- | --- | --- | --- |
| Phase 1 | 2026-09-20 | Shared React/Vite foundation | `94867ee` | [x] Completed |
| Phase 2 | 2026-09-21 | Risk and data correctness | `9eb8b02` | [x] Completed |
| Phase 3 | 2026-09-21 | Dashboard | `cb649a8` | [x] Completed |
| Phase 4 | 2026-09-21 | Transactions and Transaction Detail | `2a28078` | [x] Completed |
| Phase 5 | 2026-09-21 | Alerts monitoring | `7e62cb3` | [x] Completed |
| Phase 6 | 2026-09-28 | Audit Rules frontend | `65ad852` | [x] Completed |
| Phase 7 | 2026-09-28 | Reports frontend | `14b528a` | [x] Completed |
| Phase 8 | 2026-09-28 | Settings, integration readiness, production routing | `b1d0663`, `fbfea89`, `485a914` | [x] Completed |
| Phase 8.1 | — | No standalone frontend phase established by Git | — | Explained gap |
| Phase 8.2 | — | No standalone frontend phase established by Git | — | Explained gap |
| Phase 8.3 | — | No standalone frontend phase established by Git | — | Explained gap |
| Phase 8.4 | — | No standalone frontend phase established by Git | — | Explained gap |
| Phase 8.5 | 2026-09-30 | Enterprise visual-system refresh | `a0b6d55` | [x] Completed |
| Phase 8.5B | 2026-09-30 | Width and surface refinements | `a0b6d55` | [x] Completed in shared milestone |
| Phase 8.6A | 2026-09-30 | Authentication UX foundation | `18c25e0` | [x] Frontend completed |
| Phase 8.6B | 2026-09-30 | Authorization and role navigation | `18c25e0` | [x] Frontend completed |
| Phase 8.6C | 2026-09-30 | Role workspaces and Profile | `18c25e0` | [x] Frontend completed |
| Phase 8.7 | 2026-09-30 | Accountability and audit trail | `b12f336` | [x] Frontend completed |
| Phase 8.8 | 2026-09-30 | Management, team, and assignment | `e15f862` | [x] Frontend completed |
| Phase 8.9 | 2026-09-30 | Notifications, security UX, request states | `496c45a` | [x] Frontend completed |
| Phase 8.9A | 2026-09-30 | Overlay keyboard accessibility | `7ce6fdd` | [x] Completed |
| Phase 8.10 | 2026-09-30 | Advanced Audit Workflow | `1bc6a50` | [x] Frontend completed |
| Integration milestone | 2026-10-02 | Live transaction-list integration | `108f7aa` | [x] Connected |
| Phase 8.11 | 2026-09-30–2026-10-03 | Final responsive/UI quality work | `1bc6a50`, `4dc7b5a` | [x] Completed |
| Phase 8.12 | 2026-10-03 | Final functional QA | No distinct commit | [x] Inspection completed |
| Phase 8.12B | 2026-10-03 | Final frontend freeze fixes | `dc368a4` | [x] Completed and verified |
| Integration milestone | 2026-10-03 | Live alerts, authoritative risk/explanations, and persisted reports | `a8e1b8a`, `eb38337` (PR #22) | [x] Connected |

### Numbering provenance and explained gaps

The first eight phase numbers are a chronological reconstruction from distinct frontend commits because those early commits did not embed phase labels. Repository history and changed files support each mapping shown above without reusing a commit across Phases 1–8.

No commit message, source comment, test, or historical documentation establishes a standalone frontend Phase 8.1, 8.2, 8.3, or 8.4. Those numbers belong to the broader project workflow rather than evidenced frontend implementation milestones. They are therefore listed as explained gaps, not assigned invented scope. Phase 8.5 onward is supported by source comments, commit content, later documentation, or the final QA record. Phase 8.6A/B/C were implemented together in `18c25e0`; the content clearly separates authentication UX, authorization/navigation, and role workspace/Profile work, while the stylesheet explicitly identifies the 8.6C surface.

## Frontend architecture

```text
React / Vite
    -> application shell and route composition
    -> role-aware presentation and responsive pages
    -> domain models, service boundaries, and adapters
    -> FastAPI contracts
    -> backend-authoritative transaction data
    -> responsive enterprise UI states
```

The application separates the following concerns:

- **UI presentation:** pages and reusable components render tables, cards, forms, dialogs, empty states, and responsive layouts.
- **Domain models/contracts:** modules under `auth/`, `audit/`, `management/`, `team/`, `assignments/`, `notifications/`, `cases/`, `vendors/`, and `analytics/` define frontend vocabulary and safe state shapes.
- **Service boundaries:** modules under `services/` isolate HTTP access and intentionally reject unsupported operations rather than fabricating success.
- **Adapters:** modules under `adapters/` translate backend `snake_case` payloads into React-facing models.
- **Backend-authoritative data:** connected transaction records, pagination totals, rule results, scores, risk levels, explanations, and missing-field findings remain authoritative when supplied by FastAPI.

Frontend permissions improve navigation and presentation, but they are not a security boundary. Backend RBAC remains required for authoritative enforcement.

## Project structure

| Area | Responsibility |
| --- | --- |
| `src/pages/` | Route-level experiences, including monitoring, audit, management, authentication, cases, and vendors. |
| `src/components/` | Shared shell, tables, cards, dialogs, status presentation, workflow panels, and visualizations. |
| `src/auth/` | Role vocabulary, permission checks, protected routes, auth-state contracts, validation, profile, and development Role Preview. |
| `src/audit/` | Audit-event, review-history, login-history, and Audit Log frontend contracts. |
| `src/management/` | User and access-request administrative models and unavailable service boundaries. |
| `src/team/` | Team activity and workload presentation contracts. |
| `src/assignments/` | Alert-assignment state, history, and service boundary. |
| `src/notifications/` | Notification types, read-state helpers, and unavailable service boundary. |
| `src/cases/` | Case lifecycle, evidence, discussion, closure, priority, status, and SLA presentation models. |
| `src/vendors/` | Vendor monitoring vocabulary and safe vendor-profile models. |
| `src/analytics/` | Audit coverage and risk-trend presentation models. |
| `src/services/` | API client, active transaction service, real-time client contract, and prepared domain service boundaries. |
| `src/adapters/` | Backend-to-frontend transaction and alert payload translation. |
| `src/accessibility/` | Reusable overlay focus trapping, restoration, and keyboard behavior. |
| `src/utils/` | Pure filtering, sorting, risk, report, settings, request-state, and dashboard derivations. |
| `test/` | Node test suite for contracts, adapters, access rules, helpers, accessibility, and integration boundaries. |

## Phase 1 — Shared frontend foundation

Date: 2026-09-20  
Commit(s): `94867ee`

Status:  
[x] Completed

Purpose: Establish the React/Vite application, application shell, initial monitoring routes, shared components, frontend environment example, and API contract baseline.

Implemented:

- Dashboard, Transactions, Transaction Detail, Alerts, Audit Rules, Reports, and Settings route foundations.
- Shared Sidebar, Topbar, status components, transaction table, notification, and risk visualization.
- Initial AppContext and preview-data structure.

Validation:

- Later phases added formal automated tests; this commit itself does not establish a historical test total.

Evidence:

- Commit `94867ee`; `frontend/src/App.jsx`, `frontend/src/components/`, and `frontend/src/pages/`.

Backend dependency: Initial data was frontend preview data; operational data required API integration.

## Phase 2 — Risk and data correctness

Date: 2026-09-21
Commit(s): `9eb8b02`

Status:
[x] Completed

Purpose: Establish consistent frontend risk classification, safe derived metrics, and internally coherent preview data before completing individual monitoring pages.

Implemented:

- Centralized frontend preview risk thresholds and risk-distribution derivation.
- Separated audit review status from risk classification.
- Corrected transaction, alert, rule-result, score, timestamp, and linked-record consistency in preview fixtures.
- Introduced pure dashboard/risk utilities and the first formal frontend test file.

Validation:

- Risk boundaries, derived summaries, and fixture consistency in `frontend/test/risk.test.js`.

Evidence:

- `frontend/src/utils/risk.js`, `frontend/src/utils/dashboard.js`, and safer context/hooks.
- Commit `9eb8b02` also added the Not Found page.

Backend dependency: Risk thresholds and fixtures were frontend preview behavior. Authoritative scores, risk levels, and rule findings remained backend responsibilities.

## Phase 3 — Dashboard completion

Date: 2026-09-21
Commit(s): `cb649a8`

Status:
[x] Completed

Purpose: Complete the primary monitoring overview and ensure every displayed metric is derived consistently from the current frontend dataset.

Implemented:

- Dashboard summary cards and risk distribution.
- Recent Transactions table and recent alert presentation.
- Risk-filter navigation from Dashboard into Transactions.
- Responsive Dashboard layout and empty-safe derived metrics.

Validation:

- Dashboard summary and distribution assertions in `frontend/test/risk.test.js`.

Evidence:

- `frontend/src/utils/dashboard.js`, Dashboard-specific components, and routes `/` and `/dashboard`.

Backend dependency: Dashboard values used frontend preview data at this stage; authoritative operational summaries required backend integration.

## Phase 4 — Transactions and Transaction Detail

Date: 2026-09-21
Commit(s): `2a28078`

Status:
[x] Completed

Purpose: Complete transaction exploration and detailed audit-result presentation with deterministic frontend behavior.

Implemented:

- Transaction search, risk/rule filters, deterministic sorting, and query-filter initialization.
- Transaction table and responsive transaction presentation.
- Transaction Detail fields, scores, five-rule results, risk explanations, and data-quality fallback behavior.
- Null-safe helpers and consistent status formatting.

Validation:

- Search, filter, sort, missing-value, and detail-contract tests in `frontend/test/transactions.test.js`.

Evidence:

- `frontend/src/utils/transactions.js` and routes `/transactions` and `/transactions/:id`.

Backend dependency: This phase completed preview-data UX. Live collection and direct-detail integration were activated in later milestones.

## Phase 5 — Alerts monitoring

Date: 2026-09-21  
Commit(s): `7e62cb3`

Status:  
[x] Completed

Purpose: Complete the Alerts monitoring experience and make filtering, sorting, linked transaction context, and review-state behavior deterministic.

Implemented:

- Alerts table and responsive alert presentation.
- Search across alert ID, transaction ID, vendor, and alert type.
- Active/Reviewed, risk, and five-rule alert-type filters.
- Deterministic time/risk sorting, summary derivation, professional fallback reasons, and in-memory review updates.

Validation:

- `frontend/test/alerts.test.js` covers search, filters, sorting, linked transactions, optional values, and review-state safety.

Evidence:

- `frontend/src/utils/alerts.js`, `frontend/src/components/AlertsTable.jsx`, and `/alerts`.

Backend dependency: Alert data and review changes were frontend preview/session state. Durable alerts and accountable review persistence required backend integration.

## Phase 6 — Audit Rules frontend

Date: 2026-09-28
Commit(s): `65ad852`

Status:
[x] Completed

Purpose: Provide a stable, accessible frontend reference for the project audit-rule identities and their transaction-detail presentation.

Implemented:

- Centralized metadata for the five named project audit rules.
- Expandable Audit Rules page with definitions, required fields, evaluation description, and configuration presentation.
- Shared rule identities between Audit Rules and Transaction Detail.
- SPA fallback adjustments present in the same commit.

Validation:

- `frontend/test/auditRules.test.js` verifies rule identity, metadata completeness, safe status semantics, and independent disclosure state.

Evidence:

- `frontend/src/data/auditRules.js`, `frontend/src/utils/auditRules.js`, and `/audit-rules`.

Backend dependency: This phase presents rule definitions and recorded results. Rule execution, configuration authority, and findings remain backend-owned.

## Phase 7 — Reports frontend

Date: 2026-09-28  
Commit(s): `14b528a`

Status:  
[x] Completed

Purpose: Complete a coherent frontend report preview derived from currently available transaction and alert records.

Implemented:

- Daily summary, risk distribution, alert summary, rule summary, and high-risk transaction sections.
- Pure, non-mutating report derivation with safe handling of empty and optional values.
- Responsive report layout and high-risk transaction presentation.

Validation:

- `frontend/test/reports.test.js` covers totals, distribution consistency, rule identities, high-risk rows, immutability, and empty datasets.

Evidence:

- `frontend/src/utils/reports.js`, `frontend/src/pages/Reports.jsx`, and `/reports`.

Backend dependency: This phase was a frontend-derived preview. Report generation, persistence, and downloads remained backend-dependent and were not activated.

## Phase 8 — Settings, integration readiness, and production routing

Date: 2026-09-28  
Commit(s): `b1d0663`, `fbfea89`, `485a914`

Status:  
[x] Completed

Purpose: Finish the read-only Settings experience, establish testable backend integration boundaries, and prepare production SPA routing before the Phase 8.5 redesign.

Implemented:

- Settings risk ranges, audit-rule reference, reporting configuration, real-time alert reference, and truthful availability states.
- Environment normalization, API client, integration errors, adapters, and transaction/alert/report/settings service boundaries.
- Request-state helpers and real-time client lifecycle/reconnect contract.
- Vercel/Vite production entry-point and SPA routing corrections.

Validation:

- `frontend/test/settings.test.js`, `frontend/test/apiClient.test.js`, `frontend/test/adapters.test.js`, `frontend/test/env.test.js`, `frontend/test/integrationFoundation.test.js`, and `frontend/test/realtime.test.js`.

Evidence:

- `frontend/src/pages/Settings.jsx`, `frontend/src/services/`, `frontend/src/adapters/`, `frontend/vercel.json`, and `frontend/vite.config.js`.

Backend dependency: Settings remained read-only and unsupported services remained unavailable. These service contracts did not activate endpoints; only explicitly documented later integrations are operational.

## Phase 8.5 — Enterprise visual-system refresh

Date: 2026-09-30
Commit(s): `a0b6d55`
Status: [x] Completed

Purpose:

Introduce the enterprise application shell and a consistent visual hierarchy across the main operational pages.

Implemented:

- Dark navy Sidebar and light application surfaces.
- Revised Dashboard, Transactions, Reports, Settings, summary cards, and Topbar.
- Shared typography, spacing, status, control, and page-surface conventions in `refresh.css`.

Validation:

- Commit diff confirms presentation-focused changes across the shell and primary pages.
- No historical build or test total is attributed to this individual commit.

Evidence:

- `frontend/src/refresh.css` explicitly begins with “Phase 8.5 visual system refresh.”
- `Sidebar.jsx`, `Topbar.jsx`, `SummaryCards.jsx`, and the Dashboard, Transactions, Reports, and Settings pages.

Backend dependency: None for visual structure.

## Phase 8.5B — Width and surface refinement

Date: 2026-09-30
Commit(s): `a0b6d55` — implemented together and committed as one frontend milestone with Phase 8.5
Status: [x] Completed

Purpose:

Refine balanced content widths and complete visual boundaries after the main enterprise redesign.

Implemented:

- Balanced application and page-width behavior.
- Completed surface, card, and content-boundary treatment.
- Responsive refinements within the same stylesheet milestone.

Validation:

- Verified against the `a0b6d55` stylesheet diff and affected page layouts.
- No separate historical test total is claimed for the subphase.

Evidence:

- `frontend/src/refresh.css` contains the explicit “Phase 8.5B refinement” source comment in commit `a0b6d55`.
- Shared commit evidence is intentional; Git contains no separate 8.5B commit.

Backend dependency: None.

## Phase 8.6A — Authentication UX foundation

Date: 2026-09-30
Commit(s): `18c25e0` — implemented together and committed as one frontend milestone with Phases 8.6B and 8.6C
Status: [x] Frontend UX and contracts completed

Purpose:

Build the standalone authentication and account-state UX without claiming real backend authentication.

Implemented:

- Login form, validation, password visibility, and safe unavailable-service feedback.
- Request Access and Forgot Password validation flows.
- Access Pending, Account Locked, Account Disabled, Support, and Privacy & Security routes.
- Auth-state, account-status, lifecycle, service-error, and support contracts.

Validation:

- Auth validation, lifecycle, account-state, and unavailable-service tests in `frontend/test/auth.test.js`.
- Route-contract checks confirm authentication pages remain outside the application shell.

Evidence:

- `/login`, `/request-access`, `/forgot-password`, `/access-pending`, `/account-locked`, `/account-disabled`, `/support`, and `/privacy-security`.
- `frontend/src/auth/`, authentication pages, and `frontend/src/pages/Login.css`.

Backend dependency: Real authentication, password reset, access-request persistence, account state, and sessions remain backend-dependent.

## Phase 8.6B — Authorization and role-aware navigation

Date: 2026-09-30
Commit(s): `18c25e0` — implemented together and committed as one frontend milestone with Phases 8.6A and 8.6C
Status: [x] Frontend UX enforcement completed

Purpose:

Centralize role permissions, route presentation, and navigation behavior for Auditor, Supervisor, and Administrator.

Implemented:

- Centralized roles, permissions, route-access map, and permission helpers.
- Protected-route presentation, role-aware Sidebar links, locked navigation, and distinct 403/404 behavior.
- Development-only in-memory Role Preview.
- Accessible locked-state context without treating the preview role as authenticated identity.

Validation:

- Permission matrices, route access, locked navigation, and Role Preview behavior in `frontend/test/authorization.test.js` and `frontend/test/auth.test.js`.

Evidence:

- `frontend/src/auth/roles.js`, `routeAccess.js`, `RequirePermission.jsx`, `navigationConfig.js`, and `RolePreviewControl.jsx`.
- `/403` and permission-protected application routes.

Backend dependency: Frontend checks are UX controls only; authoritative authentication and RBAC require backend enforcement.

## Phase 8.6C — Role workspaces and Profile

Date: 2026-09-30
Commit(s): `18c25e0` — implemented together and committed as one frontend milestone with Phases 8.6A and 8.6B
Status: [x] Frontend presentation completed

Purpose:

Keep the Dashboard shared while presenting truthful role-specific workspace and Profile states.

Implemented:

- Shared Dashboard with Auditor, Supervisor, and Administrator workspace sections.
- Auditor review metrics, Supervisor team placeholders, and Administrator security placeholders without fabricated records.
- Profile route and null-safe profile model separated from development Role Preview identity.

Validation:

- Workspace derivation, role labels, unavailable metrics, immutability, and Profile access tests in `frontend/test/workspace.test.js` and `frontend/test/authorization.test.js`.

Evidence:

- `frontend/src/auth/workspace.js`, `profileModel.js`, `frontend/src/components/RoleWorkspace.jsx`, `/profile`, and Dashboard.
- `frontend/src/refresh.css` explicitly identifies “Phase 8.6C role workspace and profile surfaces.”

Backend dependency: Identity-backed Profile data, personal work queues, team relationships, and security activity require backend services.

## Phase 8.7 — Accountability and audit trail frontend

Date: 2026-09-30  
Commit(s): `b12f336`

Status:  
[x] Frontend architecture completed  
[ ] Persistent accountability and audit events

Purpose: Establish immutable frontend contracts and truthful presentation for review and security accountability.

Implemented:

- Review accountability and Review History presentation.
- Login History presentation and profile security activity.
- Audit Log filters, sorting, detail presentation, route access, and empty states.

Validation:

- Accountability, Audit Log, history, and permission tests in `frontend/test/audit.test.js` and `frontend/test/authorization.test.js`.

Evidence:

- `/audit-log`, `/profile`, Transaction Detail, and `frontend/src/audit/`.

Backend dependency: Review records, login activity, and audit events require authoritative server persistence and identity.

## Phase 8.8 — User Management, Team Activity, and Alert Assignment

Date: 2026-09-30  
Commit(s): `e15f862`

Status:  
[x] Frontend architecture completed  
[ ] Persistent management and assignment operations

Purpose: Build permission-aware administrative and supervisory UX with safe unavailable states.

Implemented:

- User Management, user details, Access Requests, Locked/Disabled account views, and administrative confirmations.
- Team Activity, workload presentation, alert assignment dialog, and assignment history.
- Permission-derived action visibility and navigation.

Validation:

- Management models, unavailable services, and route permissions in `frontend/test/management.test.js` and `frontend/test/authorization.test.js`.

Evidence:

- `/users`, `/users/:userId`, `/team-activity`, and Alerts assignment components.

Backend dependency: Users, requests, team relationships, assignments, and administrative actions require backend services and persistence.

## Phase 8.9 — Notifications, security UX, and request states

Date: 2026-09-30  
Commit(s): `496c45a`

Status:  
[x] Frontend architecture completed  
[ ] Persistent notifications and authentication/session services

Purpose: Standardize pending, loading, error, empty, unavailable, session, notification, and sensitive-action experiences.

Implemented:

- Notification Center and future notification contracts.
- Reusable loading/error/empty/unavailable request states.
- Session Expired route and centralized sensitive-action confirmations.
- Security-oriented unavailable states that do not fabricate identity or activity.

Validation:

- Notification contracts, request states, session UX, and sensitive actions in `frontend/test/productPolish.test.js`, `frontend/test/auth.test.js`, and `frontend/test/settings.test.js`.

Evidence:

- `/session-expired`, `frontend/src/notifications/`, `frontend/src/security/`, and `RequestStateView.jsx`.

Backend dependency: Notification delivery/read state, sessions, and security activity remain backend-dependent.

## Phase 8.9A — Overlay keyboard accessibility

Date: 2026-09-30  
Commit(s): `7ce6fdd`

Status:  
[x] Completed

Purpose: Centralize accessible modal and drawer behavior.

Implemented:

- Reusable overlay focus-management hook and pure focus-wrap helper.
- Forward/reverse focus trapping, Escape handling, focus restoration, and inert application background.
- Applied behavior to navigation drawer, assignment and confirmation dialogs, and profile/notification overlays where applicable.

Validation:

- Focus wrapping and empty/single-target behavior in `frontend/test/focusManagement.test.js`.

Evidence:

- `frontend/src/accessibility/focusManagement.js` and `frontend/src/accessibility/useOverlayFocus.js`.

Backend dependency: None.

## Phase 8.10 — Advanced Audit Workflow

Date: 2026-09-30  
Commit(s): `1bc6a50`

Status:  
[x] Frontend architecture completed  
[ ] Workflow persistence and operational backend services

Purpose: Define the advanced audit workflow and present unavailable or empty states until authoritative services exist.

Implemented:

- Cases, escalation vocabulary, evidence attachments, discussion, activity, closure requests/approval, priorities, statuses, and SLA presentation.
- Vendor Monitoring, watchlist/block request permissions, Vendor Profile, and vendor monitoring indicators.
- Audit Coverage and Risk Trend presentation models.
- Permission-aware workflow actions and explicit disabled/unavailable controls.

Validation:

- `frontend/test/advancedAuditWorkflow.test.js` plus related audit, auth, management, and product-polish tests.

Evidence:

- `/cases`, `/cases/:caseId`, `/vendors`, `/vendors/:vendorId`, `frontend/src/cases/`, `frontend/src/vendors/`, and `frontend/src/analytics/`.

Backend dependency: Case records, evidence storage/scanning, discussion, assignment, closure, SLA events, vendor state, watchlists, blocks, coverage, and trend data are not persisted by the frontend.

## Live transaction-list integration

Date: 2026-10-02  
Commit(s): `108f7aa`

Status:  
[x] Completed and connected

Purpose: Activate the already-defined transaction service against the implemented FastAPI transaction-list contract.

Implemented:

- `DATA_SOURCE_KIND.API` with no initial preview transactions.
- `transactionsService.list` loading through AppContext.
- Server pagination, search, and sorting parameters.
- Loading/error/empty states and adapted backend transaction payloads.

Validation:

- Collection adaptation and service-boundary tests in `frontend/test/adapters.test.js` and `frontend/test/integrationFoundation.test.js`.

Evidence:

- `frontend/src/context/AppContext.jsx`, `frontend/src/pages/Transactions.jsx`, and `frontend/src/services/transactionsService.js`.

Backend dependency: Requires the configured FastAPI transaction endpoint and its Supabase-backed data. Risk/rule filters still apply to the current loaded server page because those backend filters are not implemented.

## Phase 8.11 — Final responsive, layout, and UI quality fixes

Date: 2026-09-30–2026-10-03
Commit(s): `1bc6a50`, `4dc7b5a` — the initial layout repair shared `1bc6a50` with Phase 8.10

Status:  
[x] Completed and verified

Purpose: Resolve final page-width, transaction-layout, navigation, and responsive defects.

Implemented:

- Initial application layout repair committed with the Phase 8.10 workflow milestone.
- Final shell/layout corrections, responsive transaction presentation, and page overflow controls.
- Transaction list and AppContext refinements without replacing server pagination.
- Audit-rule presentation cleanup.

Validation:

- Current suite and build validate the resulting implementation; no claim is made that every physical device was tested.

Evidence:

- `frontend/src/refresh.css` contains the explicit Phase 8.11 application-layout marker in `1bc6a50`.
- Commit `4dc7b5a`; `Layout.jsx`, `Transactions.jsx`, `AppContext.jsx`, `auditRules.js`, and final `refresh.css` changes.

Backend dependency: None beyond the existing transaction endpoint.

## Phase 8.12 — Final functional QA

Date: 2026-10-03  
Commit(s): No distinct implementation commit established by Git

Status:  
[x] Inspection completed  
[x] Findings resolved in the committed Phase 8.12B fixes below

Purpose: Inspect the complete frontend behavior and identify the remaining freeze-blocking functional issues without attributing an unsupported implementation commit.

Inspected:

- Full functional inspection of direct transaction detail, data quality, production-only controls, filter wording, and Vendor Profile controls.

Validation:

- Inspection findings were converted into focused Phase 8.12B regression tests.

Evidence:

- Phase 8.12B findings were resolved in the subsequent commit `dc368a4`.
- The resulting fixes and focused regression tests are recorded in the following phase.

Backend dependency: QA covered the existing transaction integration boundary; it did not activate other backend domains.

## Phase 8.12B — Final functional QA and frontend freeze fixes

Date: 2026-10-03  
Commit(s): `dc368a4`

Status:  
[x] Completed and verified

Purpose: Correct the final transaction-detail, data-quality, production-control, wording, and unavailable-control issues before frontend freeze.

Implemented:

- Direct Transaction Detail loading through the existing `transactionsService.getById` when a record is absent from the current page.
- Separate loading, success, not-found, and request-error states with route-change cancellation/stale-update protection.
- Authoritative mapping and display precedence for backend `missing_fields`, including an authoritative empty array.
- Development-only test-transaction control eliminated from production builds.
- Non-global high-risk filter wording and disabled Vendor Profile section controls.

Validation:

- Historical Phase 8.12B validation: 199 tests passed; build, lint, and `git diff --check` passed. This is the pre-PR #22 baseline.

Evidence:

- `frontend/test/transactionDetailLoader.test.js`, `frontend/test/freezeFixes.test.js`, `frontend/test/adapters.test.js`, and `frontend/test/transactions.test.js`.

Backend dependency: Direct detail requires the existing `GET /api/v1/transactions/{transaction_id}` endpoint. No new endpoint or domain integration was activated.

## Live alerts, authoritative risk, and reports integration

Date: 2026-10-03
Commit(s): `a8e1b8a` (PR #22)

Status:
[x] Implementation and local live verification completed
[x] Commit and merge completed (PR #22)

Purpose: Replace remaining automatic transaction-domain preview behavior with authoritative FastAPI alert, risk, explanation, and report data.

Implemented:

- Backend-authoritative transaction risk-level precedence with score-derived classification retained only as a safe preview fallback.
- Authoritative transaction data-quality, rule-score, AI-score, combined-risk, and persisted Gemini explanation presentation.
- Durable alert loading through `GET /api/v1/alerts`, review updates through `PATCH /api/v1/alerts/{alert_id}/review`, and live `alert.created` delivery through `/ws/alerts`.
- API mode starts without mock alerts; WebSocket events are adapted and deduplicated by persisted alert ID.
- Persisted daily report listing, generation, authoritative summary adaptation, report selection, and CSV download.
- Loading, error, empty, and unavailable states for alert and report integration.
- Desktop alert-table handling for long persisted alert and transaction identifiers.

Validation:

- Historical PR #22 validation: 204 frontend tests passed after adapter and service integration; lint and production build were reported passed in that milestone. The 2026-10-03 repository inspection independently reran tests/lint, not the production build.
- Live alert verification loaded two persisted alerts, reviewed the active alert through the UI, and confirmed the stored `REVIEWED` state through REST.
- Live WebSocket verification added `TX-LIVE-HIGH-*` without refreshing the page and updated the page to three alerts: one active and two reviewed.
- Live report verification generated `RPT-2026-10-03` with 9 evaluated transactions, average risk score 45.69, 6 LOW and 3 HIGH transactions, and 3 HIGH alerts split between 1 active and 2 reviewed.
- CSV download was exposed through the completed persisted report.

Evidence:

- `frontend/src/context/AppContext.jsx`
- `frontend/src/adapters/alertAdapter.js`
- `frontend/src/adapters/reportAdapter.js`
- `frontend/src/services/alertsService.js`
- `frontend/src/services/realtimeService.js`
- `frontend/src/services/reportsService.js`
- `frontend/src/pages/Alerts.jsx`
- `frontend/src/pages/Reports.jsx`
- `frontend/test/reportIntegration.test.js`

Backend dependency: Local integration is verified against the implemented FastAPI and Supabase services. Deployed host configuration, production secrets, approved Vercel CORS origin, and deployed end-to-end verification remain pending.
## Git Traceability

| Date | Phase / Change | Commit | Frontend Evidence | Status |
| --- | --- | --- | --- | --- |
| 2026-09-20 | Phase 1 — Shared frontend foundation | `94867ee` | App, shell, primary pages/components | [x] |
| 2026-09-21 | Phase 2 — Risk and data correctness | `9eb8b02` | Risk helpers, context, tests | [x] |
| 2026-09-21 | Phase 3 — Dashboard completion | `cb649a8` | Dashboard utilities/components | [x] |
| 2026-09-21 | Phase 4 — Transactions and Transaction Detail | `2a28078` | Transactions and detail, tests | [x] |
| 2026-09-21 | Phase 5 — Alerts monitoring | `7e62cb3` | Alerts page/table/helpers/tests | [x] |
| 2026-09-28 | Phase 6 — Audit Rules frontend | `65ad852` | Rule definitions, page, tests | [x] |
| 2026-09-28 | Phase 7 — Reports frontend | `14b528a` | Report derivation/page/tests | [x] |
| 2026-09-28 | Phase 8 — Settings completion | `b1d0663` | Settings derivation/page/tests | [x] |
| 2026-09-28 | Phase 8 — Backend-integration preparation | `fbfea89` | API client, adapters, services/tests | [x] |
| 2026-09-28 | Phase 8 — Vercel production routing | `485a914` | Vite/Vercel entry and SPA routing | [x] |
| — | Phases 8.1–8.4 | — | No standalone frontend milestone established by Git | Explained gap |
| 2026-09-30 | Phase 8.5 visual-system refresh | `a0b6d55` | Shell, primary pages, `refresh.css` | [x] |
| 2026-09-30 | Phase 8.5B width/surface refinement | `a0b6d55` | Shared visual milestone; explicit stylesheet marker | [x] shared commit |
| 2026-09-30 | Phase 8.6A authentication UX | `18c25e0` | Auth contracts, forms, account-state routes/tests | [x] shared commit |
| 2026-09-30 | Phase 8.6B authorization/navigation | `18c25e0` | Permissions, guards, Sidebar, 403, Role Preview | [x] shared commit |
| 2026-09-30 | Phase 8.6C workspaces/Profile | `18c25e0` | Role workspaces, Profile, explicit stylesheet marker | [x] shared commit |
| 2026-09-30 | Phase 8.7 accountability | `b12f336` | Audit models/pages/tests | [x] frontend |
| 2026-09-30 | Phase 8.8 management/team | `e15f862` | Management/team/assignment modules | [x] frontend |
| 2026-09-30 | Phase 8.9 notifications/security | `496c45a` | Notifications, security, request states | [x] frontend |
| 2026-09-30 | Phase 8.9A overlay accessibility | `7ce6fdd` | Focus architecture and tests | [x] |
| 2026-09-30 | Phase 8.10 advanced workflow | `1bc6a50` | Cases/vendors/analytics architecture | [x] frontend |
| 2026-10-02 | Live transaction-list integration | `108f7aa` | API data source, AppContext, adapter | [x] connected |
| 2026-09-30 | Phase 8.11 initial layout repair | `1bc6a50` | Shared milestone with Phase 8.10; explicit stylesheet marker | [x] shared commit |
| 2026-10-03 | Phase 8.11 final responsive fixes | `4dc7b5a` | Layout, transactions, CSS | [x] |
| 2026-10-03 | Phase 8.12 final functional QA | No distinct commit | Inspection resulting in Phase 8.12B fixes | [x] inspection |
| 2026-10-03 | Phase 8.12B freeze fixes | `dc368a4` | Final functional fixes and 199 tests | [x] verified |
| 2026-10-03 | Live alerts/risk/explanations/reports integration | `a8e1b8a`, `eb38337` (PR #22) | Services, adapters, AppContext, reports, 204 tests | [x] connected |

No frontend PR number is recorded here unless Git establishes it. The frontend milestone commits above were inspected directly rather than assigned invented PR references.

## Visual and UX system

- A dark navy left Sidebar organizes Monitoring, Auditing, Management, and System navigation.
- Light enterprise surfaces use consistent cards, borders, spacing, headings, controls, and status treatments.
- Page widths are constrained on large displays while data-heavy sections receive deliberate overflow or responsive alternatives.
- Desktop tables preserve dense comparisons; selected transaction, alert, report, and management views convert to cards or stacked layouts at narrower breakpoints.
- Risk, rule, workflow, account, and availability statuses use both text and visual treatment rather than color alone.
- Navigation and actions are derived from the current frontend role/permission model.
- Unsupported operations use empty, disabled, or unavailable states instead of simulated successful persistence.

## Responsive design

| Viewport class | Supported patterns |
| --- | --- |
| Desktop | Persistent Sidebar, bounded content widths, multi-column summaries, and semantic data tables. |
| Tablet | Collapsed grids, mobile Sidebar drawer, scroll-contained data regions, and reduced control density. |
| Mobile | Drawer navigation, stacked forms/cards, responsive transaction and alert cards, User Management mobile tabs, Reports high-risk cards, and adapted Dashboard Recent Transactions. |

The final CSS includes breakpoint-specific behavior, reduced-width card/table alternatives, and document-level overflow corrections. Phase 8.11 verification supports the absence of known document-level horizontal overflow in the checked target views; it does not claim exhaustive testing on every device or browser.

## Accessibility

Implemented accessibility work includes:

- Semantic primary navigation and a main content landmark.
- Explicit form labels, validation associations, textual errors, and visible focus treatment.
- Textual status labels and unavailable values alongside color/icon presentation.
- Semantic tables and labelled page sections.
- Keyboard-accessible locked navigation and distinct 403/404 outcomes.
- Reusable overlay focus trapping, initial focus, focus restoration, Escape handling, and inert background behavior.
- Accessible drawer controls with `aria-controls` and `aria-expanded`.
- Live regions for relevant loading, result-count, error, and notification feedback.
- Reduced-motion handling where present in the stylesheet.

The reusable overlay architecture is implemented in `accessibility/useOverlayFocus.js` and `accessibility/focusManagement.js`, with focused keyboard tests in `test/focusManagement.test.js`.

## Role and permission model

| Capability group | Auditor | Supervisor | Administrator |
| --- | --- | --- | --- |
| Dashboard, Transactions, Alerts, Audit Rules, own Profile | Yes | Yes | Yes |
| Review transactions and alerts | Yes | Yes | Yes |
| Cases: view/create/update assigned/request closure/escalate | Yes | Yes | Yes |
| Vendors: view/request watchlist | Yes | Yes | Yes |
| Reports, Team Activity, Alert Assignment, Audit Log | No | Yes | Yes |
| Approve case closure; review watchlist; request vendor block | No | Yes | Yes |
| User/role management, unlock users, Settings management | No | No | Yes |
| Manage vendor blocks/remove watchlist | No | No | Yes |

This table describes frontend presentation/UX enforcement in `auth/roles.js` and `auth/routeAccess.js`. Authoritative security requires backend authentication and RBAC. The current backend does not provide connected frontend authentication, so Role Preview is development-only context and not a real user identity.

## Authentication UX

| Route | Frontend state |
| --- | --- |
| `/login` | Form UX, validation, password visibility, safe unavailable-service feedback. |
| `/request-access` | Request form and validation without self-selected roles. |
| `/forgot-password` | Neutral reset-request UX and validation. |
| `/access-pending` | Pending-account state. |
| `/account-locked` | Locked-account state. |
| `/account-disabled` | Disabled-account state. |
| `/session-expired` | Expired-session state outside the application shell. |
| `/support` | Support information route. |
| `/privacy-security` | Privacy and security information route. |

[x] Frontend UX, validation, route contracts, and safe failure states are complete.  
[ ] Real authentication, password reset, account requests, session handling, user persistence, and identity-backed authorization remain backend-dependent.

## Accountability and management

| Area | Frontend completed | Backend persistence required |
| --- | --- | --- |
| Review & Accountability | Models and Transaction Detail presentation | Reviewer identity and immutable review records |
| Review History | Empty-safe timeline/list contract | Stored review history |
| Login History | Profile presentation contract | Authentication event records |
| Audit Log | Route, filtering, sorting, details, permissions | Authoritative audit-event ingestion/query |
| User Management | Pages, user/account models, actions, confirmations | Users, roles, lifecycle mutations |
| Access Requests | Request and approval/rejection UX | Submission and approval persistence |
| Locked/Disabled accounts | Status models and administrative presentation | Account state and unlock/enable operations |
| Team Activity | Metrics, workload, and activity empty states | Team relationships and activity data |
| Alert Assignment | Dialog, history model, permission checks | Assignment persistence and accountable actors |

## Advanced Audit Workflow

Phase 8.10 provides frontend architecture for Cases, escalation, evidence attachments, discussion, closure request/approval, SLA/escalation presentation, Vendor Monitoring, watchlists, blocked vendors, Vendor Risk Profile, Audit Coverage, and Risk Trends.

These workflows intentionally show unavailable, empty, or disabled states until authoritative backend implementation exists. Evidence upload remains disabled pending server-side validation and malware scanning. No case, comment, closure, vendor state, coverage metric, or trend is described as persisted today.

## Current real backend integration

Active backend domain integrations are Transactions, Alerts, and Reports. Transaction integration includes:

- `currentDataSource.kind` is `DATA_SOURCE_KIND.API`.
- AppContext calls `transactionsService.list` with `page`, `page_size`, `search`, and `sort_by`.
- Pagination totals, server search, and supported server sorting come from FastAPI.
- Loading, empty, request-error, and cancellation states are handled in the frontend.
- `transactionAdapter.js` translates backend fields without recalculating authoritative scores or findings.
- Phase 8.12B uses the existing `transactionsService.getById` for direct detail URLs outside the current list page.
- Backend `missing_fields` maps to `dataQuality.missingFields` and is authoritative whenever an array is supplied.
- Risk and rule-status filters remain current-page frontend filters; UI wording does not claim global coverage.

Auth, Users, and Access Requests are integrated with the Phase 14 backend. Phase 15 currently connects Review History and Audit Log to the review/audit API on `feature/reviews-audit-log`; migration 014 and that branch are not yet on `main`. Teams, Assignments, Notifications, Cases, Vendors, Analytics, and Settings remain unavailable or preview-only as described below.

Alerts and Reports are connected after PR #22; earlier phase descriptions retain their historical preview status. On `main` after PR #26, Auth/JWT/RBAC, authenticated REST/WebSocket/CSV, token lifecycle, and local CORS `Authorization` support are implemented, pending live application of migration 013. The Phase 15 branch records alert and transaction review actions, notes, and immutable history through migration 014; it has local tests but is not yet merged or live-applied. Alert loading currently retrieves the first 100 records at mount; reconnect catch-up is pending in backend Phase 17. Approved production origins and deployed topology verification belong to Phase 24; PR #26 did trigger a Vercel Production deployment.

`GET /api/v1/dashboard/summary` and `GET /api/v1/audit-rules` are documented but not implemented. Dashboard derivations are scoped to available frontend data, and Audit Rules uses local definitions. Authoritative summaries/rule-definition reads and connected coverage/trend analytics belong to backend Phase 20.

## Frontend service boundaries

| Domain | Frontend UI | Service/Contract Prepared | Real Backend Connected | Current State |
| --- | --- | --- | --- | --- |
| Transactions | Yes | Yes | Yes | Connected: list and detail |
| Alerts | Yes | Yes | Yes | Connected: REST listing/review and live WebSocket delivery |
| Reports | Yes | Yes | Yes | Connected: persisted generation, listing, and CSV download |
| Auth | Yes | Yes | Yes | Phase 14 API integration on `main`; migration 013 not live-confirmed |
| Users | Yes | Yes | Yes | Phase 14 admin/access-request integration on `main`; migration 013 not live-confirmed |
| Audit Log | Yes | Yes | No | Phase 15 branch integration; awaiting migration 014 and main merge |
| Reviews | Yes | Yes | No | Phase 15 branch integration; migration 014 and main merge pending |
| Teams | Yes | Yes | No | Prepared / unavailable |
| Assignments | Yes | Yes | No | Prepared / unavailable |
| Notifications | Yes | Yes | No | Prepared / preview data only |
| Cases | Yes | Yes | No | Prepared / unavailable |
| Vendors | Yes | Yes | No | Prepared / unavailable |
| Analytics | Yes | Yes | No | Prepared / unavailable |
| Settings | Yes | Yes | No | Read-only preview / unavailable persistence |

## Test and validation history

The current frontend package scripts are:

```text
npm run build  -> vite build
npm run lint   -> oxlint
npm test       -> node --test
npm run preview -> vite preview
```

Historical Phase 8.12B baseline (before PR #22):

- [x] `npm test`: 199 tests passed, 0 failed.
- [x] `npm run build`: production build passed.
- [x] `npm run lint`: passed.
- [x] `git diff --check`: passed for the Phase 8.12B implementation and its documentation correction.

Current independently rerun baseline, 2026-10-03 repository inspection at `f9c7dd5`:

- `npm test`: 204 passed, 0 failed.
- `npm run lint`: passed.
- Backend: 129 passed with one known Starlette TestClient warning.
- `git diff --check`: passed during inspection.
- Production build: not run during that inspection. Historical build successes above were not rerun at that point; see the subsequent pre-commit verification below.
- Live Supabase verification, deployed E2E, model retraining, and performance benchmarks: not run during inspection.

Subsequent documentation pre-commit verification on 2026-10-03: frontend tests `204 passed`, lint passed, and `npm run build` production build passed (Vite 8.2.2, 138 modules). Backend tests again returned `129 passed` with the known Starlette TestClient warning. `git diff --check` and the documentation/handoff-source secret scan passed. This run verifies the local build; it does not establish deployed E2E or live database state. Generated `dist` files are excluded from the commit.

Tests cover domain models, contracts, adapters, risk/report derivations, API-client behavior, route authorization, service boundaries, request states, accessibility helpers, real-time lifecycle contracts, and transaction detail loading. They do not replace live backend end-to-end, browser, security, or persistence testing.

## SWE Contribution to Project Requirements

The repository identifies requirements `C1`, `C3`, `IS1`, and `IS3` in `docs/BACKEND_IMPLEMENTATION_PLAN.md`, but it does not contain their full formal rubric wording. The wording and final grading interpretation must therefore be verified against the project rubric rather than reconstructed here.

| Requirement | SWE / Frontend Contribution | Evidence | Dependency | Status |
| --- | --- | --- | --- | --- |
| C1 (formal wording not present) | Presents standardized transaction fields, data-quality status, and missing fields through an adapter and Transaction Detail. | `transactionAdapter.js`, `TransactionDetail.jsx`, adapter tests | Backend schema, ingestion, and persistence are CS/backend evidence. | [x] Frontend evidence |
| C3 (formal wording not present) | Presents each rule result and preserves unavailable/not-evaluated states without inventing findings. | Audit Rules, Transaction Detail, audit-rule and transaction tests | Rule execution and eligibility are backend evidence. | [x] Frontend evidence |
| IS1 (formal wording not present) | Provides audit-coverage presentation architecture and UI for evaluated transaction/rule results. | `AuditAnalytics.jsx`, `analyticsModels.js`, advanced workflow tests | Coverage calculation and attainment are backend evidence. | [x] Frontend presentation; [ ] connected analytics |
| IS3 (formal wording not present) | Presents rule, anomaly, combined-risk scores, risk levels, explanations, and consistent badges. | Dashboard, Transactions, Transaction Detail, risk tests | Score calculation/model performance and persistence are backend evidence. | [x] Frontend presentation |

No frontend claim is made for the five audit-rule implementations, Isolation Forest model, authoritative risk-score calculation, Supabase persistence, alert generation, or backend report generation. The SWE contribution is limited to presentation, frontend contracts, adapters, service boundaries, and explicitly activated integration.

## Frontend Evidence Available for PPR

| Area | What can be demonstrated | Route / Evidence |
| --- | --- | --- |
| Dashboard | Enterprise overview, risk distribution, recent activity, role workspace | `/` or `/dashboard` |
| Transactions | Connected pagination/search/sort, loading/error states, responsive results | `/transactions` |
| Transaction Detail | Direct lookup, rule/risk/data-quality presentation, not-found/error separation | `/transactions/:id` |
| Alerts | Connected persisted listing/status review and live WebSocket delivery; Phase 15 branch adds attributable review/reopen history; assignment remains pending | `/alerts` |
| Audit Rules | Five named rule definitions and accessible disclosures; execution is backend-owned | `/audit-rules` |
| Reports | Connected persisted listing/generation, authoritative summaries, and CSV download; automatic scheduling remains pending | `/reports` |
| Role Preview | Development-only Auditor/Supervisor/Admin presentation | Application shell in development |
| Login UX | Supabase Auth session lifecycle and account-state routes; requires live migration 013 | `/login` and auth routes |
| User Management | Authenticated access-request, profile, and account lifecycle APIs; requires live migration 013 | `/users` |
| Audit Log | Filters, server pagination/details, and role scope connected to Phase 15 branch audit-event store | `/audit-log` |
| Cases | Workflow architecture and truthful unavailable states | `/cases`, `/cases/:caseId` |
| Vendors | Monitoring/profile architecture and disabled unavailable sections | `/vendors`, `/vendors/:vendorId` |
| Responsive behavior | Drawer navigation, responsive tables/cards/tabs | Desktop/tablet/mobile browser widths |
| Accessibility behavior | Keyboard overlays, focus restoration, semantic states/navigation | Dialogs, Sidebar drawer, focused tests |

## Frontend Completed

- [x] React/Vite application shell, routing, enterprise visual system, and responsive layout.
- [x] Dashboard, Transactions, Transaction Detail, Alerts, Audit Rules, Reports, and Settings frontend experiences.
- [x] Role-aware presentation for Auditor, Supervisor, and Administrator.
- [x] Authentication/account-state UX and validation contracts.
- [x] Accountability, management, team, assignment, notification, case, vendor, and analytics frontend architecture.
- [x] Reusable accessibility architecture for overlays and responsive navigation.
- [x] API client, adapters, service boundaries, safe unavailable states, and integration-error handling.
- [x] Live transaction-list integration plus direct Transaction Detail retrieval.
- [x] Backend-authoritative `missing_fields` mapping and data-quality precedence.
- [x] Production removal of development-only transaction simulation control.
- [x] Current rerun baseline of 204 passing frontend tests; 199 remains the historical Phase 8.12B result.

## Backend / Integration Dependencies

- [ ] Real authentication, user sessions, password reset, access-request persistence, and authoritative RBAC.
- [ ] User/account lifecycle, role changes, lock/unlock, and administrative persistence.
- [ ] Audit-event, review-history, login-history, team-activity, and assignment persistence.
- [ ] Notification delivery/read-state integration.
- [ ] Cases, evidence storage/scanning, discussion, closure, escalation, and SLA persistence.
- [ ] Vendor profiles, watchlists, blocked-vendor workflows, and monitoring persistence.
- [ ] Audit-coverage and risk-trend analytics integration.
- [ ] Settings persistence.
- [x] Core Alerts and Reports integration activated in PR #22; historical local live verification recorded above.
- [ ] Authenticated Alerts/Reports/CSV integration, reconnect catch-up, and final deployed three-role E2E (backend Phases 14, 17, and 24).
- [ ] Deployment configuration, CORS, identity/security review, and full frontend-to-FastAPI-to-Supabase end-to-end testing.

## Current frontend status

| Area | Frontend Status | Backend Dependency | Demo Ready |
| --- | --- | --- | --- |
| Shell and responsive design | Completed | None | Yes |
| Dashboard | Completed presentation | Connected transactions; other summaries remain frontend/preview scoped | Yes, with scope explanation |
| Transactions | Connected | FastAPI/Supabase transaction API | Yes |
| Transaction Detail | Connected | FastAPI detail endpoint | Yes |
| Alerts | Connected | FastAPI/Supabase alert REST and WebSocket APIs | Yes |
| Audit Rules | Completed presentation | Rule execution is backend-owned | Yes, presentation |
| Reports | Connected | FastAPI/Supabase report and CSV endpoints | Yes |
| Auth and roles | Completed UX/contracts | Authentication and RBAC | Frontend-only |
| Accountability/management | Completed architecture | Identity and persistence | Frontend-only |
| Cases/vendors/analytics | Completed architecture | Domain services and persistence | Unavailable-state demo |
| Accessibility | Implemented and tested helpers | Live assistive-technology review remains advisable | Yes |
| Test baseline | 204 passing | Deployed E2E remains required | Yes |

## Change Log

| Date | Phase | Change | Commit |
| --- | --- | --- | --- |
| 2026-09-20 | Phase 1 | Established shared frontend foundation | `94867ee` |
| 2026-09-21 | Phase 2 | Completed risk and data correctness | `9eb8b02` |
| 2026-09-21 | Phase 3 | Completed Dashboard frontend | `cb649a8` |
| 2026-09-21 | Phase 4 | Completed Transactions and Transaction Detail frontend | `2a28078` |
| 2026-09-21 | Phase 5 | Completed Alerts monitoring frontend | `7e62cb3` |
| 2026-09-28 | Phase 6 | Completed Audit Rules frontend | `65ad852` |
| 2026-09-28 | Phase 7 | Completed Reports frontend | `14b528a` |
| 2026-09-28 | Phase 8 | Completed Settings, integration readiness, and production routing | `b1d0663`, `fbfea89`, `485a914` |
| — | Phases 8.1–8.4 | No standalone frontend implementation milestone established by Git | — |
| 2026-09-30 | Phase 8.5 / 8.5B | Completed visual-system and width/surface refinements | `a0b6d55` |
| 2026-09-30 | Phase 8.6A / 8.6B / 8.6C | Completed auth UX, authorization/navigation, and workspaces/Profile in one milestone | `18c25e0` |
| 2026-09-30 | Phase 8.7 | Added accountability and Audit Log frontend | `b12f336` |
| 2026-09-30 | Phase 8.8 | Added management, team, and assignment frontend | `e15f862` |
| 2026-09-30 | Phase 8.9 | Added notifications, security UX, and request states | `496c45a` |
| 2026-09-30 | Phase 8.9A | Added reusable overlay accessibility | `7ce6fdd` |
| 2026-09-30 | Phase 8.10 | Added advanced audit workflow frontend architecture | `1bc6a50` |
| 2026-10-02 | Integration milestone | Connected transaction list to live API data | `108f7aa` |
| 2026-09-30 | Phase 8.11 | Added initial application-layout repair in the shared advanced-workflow milestone | `1bc6a50` |
| 2026-10-03 | Phase 8.11 | Completed final responsive/UI quality fixes | `4dc7b5a` |
| 2026-10-03 | Phase 8.12 | Completed final functional QA inspection | No distinct commit |
| 2026-10-03 | Phase 8.12B | Completed final frontend freeze fixes | `dc368a4` |
| 2026-10-03 | Integration milestone | Connected live alerts, authoritative risk/explanations, and persisted reports | `a8e1b8a`, `eb38337` (PR #22) |

## Next action

The frontend design remains frozen; preserve existing services and adapters. After the documentation PR is merged and verified on `main`, follow the approved backend Phases 13–24 on independent branches, starting with Phase 13A safe transaction creation, then Phase 13B integrity/recovery, Auth/RBAC, and dependent domains. Activate each prepared domain only with its tested backend contract. Deployment and final three-role E2E remain deferred to Phase 24; this document does not assert that the complete system is operational.
