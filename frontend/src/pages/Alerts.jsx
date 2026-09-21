import { useMemo, useState } from 'react';
import useApp from '../context/useApp';
import AlertsTable from '../components/AlertsTable';
import { SearchIcon } from '../components/icons';
import {
  ALERT_SORT_OPTIONS,
  ALERT_TYPE_OPTIONS,
  deriveAlertSummary,
  filterAndSortAlerts,
} from '../utils/alerts';

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
  const {
    alerts,
    transactions,
    markAlertReviewed,
    showNotification,
  } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [riskFilter, setRiskFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sortBy, setSortBy] = useState(ALERT_SORT_OPTIONS.NEWEST);

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

  const handleMarkReviewed = (transactionId) => {
    markAlertReviewed(transactionId);
    showNotification('Alert marked as reviewed.', 'success');
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
        {filteredAlerts.length > 0 ? (
          <AlertsTable alerts={filteredAlerts} onMarkReviewed={handleMarkReviewed} />
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
    </>
  );
}
