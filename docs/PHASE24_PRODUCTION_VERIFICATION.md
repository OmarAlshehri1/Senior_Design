# Phase 24 production verification

This is the execution record for the deployed Vercel frontend, Render API, and M004 Supabase database. Record the date, deployed commit, role, result, and a redacted screenshot or log reference for each check. Owner-reported results are useful context, but are not a substitute for a fresh check against the deployed commit.

Verified on 2026-10-10 against `https://senior-design-1ypl.onrender.com`: `GET /api/v1/health` returned HTTP 200 with `{"status":"ok","service":"continuous-auditing-api"}`. An `OPTIONS` preflight for `https://senior-design-gold.vercel.app` requesting `GET` and `Authorization` returned HTTP 200 with that exact `Access-Control-Allow-Origin`; the same preflight from `https://untrusted.example` returned HTTP 400 and no allow-origin header. Unauthenticated `GET /api/v1/reports` and `GET /api/v1/alerts` each returned HTTP 401 with `SESSION_EXPIRED`. These checks do not reveal the deployed commit or other runtime settings, and do not replace role-specific authorization checks.

## Deployment and configuration

In the Render dashboard, record the deployed commit, instance count, and API worker count. In Render and Vercel, verify the **names and presence** of required environment variables without copying their values: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FRONTEND_ORIGINS`, `VITE_API_BASE_URL`, and `VITE_WS_URL`. Verify that `FRONTEND_ORIGINS` includes the exact production Vercel origin. Record the Boolean values of `TRANSACTION_RECOVERY_ENABLED`, `CASE_SLA_ESCALATION_ENABLED`, and `DAILY_REPORT_SCHEDULER_ENABLED`; all three default to `false` in the repository. Check the production API health endpoint and a preflight request from the production frontend origin.

Owner-provided Render screenshots and shell output on 2026-10-11 show live commit `4876512` on `main`, Manual Scaling set to one instance with Autoscaling off, and Start Command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. `printenv WEB_CONCURRENCY` returned `1`, confirming one API worker with that command. Render Environment shows `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `FRONTEND_ORIGINS` by name; the owner confirmed `FRONTEND_ORIGINS` contains the exact production origin `https://senior-design-gold.vercel.app`. At the time of that screenshot, `DAILY_REPORT_SCHEDULER_ENABLED` was absent and automatic daily scheduling was off; the owner later added it (see below). Other loop flags and the live `/reports/schedule` response remain to be checked. WebSocket delivery and reconnect behavior are also not yet verified.

Owner-reported on 2026-10-11: `VITE_API_BASE_URL` and `VITE_WS_URL` are present in Vercel Environment Variables, both scoped to Production. The owner confirmed `VITE_API_BASE_URL` is `https://senior-design-1ypl.onrender.com/api/v1` and `VITE_WS_URL` is `wss://senior-design-1ypl.onrender.com/ws/alerts`.

The current alert WebSocket manager holds connections in process memory. It emits an `alerts.changed` invalidation only to clients attached to that same API process. The browser then refetches actor-scoped alerts and notifications; it also refetches after a successful WebSocket authentication or reconnection. The browser makes at most three automatic reconnect attempts, and does not continuously poll after those attempts are exhausted. Therefore, record whether Render runs a single API instance and one worker. If it runs multiple instances/workers, live alert fan-out is not guaranteed; either add shared pub/sub or a periodic REST reconciliation path and verify that behavior before claiming cross-instance delivery. Persisted alerts remain available through REST.

The recovery, case-SLA, and daily-report loops start inside the API lifespan when their flags are enabled. Daily reports use a database lease; that protects against duplicate commits, but a sleeping/stopped instance cannot run the loop. Verify each enabled loop's status and restart behavior on the actual Render topology before marking it active.

Owner-run production SQL check for transaction recovery on 2026-10-11 returned `jobs_table_exists = true`, `recovery_function_exists = true` for `public.get_pending_transaction_jobs(integer)`, and `service_role_allowed = true`. This verifies essential Migration 012 objects and the worker's read RPC permission, not the complete migration body or a live recovery run. Inspect pending/expired jobs and unpublished events before enabling the worker.

Owner-run job-count query returned `total_jobs = 0`, `pending_jobs = 0`, `expired_jobs = 0`, and `unpublished_alert_events = 0`. There is no production backlog to recover. Enabling `TRANSACTION_RECOVERY_ENABLED` also switches new transaction creation to the durable job path and starts an idle poll every 10 seconds, so verify the remaining required RPC permissions and plan a legitimate new-transaction check before calling this feature production-verified.

Owner-run follow-up SQL returned `function_exists = true` and `service_role_allowed = true` for all four required RPCs: `create_transaction_with_job(jsonb,timestamptz)`, `claim_transaction_job(text)`, `finish_transaction_job(text,uuid,jsonb)`, and `release_transaction_job(text,uuid)`. This confirms those production entry points are present and callable by the backend role. End-to-end processing on the enabled path remains untested.

Owner reported on 2026-10-11 that `TRANSACTION_RECOVERY_ENABLED=true` was saved in Render and the service returned to Live. Runtime flag visibility and a new transaction through the durable path remain to be verified; the pre-activation job count was zero.

The owner later ran `printenv TRANSACTION_RECOVERY_ENABLED` in the Render Shell and received `true`. This confirms the flag is present in that running shell environment; an end-to-end transaction through the durable job path remains unverified.

Owner-run production SQL check for case-SLA escalation on 2026-10-11 returned `escalation_function_exists = true` for `public.escalate_overdue_cases(integer)` and `service_role_allowed = true`. The function is present and callable by the backend role. The current number of due cases and live worker execution have not yet been checked.

Owner-run case-count query returned `total_cases = 0` and `overdue_to_escalate = 0`. Enabling the case-SLA worker would not immediately alter existing cases; a future real case is required to verify timed escalation and notifications end to end.

Owner reported on 2026-10-11 that `CASE_SLA_ESCALATION_ENABLED=true` was saved in Render and the service returned to Live. With no cases in the database, there is no live escalation outcome to inspect yet; the runtime flag value and future-case behavior remain unverified independently.

The owner later ran `printenv CASE_SLA_ESCALATION_ENABLED` in the Render Shell and received `true`. This confirms the flag is present in that running shell environment. A live overdue-case escalation remains unverified; the newly created case has not reached its SLA due date.

Owner-run, read-only SQL check on 2026-10-11 returned `schedule_table_exists = true` for `public.daily_report_schedule_state` and `scheduler_function_exists = true` for `public.claim_daily_audit_report()`. This confirms the required scheduler objects exist, but does not show their current state or prove the loop has run. The Render scheduler flag was absent at this point and was added later (see below).

Owner-run scheduler-state query on 2026-10-11 returned `next_period_start = 2026-10-04`, `latest_due_date = 2026-10-10`, and `pending_days = 7`. Enabling the loop would process these dates in order. The completion function reuses an existing completed report for a period rather than replacing its summary, and a non-completed report for a due period would cause that attempt to fail and retry; inspect existing reports for these dates before enabling.

Owner-run `audit_reports` query for UTC periods beginning 2026-10-04 through 2026-10-10 returned only `RPT-2026-10-04`, status `COMPLETED`, covering October 4–5 UTC. No reports for October 5–10 were returned. If enabled, the scheduler should reuse the October 4 report and attempt to generate the remaining six daily reports; completion and accuracy still require live verification.

Owner reported on 2026-10-11 that `DAILY_REPORT_SCHEDULER_ENABLED=true` was saved in Render and the service returned to Live. This is an owner-reported configuration change; scheduler execution and completion have not yet been verified.

The owner later ran `printenv DAILY_REPORT_SCHEDULER_ENABLED` in the Render Shell and received `true`. Together with the completed daily-report runs recorded below, this confirms the scheduler flag is present in the running shell environment and that the scheduler has executed. Its next automatic run remains to be checked after the next UTC day becomes due.

Owner-run query of `public.daily_report_runs` on 2026-10-11 returned one row: period start 2026-10-04, status `COMPLETED`, attempt 1, report ID `RPT-2026-10-04`, no error. This proves the scheduler executed and reused the existing completed report for that day; it does not yet prove generation of a new report for October 5–10.

A follow-up owner-run query returned runs for each UTC day 2026-10-05 through 2026-10-10, all `COMPLETED` on attempt 1 with report IDs `RPT-2026-10-05` through `RPT-2026-10-10` and no error codes. This verifies the scheduler generated reports for the six previously missing days.

Owner-run schedule-state query then returned `next_period_start = 2026-10-11` and `active_run_id = null`: the scheduler has caught up through October 10 UTC and has no active run.

Owner-run comparison of `audit_reports.summary.daily_summary.total_transactions` with counts from `public.transactions` for each UTC day October 4–10 returned `0 = 0` for all seven reports. The zero-valued summaries match the stored transaction timestamps for those dates; these runs verify scheduling and count consistency, but do not demonstrate a populated daily report. The owner previously supplied a populated October 3 workbook matching its Reports-page screenshot. The next automatic run after October 11 UTC remains unverified.

Owner-run date distribution query on 2026-10-11 found 199 transactions with `transaction_timestamp IS NULL`; the highest-count dated groups shown were 2026-06-26 (70), 2026-03-29 (70), 2026-03-22 (69), and 2026-03-11 (69). The schema permits a null timestamp, and the daily-summary function filters by transaction timestamp, so those 199 rows cannot appear in a date-bounded daily report.

Owner-run follow-up query found all 199 null-timestamp transactions have `completeness_status = PARTIAL`. Their exclusion from timestamp-bounded daily reports is consistent with the current schema and report query. This does not establish whether the missing timestamps in the source data were intentional; it does not affect the October 4–10 zero-count comparison.

## Database migration checks

Run this **read-only** query in the M004 Supabase SQL Editor. It checks the presence and key behavior markers of migrations 022 and 023, not the full function bodies or a migration ledger. Inspect any `false` result before proceeding.

Owner-run result on 2026-10-11: all 11 returned columns were `true` (both functions present, analytics materialization marker, medium-risk processing marker, medium notification type allowed, and the expected `service_role`/`anon`/`authenticated` EXECUTE permissions). This is live schema evidence supplied by the owner. Exact function-body equivalence and a migration execution record have not been checked.

```sql
select
  to_regprocedure('public.get_authoritative_analytics(uuid, integer)') is not null as analytics_function_exists,
  position('flattened as materialized' in lower(coalesce(pg_get_functiondef(to_regprocedure('public.get_authoritative_analytics(uuid, integer)')), ''))) > 0 as analytics_optimized_marker,
  to_regprocedure('public.finish_transaction_job(text, uuid, jsonb)') is not null as processing_function_exists,
  position('MEDIUM' in coalesce(pg_get_functiondef(to_regprocedure('public.finish_transaction_job(text, uuid, jsonb)')), '')) > 0 as processing_medium_marker,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_notifications'::regclass
      and conname = 'user_notifications_type_check'
      and position('MEDIUM_RISK_ALERT' in pg_get_constraintdef(oid)) > 0
  ) as medium_notification_allowed,
  coalesce(has_function_privilege('service_role', to_regprocedure('public.get_authoritative_analytics(uuid, integer)'), 'EXECUTE'), false) as analytics_service_role_allowed,
  coalesce(not has_function_privilege('anon', to_regprocedure('public.get_authoritative_analytics(uuid, integer)'), 'EXECUTE'), false) as analytics_anon_denied,
  coalesce(not has_function_privilege('authenticated', to_regprocedure('public.get_authoritative_analytics(uuid, integer)'), 'EXECUTE'), false) as analytics_authenticated_denied,
  coalesce(has_function_privilege('service_role', to_regprocedure('public.finish_transaction_job(text, uuid, jsonb)'), 'EXECUTE'), false) as processing_service_role_allowed,
  coalesce(not has_function_privilege('anon', to_regprocedure('public.finish_transaction_job(text, uuid, jsonb)'), 'EXECUTE'), false) as processing_anon_denied,
  coalesce(not has_function_privilege('authenticated', to_regprocedure('public.finish_transaction_job(text, uuid, jsonb)'), 'EXECUTE'), false) as processing_authenticated_denied;
```

Keep the query result, migration execution record, and deployment commit together. Migration 022 exists locally but was untracked when this verification record was prepared; include it in version control before treating the repository as a complete deployment source.

## Reports and alert delivery

Owner report on 2026-10-11: after deployment, the Excel report download succeeded on the production website. The owner then supplied `RPT-2026-10-03 (2).xlsx` and a Reports-page screenshot. Local inspection of the downloaded workbook found report ID `RPT-2026-10-03`, UTC period 2026-10-03 to 2026-10-04 (exclusive), 9 total/evaluated transactions, 3 high-risk transactions, and average risk score 48.79. These match the screenshot. Risk distribution matches at low 4, medium 2, high 3; alerts match at total 5, active 4, reviewed 1, high 3, medium 2. Rule violations match at Duplicate Payment 5, Ghost Vendors 5, Invoice Splitting 7, and Segregation of Duties 3. All three high-risk transaction IDs, vendors, amounts (500 SAR), and risk scores (88) also match. The workbook contains two charts. This verifies the supplied workbook against the supplied screenshot; the deployed commit and scheduler status were not independently checked.

As an Admin after the current deployment, generate a **Latest Activity** report from the Reports page. Record its report ID and UTC period. Confirm its transaction count is non-zero, its risk/alert counts agree with the page, and its authenticated Excel download contains the same report totals. Confirm `GET /api/v1/reports/schedule` reflects the actual scheduler flag and recent runs. A completed report for an older day with all-zero totals does not satisfy this check.

An owner-provided production Reports screenshot after the latest-activity step shows `RPT-2026-10-03` as `COMPLETED`, covering 2026-10-03 through 2026-10-04 UTC (exclusive), completed on 2026-10-11 at 6:06 PM UTC. The displayed summary has 9 total/evaluated transactions, 3 high-risk transactions, average risk score 48.79, 4 active alerts, and 1 reviewed alert; the visible risk distribution is low 4, medium 2, high 3. This is a populated persisted report for the latest transaction day. The screenshot does not establish the exact button interaction or the newly downloaded workbook contents, so those remain to be verified separately.

The `Generate Latest Activity` action deliberately selects the UTC date of the newest non-null `transactions.transaction_timestamp`, not the calendar date when the button is pressed. Thus the report was completed on October 11 but covers October 3, the latest dated transaction day shown. The separate automatic scheduler generates completed UTC days only: a report for October 11 UTC becomes due after 00:00 UTC on October 12 (03:00 in Riyadh), and would contain zero transactions if none were posted with an October 11 UTC timestamp. The 199 transactions with null timestamps cannot select a latest-activity period.

The owner confirmed downloading the Excel workbook for the newly displayed latest-activity report and checking that its values all match the Reports page. This is owner-reported verification; no copy of that new download or comparison screenshot was provided in this step. The earlier October 3 workbook had already been inspected locally against a prior page screenshot.

For a newly processed medium-risk transaction, confirm the persisted alert, appropriate notification, actor-scoped REST visibility, WebSocket invalidation, and catch-up after disconnect/reconnect. Separately verify the behavior after a Render restart. Existing historical medium alerts demonstrate backfill, but do not prove the new-event or real-time path.

An owner-provided Chrome Network screenshot on 2026-10-11, while Admin Badr was on `/alerts`, shows two `alerts` requests of type `websocket` with status `101`. One completed after about 1.18 seconds and the other remained `Pending`. This confirms the WebSocket upgrade occurred and a connection was open at capture time. The owner subsequently confirmed that an incoming `auth.ready` frame appeared on the pending connection, establishing authenticated WebSocket readiness without sharing an access token. An `alerts.changed` event and reconnect/catch-up behavior remain unverified.

Fix pushed to `main` as commit `2f6df87` after this check: successful alert assignment, reassignment, unassignment, review, and reopening now publish the existing `alerts.changed` invalidation. The client already reacts by refetching actor-scoped alerts and notifications. The focused backend tests passed (11/11). A broader local suite produced 222 passes and five unrelated failures/errors caused by sandbox permissions for temporary files and Windows pipes; it did not provide a clean full-suite pass. The owner then reported seeing commit `2f6df87` in Render; the `Live` deploy status and production event delivery have not yet been shown. The live stream still uses process-local connections; the one-instance/one-worker production configuration is required for reliable fan-out without shared pub/sub.

After reporting the Render commit, the owner supplied a browser WebSocket Messages screenshot showing an incoming `{"type":"auth.ready"}` frame on a newly opened alerts connection. This verifies authenticated socket readiness in that browser session. Render's `Live` status was not shown in that screenshot.

The owner then supplied a WebSocket Messages screenshot showing an incoming `{"type":"alerts.changed","occurred_at":null}` frame after the requested Supervisor-to-Auditor alert assignment while Badr's alerts socket remained open. This verifies production delivery of the invalidation signal for that assignment. The `null` timestamp is expected for assignment/review invalidations, which do not include alert creation time. Ali's automatic actor-scoped refresh without a manual page reload remains to be checked.

The subsequent Ali Alerts screenshot still shows one reviewed medium-risk alert (`AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57`), with no second alert visible. This does not verify automatic refresh in Ali's existing tab. First reload Ali's page to check whether the new assignment is visible through REST; then inspect Ali's own WebSocket connection during a separate change to distinguish a disconnected/stale tab from a client reconciliation failure. The frontend currently stops after three failed automatic reconnect attempts, so an open tab left through a deployment might not reconnect indefinitely.

The owner then refreshed Ali's Alerts page and reported that the count rose from one to two. This confirms the second assignment is persisted and visible through Ali's actor-scoped REST fetch. It also narrows the missing automatic update to Ali's earlier live connection or client reconciliation path; Ali's WebSocket state at the time of assignment was not captured.

After reloading Ali's page, the owner supplied a WebSocket Messages screenshot showing an incoming `{"type":"auth.ready"}` frame for Ali, matching the authenticated connection previously observed for Badr. This verifies Ali's current socket is authenticated. A new assignment while this socket remains open is still needed to confirm Ali receives `alerts.changed` and updates the page without a reload.

After a subsequent assignment with Ali's socket open, the owner supplied a WebSocket Messages screenshot showing `{"type":"alerts.changed","occurred_at":null}` in Ali's tab. This confirms Ali's authenticated connection received the production assignment invalidation. The page count after this event, without a manual reload, has not yet been reported, so automatic UI reconciliation is still unverified.

The owner confirmed that Ali's Alerts count rose from two to three and the newly assigned alert appeared without a manual page reload. Together with Ali's captured `alerts.changed` frame, this verifies end-to-end live assignment invalidation and actor-scoped UI refresh on the deployed backend. The earlier tab that remained stale across the deployment still warrants a separate reconnect/catch-up check.

For the later restart/reconnect check, an owner-provided DevTools Network screenshot in Ali's browser shows three `alerts` WebSocket entries: an earlier connection finished, and a newer `101` connection remained `Pending`. This is evidence that a new WebSocket connection opened after the earlier one ended. The screenshot does not itself show the Render deploy state, an incoming `auth.ready` frame on the newest connection, or whether the alert list was refreshed through catch-up.

On inspecting the newest `Pending` WebSocket entry, the owner reported that its Messages pane said `No message`. Therefore the available evidence does not establish authenticated reconnection or catch-up after the restart. Keep the page unrefreshed long enough to check whether frames arrive; if it remains empty, a manual reload can test recovery but must not be counted as automatic reconnection.

The owner confirmed that `auth.ready` still did not appear after the additional wait. This is a failed/inconclusive automatic-authentication recovery check, not a successful reconnect. A frontend recovery fix has been prepared locally: transient closures retry with a capped delay rather than stopping after three attempts, and an opened socket that never receives `auth.ready` is closed after ten seconds so it can retry; policy/auth closure code `1008` stops retries. The full frontend test suite passed (238/238), and build and lint passed. This frontend change has not yet been deployed or retested in production.

## Three-role workflow

Owner-provided production screenshot on 2026-10-11 shows Ali signed in with the `Auditor` role on `/dashboard`. The page displays populated transaction and risk metrics (9,853 total transactions, 9,654 evaluated, 574 medium risk, 3 high risk), while Reports, Team Activity, User Management, Audit Log, and Settings are marked locked in navigation. This verifies a successful Auditor dashboard render and visible role-based navigation restrictions; direct-route denial, backend authorization responses, and the rest of the Auditor workflow remain unverified.

A second owner-provided screenshot shows that entering `/reports` directly as Ali redirects the browser to `/403` and displays `Access Denied`. Direct-route protection for Reports is verified at the frontend. This does not by itself prove the backend rejects an authenticated Auditor request to `/api/v1/reports`.

The owner then ran a same-session browser-console `GET` against the production `/api/v1/reports` endpoint with Ali's bearer session; the console screenshot shows `HTTP status: 403` and `GET ... 403 (Forbidden)`. This verifies the deployed backend also rejects the Auditor's authenticated Reports request. No session token value was shared.

An owner-provided Auditor screenshot of `/transactions` shows a populated, paginated list (`1–10 of 9,853`) with transaction IDs, vendors, amounts, rule statuses, AI scores, combined risk scores, and risk levels. This verifies the Auditor can reach the permitted list and see data; transaction detail and filter behavior remain to be checked.

An owner-provided Auditor screenshot of `/transactions/TX-LIVE-HIGH-20261003112025` shows the detail page loading with rule score `80/100`, AI score `100/100`, final score `88/100`, `High Risk`, and rule status `Review`. The displayed score matches the 60/40 formula (`0.6 × 80 + 0.4 × 100 = 88`). The visible Segregation of Duties rule is marked `Failed` with an explanation that creator and approver are the same actor. The remaining rule rows and alert/review flow are not yet visible in this screenshot.

A follow-up screenshot of the same transaction shows all five rule results with explanations: Segregation of Duties, Duplicate Payments, Invoice Splitting, and Ghost Vendors are `Failed`; Approval Limits is `Passed`. The AI Analysis panel labels the `100/100` score as Isolation Forest, and Data Quality is `Complete`. Risk Explanation says `Not available`; this is an optional advisory field and does not invalidate the persisted rule/AI/risk evidence. The Review & Accountability section begins below the visible fold and has not yet been inspected.

An owner-provided screenshot of Review & Accountability for the same transaction shows `Not Reviewed`, an enabled `Mark Transaction Reviewed` action, empty reviewer/timestamp fields, and no review history yet. The review-note and resolution controls are visible but have not been submitted. This documents the pre-action state; persistence and attribution still need verification.

After the owner selected `Mark Transaction Reviewed`, a production screenshot shows status `Reviewed`, `Reviewed By: Ali`, timestamp `2026-10-11T14:20:03.756695+00:00`, and a `REVIEWED` history event attributed to Ali with role `AUDITOR`. The available action changes to `Reopen Transaction Review`. A reload has not yet confirmed persistence across a fresh fetch.

The owner confirmed that after a full page reload the transaction still showed `Reviewed` and Ali in the history. This verifies that the Auditor review was persisted and reloaded, not only updated in the current UI state.

An owner-provided Auditor screenshot of `/alerts` shows `0 Alerts`, with all Active, Reviewed, High-Risk, and Medium-Risk counters at zero. This matches the Auditor dashboard's previously displayed `0 active alerts in your authorized scope`. The backend's `list_accessible_alerts` implementation scopes Auditor alerts to current `ASSIGNED` rows; verify the live assignment count before concluding the zero is expected rather than a visibility defect.

Owner-run SQL found `ali_assigned_alerts = 0` among `ASSIGNED` rows in `public.alert_assignments`. The empty Auditor alert list is therefore consistent with the current assignment scope. Alert visibility after a new assignment remains to be tested.

An owner-provided production screenshot of Omar signed in as `Supervisor` on `/alerts` shows `Alerts could not be loaded` with `FORBIDDEN`. The displayed zero counters are fallback values after a failed request, not evidence that Omar's scope contains zero alerts. The deployed `list_accessible_alerts` RPC denies a Supervisor without an active supervised team; check Omar's live team mapping before attributing the 403 to that condition.

Owner-run SQL confirmed Omar's `user_profiles` row is `ACTIVE`, but its left join to `public.audit_teams` returned `team = null` and `is_active = null`. The missing supervised team explains the Supervisor Alerts `FORBIDDEN` under the current RPC policy. Provision an active team for Omar through the Admin workflow, then retest Alerts and the assignment flow.

An owner-provided Admin screenshot shows Badr on `/team-activity` with the `Create Team` form (team name and active Supervisor selector). Team Overview shows 0 members and 0 active assignments, with 576 open alerts in the Admin scope. This is the pre-provisioning state; no team has yet been created for Omar.

A follow-up Admin screenshot shows `Retail Audit Team` created with Omar as Supervisor, Team Members `1`, and a `TEAM_CREATED` event attributed to Badr. The Manage Team form is available; no Auditor has been added yet. Retest Omar's Alerts after provisioning to confirm the earlier `FORBIDDEN` is resolved.

Another Admin screenshot shows Ali listed as an `AUDITOR` member of Retail Audit Team under Omar, Team Members `2`, Active Assignments `0`, and a `TEAM_MEMBER_ADDED` event attributed to Badr. This verifies the team membership workflow and its visible audit activity. Omar's Alerts and Ali's alert scope have not yet been retested after provisioning.

An owner-provided screenshot after team provisioning shows Omar signed in as `Supervisor` on `/alerts`, with the alert list loaded instead of `FORBIDDEN`. It shows 577 alerts: 576 active and 1 reviewed; 3 high-risk and 574 medium-risk. The first visible alert is unassigned and offers an `Assign` action. This verifies that the missing-team authorization failure was resolved and that Omar can read alerts in the configured Supervisor scope. An actual assignment to Ali and Ali's subsequent visibility remain unverified.

The owner reported completing the `Assign` action for Ali from Omar's Supervisor session. Assignment persistence and Ali's scoped alert visibility have not yet been confirmed by a refreshed screen or query.

An owner-provided screenshot of Ali's `/alerts` page after the Supervisor assignment shows exactly one visible active medium-risk alert, for transaction `EXP-2026-009495` and alert `AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57`; before assignment his scope showed zero. The notification bell shows a badge of `1`. This verifies the assignment is reflected in Ali's refreshed alert scope and that a notification is indicated. Notification content, alert review, and persistence after review remain to be tested.

A follow-up screenshot of Ali's notification panel shows `1 unread` and an `Alert assigned` notification stating that alert `AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57` was assigned to him, with timestamp `2026-10-11T15:02:48.275588+00:00`. This verifies the notification content matches the visible assigned alert. Mark-as-read persistence and delivery latency have not yet been measured.

The owner confirmed completing the `Mark as Read` and refresh check for this notification, reporting the requested unread count of zero. The result is owner-reported; no post-refresh screenshot or backend query was supplied. Delivery latency remains unmeasured.

An owner-provided screenshot shows Ali marking the assigned alert reviewed: the UI confirms `Alert marked as reviewed`, the alert row displays `Reviewed`, and his scoped counters change to 0 active and 1 reviewed (1 medium-risk alert total). This verifies the immediate alert-review result. Persistence after reloading the page and the review audit event remain to be checked.

The owner confirmed that the alert still displayed `Reviewed` after reloading Ali's `/alerts` page. This provides owner-reported evidence of persisted review state. The detailed alert record and attributable review event have not yet been inspected.

Owner-provided screenshots of transaction `EXP-2026-009495` show the related alert's `Review State: Reviewed` and a `REVIEWED` history event attributed to Ali (`AUDITOR`) at `2026-10-11T15:11:38.06104+00:00`. The transaction itself still displays `Transaction Review Status: Not Reviewed`, with blank transaction `Reviewed By/At`. Source inspection of `frontend/src/pages/TransactionDetail.jsx` confirms these are separate transaction and alert review states: the page combines both event streams in `Review History`, while the status and accountability fields use only transaction review events. The current presentation does not label the event's resource type, which may confuse reviewers. The page also shows a 62.16 combined score from rule 40 and AI 95.4 (60/40), medium risk, and a partially complete data-quality badge for `approval_limit`.

An owner-provided Ali screenshot shows the `Start Investigation Case` dialog opened from the assigned reviewed alert `AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57`. It prepopulates title `Medium-risk transaction detected`, description `The transaction should be reviewed according to policy.`, priority `MEDIUM`, and leaves department optional. The dialog states that case creation retains alert and transaction references and does not change the alert. No case has been submitted yet.

The next owner-provided screenshot shows case `CASE-000001` created successfully from that alert. It is `Open`, priority `MEDIUM`, assigned to Ali, linked to transaction `EXP-2026-009495` and alert `AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57`, and shows `Due in 48h 0m` with an SLA due date of 2026-10-13 8:25:33 PM in the browser's displayed time zone. The page offers a status transition to `INVESTIGATING` and case discussion. Evidence upload is explicitly disabled because a private storage bucket and antivirus scanner are not configured; the evidence-upload workflow therefore remains unavailable in production.

A further owner-provided screenshot of `Case Activity` shows `CASE STATUS CHANGED`, attributed to Ali at `2026-10-11T17:28:48.724119+00:00`, with previous status `OPEN`, new status `INVESTIGATING`, and note `Investigation started by Ali.` This verifies the case status transition and attributable activity record. The separate discussion-comment workflow has not yet been tested.

An owner-provided screenshot shows Ali's case comment `Reviewing the segregation-of-duties and invoice-splitting findings for EXP-2026-009495.` in `Case Discussion`, with Ali and a displayed timestamp. `Case Activity` also records `CASE COMMENT ADDED` by Ali at `2026-10-11T17:34:31.772057+00:00` with comment ID 1. This verifies the comment is reflected in both discussion and attributable activity. Cross-role Supervisor visibility and case closure remain untested.

The case's `Assignment History` line `Ali assigned to Ali` reflects automatic self-assignment at creation: `create_case` defaults a missing assignee to the creating actor and records that actor as the assignment-event author. The frontend renders every assignment event with the generic wording `{actor} assigned to {assignee}`. This is expected data, though the initial-assignment wording could be clearer.

An owner-provided screenshot of Omar signed in as `Supervisor` on `/cases` shows one case in his authorized queue: `CASE-000001`, priority `MEDIUM`, status `Investigating`, assigned to Ali, with the same source alert and an active SLA countdown (`Due in 47h 48m`). This verifies the case is visible to the supervising team and reflects Ali's status change. The case detail, comment visibility, and any Supervisor actions remain to be checked.

A second owner-provided Omar screenshot opens `CASE-000001` and shows the linked transaction and alert, Ali as assignee, Ali's discussion comment, and the three attributable `Case Activity` events (`CASE CREATED`, `CASE STATUS CHANGED`, `CASE COMMENT ADDED`). This verifies cross-role visibility of the case detail and its history. The page offers Supervisor case status and assignment controls, but no Supervisor mutation has been exercised. The case remains `INVESTIGATING`; evidence uploads remain disabled.

An owner-provided screenshot of Omar's `/audit-log` shows 14 scoped records, including Omar's alert assignment and Ali's alert review, but none of the newer `CASE_CREATED`, `CASE_STATUS_CHANGED`, or `CASE_COMMENT_ADDED` events shown in the case detail. Source inspection of `list_scoped_audit_events` in migration 015 explains the gap: Supervisor access checks actor ownership or `audit_events.details.team_id`, while the case audit-event inserts in migration 017 omit `team_id` from their details. The frontend's `Your activity until team scope is available` badge reflects its current static Supervisor scope label. Check Admin's global audit log to confirm the case events were persisted before changing Supervisor scoping.

An owner-provided Admin screenshot of `/audit-log` shows 59 global records, including Ali's `Case Created` and `Case Comment Added` events for case UUID `5957d7cc-40be-4df7-bde3-6d2ea084329e`. This confirms those events were persisted but omitted from Omar's scope. The case-status event is written by the database function, but the frontend `normalizeAuditEvent` rejected `CASE_STATUS_CHANGED` because that action was missing from its allowlist. Local fixes are prepared in migration `024_scope_case_audit_events_to_supervisors.sql` and the frontend audit action definitions: Supervisors will be allowed to read case events for their active team through `audit_cases.team_id`, including historical events, and the frontend will retain case-status and other supported case actions. The SQL migration and frontend changes are not yet deployed or production-verified.

The owner ran migration 024 in the production Supabase SQL Editor and reported `Success. No rows returned`. This indicates the replacement function was accepted. Omar's scoped audit results still need a live retest; the frontend audit-action changes remain local and have not been deployed.

The owner then refreshed Omar's `/audit-log`. The scoped total rose from 14 to 17 records, and both `Case Comment Added` and `Case Created` for case UUID `5957d7cc-40be-4df7-bde3-6d2ea084329e` are now visible. This verifies the production migration restored the Supervisor's case-event scope, including historical records. The third added record is consistent with the `CASE_STATUS_CHANGED` event that the currently deployed frontend filters out; its appearance still requires deployment and a fresh UI check. The page retains the old static Supervisor scope badge because the frontend update is not deployed.

After commit `1a983f1` was pushed to `main`, an owner-provided screenshot of Omar's production `/audit-log` shows all three case events (`Case Comment Added`, `Case Status Changed`, `Case Created`) for UUID `5957d7cc-40be-4df7-bde3-6d2ea084329e`, attributed to Ali with `Success` outcomes. The badge now reads `Your activity and available team events`. This verifies the database scope fix and deployed frontend action handling together for this case. The live Vercel deployment ID was not separately recorded.

The `17 records` counter did not rise after the frontend deployment because the API had already counted all 17 scoped database rows after migration 024. The old frontend discarded `CASE_STATUS_CHANGED` during normalization, so only 16 rows were rendered; the new frontend renders that previously counted row. The counter is the API total, not a count of rendered rows.

For each of Auditor, Supervisor, and Admin, record the deployed commit and walk through sign-in, dashboard, transactions, rule/AI/risk detail, alerts, review/assignment, case/evidence/discussion/closure, vendors, notifications, audit log, reports, and analytics **where permitted**. Check direct URLs as well as navigation. For a forbidden operation, record the backend HTTP response (normally `403`), not just a hidden button. Repeat the authenticated Excel download and WebSocket checks with a permitted role and a denied role. Include a session-expiry and reconnect check.

Mark Phase 24 complete only after the live results and remaining gaps are recorded. Local unit tests and owner screenshots do not establish the deployed configuration or role authorization by themselves.
