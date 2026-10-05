import { useEffect, useMemo, useState } from 'react';
import useApp from '../context/useApp';
import AlertsTable from '../components/AlertsTable';
import { SearchIcon } from '../components/icons';
import {
  ALERT_SORT_OPTIONS,
  ALERT_TYPE_OPTIONS,
  deriveAlertSummary,
  filterAndSortAlerts,
} from '../utils/alerts';
import AssignmentDialog from '../components/AssignmentDialog.jsx';
import useAuthorization from '../auth/useAuthorization.js';
import { hasPermission, PERMISSIONS } from '../auth/roles.js';
import { assignmentService } from '../assignments/assignmentService.js';
import { casesService } from '../services/casesService.js';
import CaseCreateDialog from '../components/CaseCreateDialog.jsx';
import { useNavigate } from 'react-router-dom';

function EmptyAlertsState({
  alertCount,
  search,
  statusFilter,
  riskFilter,
  typeFilter,
}) {
  let title = 'No alerts available.';
  let guidance = 'Alerts requiring audit attention will appear here when available.';
  const statusIsOnlyFilter = riskFilter === 'All' && typeFilter === 'All';

  if (alertCount > 0 && search.trim()) {
    title = 'No alerts found.';
    guidance = 'Try a different alert ID, transaction ID, vendor, or alert type.';
  } else if (alertCount > 0 && statusFilter === 'Active' && statusIsOnlyFilter) {
    title = 'No active alerts require review.';
    guidance = 'Clear the filters to review other alerts.';
  } else if (alertCount > 0 && statusFilter === 'Reviewed' && statusIsOnlyFilter) {
    title = 'No reviewed alerts match the selected filters.';
    guidance = 'Try adjusting or clearing the filters.';
  } else if (alertCount > 0) {
    title = 'No alerts match the selected filters.';
    guidance = 'Try adjusting your search or clearing the filters.';
  }

  return (
    <div className="alerts-empty-state" role="status">
      <h3>{title}</h3>
      <p>{guidance}</p>
    </div>
  );
}

export default function Alerts() {
  const navigate = useNavigate();
  const { effectiveRole } = useAuthorization();
  const {
    alerts,
    alertsLoading,
    alertsError,
    transactions,
    markAlertReviewed,
    showNotification,
    setAlertAssignment,
    refreshNotifications,
  } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [riskFilter, setRiskFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sortBy, setSortBy] = useState(ALERT_SORT_OPTIONS.NEWEST);
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
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : 'Alert could not be unassigned.');
    } finally { setAssignmentBusy(false); }
  };

  const summary = useMemo(() => deriveAlertSummary(alerts), [alerts]);
  const filteredAlerts = useMemo(
    () => filterAndSortAlerts(alerts, transactions, {
      search,
      statusFilter,
      riskFilter,
      typeFilter,
      sortBy,
    }),
    [alerts, transactions, search, statusFilter, riskFilter, typeFilter, sortBy]
  );

  const filtersActive = Boolean(search.trim())
    || statusFilter !== 'All'
    || riskFilter !== 'All'
    || typeFilter !== 'All';
  const resultLabel = filtersActive
    ? `${filteredAlerts.length} of ${alerts.length} Alerts`
    : `${alerts.length} Alerts`;

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setRiskFilter('All');
    setTypeFilter('All');
    setSortBy(ALERT_SORT_OPTIONS.NEWEST);
  };

  const handleMarkReviewed = async (transactionId) => {
    try {
      await markAlertReviewed(transactionId);
      showNotification(
        'Alert marked as reviewed.',
        'success'
      );
    } catch (error) {
      showNotification(
        error instanceof Error
          ? error.message
          : 'Alert could not be reviewed.',
        'error'
      );
    }
  };

  const summaryItems = [
    ['Active Alerts', summary.active, 'active'],
    ['Reviewed Alerts', summary.reviewed, 'reviewed'],
    ['High-Risk Alerts', summary.high, 'high'],
    ['Medium-Risk Alerts', summary.medium, 'medium'],
  ];

  return (
    <>
      <div className="page-header alerts-page-header">
        <div>
          <h1>Alerts</h1>
          <p>Review transactions that require audit attention.</p>
        </div>
        <span className="alerts-result-count" aria-live="polite">{resultLabel}</span>
      </div>

      <section className="alerts-summary-grid" aria-label="Alert summary">
        {summaryItems.map(([label, value, tone]) => (
          <div className={`alert-summary-item summary-${tone}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <div className="alerts-toolbar" aria-label="Alert search and filters">
        <label className="alerts-search">
          <span className="control-label">Search</span>
          <span className="search-input">
            <SearchIcon width={16} height={16} color="#7b8493" aria-hidden="true" />
            <input
              placeholder="Search alert ID, transaction ID, vendor, or type"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>

        <label className="alerts-select-control">
          <span className="control-label">Status</span>
          <select
            className="select-input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Reviewed">Reviewed</option>
          </select>
        </label>

        <label className="alerts-select-control">
          <span className="control-label">Risk</span>
          <select
            className="select-input"
            value={riskFilter}
            onChange={(event) => setRiskFilter(event.target.value)}
          >
            <option value="All">All Risks</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </label>

        <label className="alerts-select-control alerts-type-control">
          <span className="control-label">Alert Type</span>
          <select
            className="select-input"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="All">All Types</option>
            {ALERT_TYPE_OPTIONS.map((type) => (
              <option value={type} key={type}>{type}</option>
            ))}
          </select>
        </label>

        <label className="alerts-select-control">
          <span className="control-label">Sort By</span>
          <select
            className="select-input"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value={ALERT_SORT_OPTIONS.NEWEST}>Newest</option>
            <option value={ALERT_SORT_OPTIONS.OLDEST}>Oldest</option>
            <option value={ALERT_SORT_OPTIONS.HIGHEST_RISK}>Highest Risk</option>
            <option value={ALERT_SORT_OPTIONS.LOWEST_RISK}>Lowest Risk</option>
          </select>
        </label>

        {filtersActive && (
          <button type="button" className="btn btn-secondary alerts-clear-button" onClick={clearFilters}>
            Clear Filters
          </button>
        )}
      </div>

      <section className="card alerts-card" aria-labelledby="alerts-results-heading">
        <div className="card-header">
          <h2 id="alerts-results-heading">{resultLabel}</h2>
        </div>
        {alertsLoading ? (
          <div className="alerts-empty-state" role="status">
            <h3>Loading alerts…</h3>
            <p>Retrieving authoritative alerts from the audit service.</p>
          </div>
        ) : alertsError ? (
          <div className="alerts-empty-state" role="alert">
            <h3>Alerts could not be loaded.</h3>
            <p>{alertsError}</p>
          </div>
        ) : filteredAlerts.length > 0 ? (
          <>{caseBusy && <p role="status">Creating case…</p>}<AlertsTable alerts={filteredAlerts} onMarkReviewed={handleMarkReviewed} canAssign={canAssignAlerts} onAssign={setAssignmentAlert} canEscalateToCase={canEscalateToCase} onCreateCase={createCaseFromAlert} /></>
        ) : (
          <EmptyAlertsState
            alertCount={alerts.length}
            search={search}
            statusFilter={statusFilter}
            riskFilter={riskFilter}
            typeFilter={typeFilter}
          />
        )}
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
