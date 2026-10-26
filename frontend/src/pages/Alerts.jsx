import { useEffect, useRef, useState } from 'react';
import useApp from '../context/useApp';
import AlertsTable from '../components/AlertsTable';
import { buildAlertRows } from '../utils/alerts.js';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import { alertsService } from '../services/alertsService.js';
import { realtimeService } from '../services/realtimeService.js';
import AssignmentDialog from '../components/AssignmentDialog.jsx';
import useAuthorization from '../auth/useAuthorization.js';
import { hasPermission, PERMISSIONS } from '../auth/roles.js';
import { assignmentService } from '../assignments/assignmentService.js';
import { casesService } from '../services/casesService.js';
import CaseCreateDialog from '../components/CaseCreateDialog.jsx';
import { useNavigate } from 'react-router-dom';

export default function Alerts() {
  const navigate = useNavigate();
  const { effectiveRole, user } = useAuthorization();
  const { transactions, showNotification, setAlertAssignment, refreshNotifications } = useApp();
  const collection = usePagedResource(alertsService.list);
  const { resource } = collection;
  const [reviewing, setReviewing] = useState(false);
  const reviewPending = useRef(false);
  const statusFilter = collection.query.status ?? '';
  useEffect(() => realtimeService.onMessage((event) => {
    if (['alerts.changed', 'alerts.catch_up'].includes(event.type)) resource.load();
  }), [resource]);
  const [assignmentAlert, setAssignmentAlert] = useState(null);
  const [assignmentData, setAssignmentData] = useState({ alertId: null, assignment: null, history: [], eligibleUsers: [] });
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState(null);
  const [caseBusy, setCaseBusy] = useState(false);
  const [caseAlert, setCaseAlert] = useState(null);
  const canAssignAlerts = hasPermission(effectiveRole, PERMISSIONS.ASSIGN_ALERTS);
  const canEscalateToCase = hasPermission(effectiveRole, PERMISSIONS.CREATE_CASE);

  const createCaseFromAlert = (alert) => setCaseAlert(alert);
  const saveCaseFromAlert = async (input) => {
    if (!caseAlert) return;
    setCaseBusy(true);
    try {
      const created = await casesService.createCase({ source_type: 'ALERT', source_id: caseAlert.id, ...input });
      showNotification(`Case ${created.reference ?? created.id} created.`, 'success');
      setCaseAlert(null);
      navigate(`/cases/${encodeURIComponent(created.id)}`);
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Case could not be created.', 'error');
    } finally { setCaseBusy(false); }
  };

  useEffect(() => {
    if (!assignmentAlert) return undefined;
    let active = true;
    setAssignmentError(null);
    setAssignmentData({ alertId: assignmentAlert.id, assignment: null, history: [], eligibleUsers: [] });
    assignmentService.getAlertAssignmentHistory(assignmentAlert.id).then((data) => {
      if (active) setAssignmentData({ ...data, alertId: assignmentAlert.id });
    }).catch((error) => {
      if (active) setAssignmentError(error instanceof Error ? error.message : 'Assignment details could not be loaded.');
    });
    return () => { active = false; };
  }, [assignmentAlert]);

  const saveAssignment = async ({ assigneeId, note }) => {
    setAssignmentBusy(true);
    setAssignmentError(null);
    try {
      const current = assignmentData.alertId === assignmentAlert.id ? assignmentData.assignment : null;
      const result = current?.assigneeId
        ? await assignmentService.reassignAlert(assignmentAlert.id, assigneeId, note || null)
        : await assignmentService.assignAlert(assignmentAlert.id, assigneeId, note || null);
      setAlertAssignment(assignmentAlert.id, result.assignment);
      refreshNotifications();
      setAssignmentData((previous) => ({ ...previous, alertId: assignmentAlert.id, assignment: result.assignment }));
      showNotification('Alert assignment saved.', 'success');
      setAssignmentAlert(null);
      resource.load();
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : 'Alert assignment could not be saved.');
    } finally { setAssignmentBusy(false); }
  };

  const unassignAlert = async () => {
    setAssignmentBusy(true);
    setAssignmentError(null);
    try {
      const result = await assignmentService.unassignAlert(assignmentAlert.id);
      setAlertAssignment(assignmentAlert.id, result.assignment);
      refreshNotifications();
      setAssignmentData((previous) => ({ ...previous, alertId: assignmentAlert.id, assignment: result.assignment }));
      showNotification('Alert returned to the team queue.', 'success');
      setAssignmentAlert(null);
      resource.load();
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : 'Alert could not be unassigned.');
    } finally { setAssignmentBusy(false); }
  };

  const handleMarkReviewed = async (transactionId) => {
    const alert = collection.items.find((item) => item.transactionId === transactionId);
    if (!alert || reviewPending.current) return;
    reviewPending.current = true; setReviewing(true);
    try {
      await alertsService.markReviewed(alert.id);
      await resource.load(); refreshNotifications();
      showNotification('Alert marked as reviewed.', 'success');
    } catch (error) { showNotification(error?.message || 'Alert could not be reviewed.', 'error'); }
    finally { reviewPending.current = false; setReviewing(false); }
  };
  const rows = buildAlertRows(collection.items, transactions);
  const resultLabel = collection.status === 'success' ? `${collection.total.toLocaleString('en-US')} ${statusFilter ? statusFilter.toLowerCase() + ' ' : ''}alerts` : 'Alerts';

  return (
    <>
      <div className="page-header alerts-page-header">
        <div>
          <h1>Alerts</h1>
          <p>Review transactions that require audit attention.</p>
        </div>
        <span className="alerts-result-count" aria-live="polite">{resultLabel}</span>
      </div>

      <div className="alerts-toolbar compact-alert-toolbar" aria-label="Alert filters">
        <label className="alerts-select-control"><span className="control-label">Status</span>
          <select className="select-input" value={statusFilter} onChange={(event) => resource.setFilters({ status: event.target.value || undefined })}>
            <option value="">All alerts</option><option value="ACTIVE">Active</option><option value="REVIEWED">Reviewed</option>
          </select>
        </label>
        {statusFilter && <button type="button" className="btn btn-secondary" onClick={() => resource.setFilters({ status: undefined })}>Clear Filters</button>}
      </div>

      <section className="card alerts-card" aria-labelledby="alerts-results-heading">
        <div className="card-header">
          <h2 id="alerts-results-heading">{resultLabel}</h2>
        </div>
        {collection.status === 'loading' ? <div className="alerts-empty-state" role="status"><h3>{collection.refreshing ? 'Refreshing alerts…' : 'Loading alerts…'}</h3></div>
          : collection.error ? <div className="alerts-empty-state" role="alert"><h3>Alerts could not be loaded.</h3><p>{collection.error}</p><button type="button" className="btn btn-secondary" onClick={() => resource.load()}>Retry</button></div>
          : collection.items.length ? <>{caseBusy && <p role="status">Creating case…</p>}<AlertsTable alertOwnerId={user?.id} alerts={rows} reviewing={reviewing} onMarkReviewed={handleMarkReviewed} canAssign={canAssignAlerts} onAssign={setAssignmentAlert} canEscalateToCase={canEscalateToCase} onCreateCase={createCaseFromAlert} /></>
          : <div className="alerts-empty-state"><h3>{statusFilter ? 'No alerts match this status.' : 'No alerts available.'}</h3></div>}
        <CollectionPagination collection={collection} itemLabel="alerts" />
      </section>
      <AssignmentDialog alert={assignmentAlert}
        currentAssignment={assignmentData.alertId === assignmentAlert?.id ? assignmentData.assignment : null}
        eligibleUsers={assignmentData.alertId === assignmentAlert?.id ? assignmentData.eligibleUsers : []}
        history={assignmentData.alertId === assignmentAlert?.id ? assignmentData.history : []}
        busy={assignmentBusy} error={assignmentError} onSave={saveAssignment} onUnassign={unassignAlert}
        onClose={() => setAssignmentAlert(null)} />
      <CaseCreateDialog alert={caseAlert} busy={caseBusy} onClose={() => setCaseAlert(null)} onSubmit={saveCaseFromAlert} />
    </>
  );
}
