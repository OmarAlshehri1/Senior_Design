import { useEffect, useRef, useState } from 'react';
import useApp from '../context/useApp';
import AlertsTable from '../components/AlertsTable';
import { ALERT_RULE_OPTIONS, buildAlertRows } from '../utils/alerts.js';
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
import { MetricStrip, PageHeader } from '../components/ui/Layout.jsx';
import { Combobox, FilterBar, SearchField, SegmentedControl, SelectField } from '../components/ui/Filters.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';

const STATUS_OPTIONS = [{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'REVIEWED', label: 'Reviewed' }];
const RISK_OPTIONS = [{ value: '', label: 'All' }, { value: 'MEDIUM', label: 'Medium', tone: 'medium' }, { value: 'HIGH', label: 'High', tone: 'high' }];
const SORT_OPTIONS = [{ value: 'NEWEST', label: 'Newest' }, { value: 'OLDEST', label: 'Oldest' }, { value: 'HIGHEST_RISK', label: 'Highest risk' }];
const RULE_OPTIONS = [{ value: '', label: 'All Rules' }, ...ALERT_RULE_OPTIONS];
const ALERT_FILTER_KEYS = ['status', 'severity', 'rule', 'type', 'search'];

// Counts come from the scoped options query, or from exact status totals.
function useAlertOverview(refreshKey) {
  const [overview, setOverview] = useState({ status: 'loading', options: null, counts: null });
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    alertsService.getFilterOptions({ signal }).then(async (options) => {
      if (options?.supported) return { options, counts: options.counts };
      const [active, reviewed] = await Promise.all(['ACTIVE', 'REVIEWED'].map((status) => alertsService.list({ query: { page: 1, page_size: 1, status }, signal })));
      return { options: null, counts: { active: active.total, reviewed: reviewed.total } };
    }).then((value) => { if (!signal.aborted) setOverview({ status: 'success', ...value }); })
      .catch(() => { if (!signal.aborted) setOverview({ status: 'error', options: null, counts: null }); });
    return () => controller.abort();
  }, [refreshKey]);
  return overview;
}

// Every control is a server-side filter; each change returns to page 1.
export function AlertFilters({ summary, activeCount, onClear, advanced, ruleFilter, types, query, search, onSearch, onFilter }) {
  return <FilterBar label="Alert filters" summary={summary} activeCount={activeCount} onClear={onClear}>
    {advanced && <SearchField label="Search alerts" value={search} onChange={onSearch} placeholder="Search by alert, transaction or vendor" />}
    <SegmentedControl label="Status" value={query.status ?? ''} options={STATUS_OPTIONS} onChange={(value) => onFilter({ status: value || undefined })} />
    {advanced && <SegmentedControl label="Risk" value={query.severity ?? ''} options={RISK_OPTIONS} onChange={(value) => onFilter({ severity: value || undefined })} />}
    {ruleFilter && <SelectField label="Audit Rule" value={query.rule ?? ''} options={RULE_OPTIONS} onChange={(value) => onFilter({ rule: value || undefined })} />}
    {advanced && types.length > 1 && (types.length > 6
      ? <Combobox label="Type" value={query.type ?? ''} allLabel="All types" options={types.map((value) => ({ value, label: value }))} onChange={(value) => onFilter({ type: value || undefined })} />
      : <SelectField label="Type" value={query.type ?? ''} options={[{ value: '', label: 'All' }, ...types.map((value) => ({ value, label: value }))]} onChange={(value) => onFilter({ type: value || undefined })} />)}
    {advanced && <SelectField label="Sort" value={query.sort ?? 'NEWEST'} options={SORT_OPTIONS} onChange={(value) => onFilter({ sort: value === 'NEWEST' ? undefined : value })} />}
  </FilterBar>;
}

export default function Alerts() {
  const navigate = useNavigate();
  const { effectiveRole, user } = useAuthorization();
  const { transactions, showNotification, setAlertAssignment, refreshNotifications } = useApp();
  const collection = usePagedResource(alertsService.list);
  const { resource } = collection;
  const [reviewing, setReviewing] = useState(false);
  const reviewPending = useRef(false);
  const [overviewKey, setOverviewKey] = useState(0);
  const overview = useAlertOverview(overviewKey);
  const advanced = Boolean(overview.options?.supported);
  const types = overview.options?.types ?? [];
  const ruleFilter = advanced && overview.options?.rules === true;
  const [search, setSearch] = useState('');
  const pendingSearch = (collection.query.search ?? '') !== search.trim();
  useEffect(() => {
    if ((collection.query.search ?? '') === search.trim()) return undefined;
    const timer = setTimeout(() => resource.setFilters({ search: search.trim() || undefined }), 300);
    return () => clearTimeout(timer);
  }, [search, collection.query.search, resource]);
  useEffect(() => realtimeService.onMessage((event) => {
    if (['alerts.changed', 'alerts.catch_up'].includes(event.type)) { resource.load(); setOverviewKey((value) => value + 1); }
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
      await resource.load(); refreshNotifications(); setOverviewKey((value) => value + 1);
      showNotification('Alert marked as reviewed.', 'success');
    } catch (error) { showNotification(error?.message || 'Alert could not be reviewed.', 'error'); }
    finally { reviewPending.current = false; setReviewing(false); }
  };
  const rows = buildAlertRows(collection.items, transactions);
  const query = collection.query;
  const activeFilters = ALERT_FILTER_KEYS.filter((key) => query[key]).length + (query.sort && query.sort !== 'NEWEST' ? 1 : 0);
  const loading = collection.status === 'loading' || pendingSearch;
  const summary = loading ? 'Loading alerts…' : collection.error ? 'Alerts unavailable'
    : `${collection.total.toLocaleString('en-US')} ${collection.total === 1 ? 'alert' : 'alerts'}${activeFilters ? ' match your filters' : ''}`;
  const counts = overview.counts;
  const metrics = counts && advanced ? [
    { label: 'Active', value: counts.active?.toLocaleString('en-US'), hint: 'Awaiting review', tone: 'primary' },
    { label: 'High risk', value: counts.active_high?.toLocaleString('en-US'), hint: 'Active, high severity', tone: 'high' },
    { label: 'Medium risk', value: counts.active_medium?.toLocaleString('en-US'), hint: 'Active, medium severity', tone: 'medium' },
    { label: 'Reviewed', value: counts.reviewed?.toLocaleString('en-US'), hint: 'Review recorded', tone: 'low' },
  ] : counts ? [
    { label: 'Active', value: counts.active?.toLocaleString('en-US'), hint: 'Awaiting review', tone: 'primary' },
    { label: 'Reviewed', value: counts.reviewed?.toLocaleString('en-US'), hint: 'Review recorded', tone: 'low' },
  ] : null;
  const clearFilters = () => { setSearch(''); resource.setFilters({ status: undefined, severity: undefined, rule: undefined, type: undefined, search: undefined, sort: undefined }); };

  return (
    <div className="page alerts-page">
      <PageHeader title="Alerts" description="Payments flagged for auditor review, newest first." />

      {overview.status === 'loading' && <MetricStrip label="Alert summary" loading items={[{ label: 'Active' }, { label: 'High risk' }, { label: 'Medium risk' }, { label: 'Reviewed' }]} />}
      {metrics && <MetricStrip label="Alert summary" items={metrics} />}

      <AlertFilters summary={summary} activeCount={activeFilters} onClear={clearFilters} advanced={advanced} ruleFilter={ruleFilter}
        types={types} query={query} search={search} onSearch={setSearch} onFilter={resource.setFilters} />

      <section className="panel panel-table" aria-label="Alert queue" aria-busy={loading}>
        {caseBusy && <p className="inline-status panel-inline-status" role="status">Creating case…</p>}
        {loading ? <LoadingState message={collection.refreshing ? 'Refreshing alerts…' : 'Loading alerts…'} />
          : collection.error ? <ErrorState title="Alerts could not be loaded." message={collection.error} onRetry={() => resource.load()} />
            : collection.items.length ? <AlertsTable alertOwnerId={user?.id} alerts={rows} reviewing={reviewing} onMarkReviewed={handleMarkReviewed} canAssign={canAssignAlerts} onAssign={setAssignmentAlert} canEscalateToCase={canEscalateToCase} onCreateCase={createCaseFromAlert} />
              : activeFilters ? <EmptyState filtered title="No alerts match these filters." message="Try another status, risk level or audit rule, or clear the filters."
                action={<button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>} />
                : <EmptyState title="No alerts right now." message="New alerts appear here as payments are evaluated." />}
        {!pendingSearch && <CollectionPagination collection={collection} itemLabel="alerts" />}
      </section>
      <AssignmentDialog alert={assignmentAlert}
        currentAssignment={assignmentData.alertId === assignmentAlert?.id ? assignmentData.assignment : null}
        eligibleUsers={assignmentData.alertId === assignmentAlert?.id ? assignmentData.eligibleUsers : []}
        history={assignmentData.alertId === assignmentAlert?.id ? assignmentData.history : []}
        busy={assignmentBusy} error={assignmentError} onSave={saveAssignment} onUnassign={unassignAlert}
        onClose={() => setAssignmentAlert(null)} />
      <CaseCreateDialog alert={caseAlert} busy={caseBusy} onClose={() => setCaseAlert(null)} onSubmit={saveCaseFromAlert} />
    </div>
  );
}
