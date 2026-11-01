import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useApp from '../context/useApp';
import SummaryCards from '../components/SummaryCards';
import DonutChart from '../components/DonutChart';
import RecentTransactionsTable from '../components/RecentTransactionsTable';
import AlertsList from '../components/AlertsList';
import RecentCollectionState from '../components/RecentCollectionState.jsx';
import { sortNewestFirst } from '../utils/transactions';
import RoleWorkspace from '../components/RoleWorkspace';
import useAuthorization from '../auth/useAuthorization.js';
import { dashboardService, dashboardCategoryFilter } from '../services/dashboardService.js';
import { transactionsService } from '../services/transactionsService.js';
import AuditAnalytics from '../components/AuditAnalytics.jsx';
import { PRESENTATION_FEATURES } from '../config/presentation.js';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { ArrowRightIcon } from '../components/icons.jsx';

export default function Dashboard() {
  const { effectiveRole } = useAuthorization();
  const [authoritative, setAuthoritative] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [category, setCategory] = useState('');
  const [categoryTotals, setCategoryTotals] = useState(null);
  const [categoryError, setCategoryError] = useState('');
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState('');
  const [summaryRequest, setSummaryRequest] = useState(0);
  useEffect(() => {
    let active = true;
    setSummaryError(null);
    dashboardService.getSummary().then((value) => { if (active) setAuthoritative(value); }).catch((reason) => {
      if (active) setSummaryError(reason instanceof Error ? reason.message : 'Dashboard summary is unavailable.');
    });
    return () => { active = false; };
  }, [summaryRequest]);
  const {
    transactions,
    alerts,
    alertsLoading,
    alertsError,
    simulateNewTransaction,
    simulating,
    lastSimulatedTransactionId,
    lastUpdated,
  } = useApp();
  useEffect(() => {
    const controller = new AbortController();
    setCategoryError('');
    dashboardService.getCategories({ signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setCategoryTotals(value);
    }).catch((reason) => {
      if (!controller.signal.aborted) { setCategoryTotals(null); setCategoryError(reason.message); }
    });
    return () => controller.abort();
  }, [lastUpdated, effectiveRole, summaryRequest]);
  useEffect(() => {
    const controller = new AbortController();
    setRecentLoading(true);
    setRecentError('');
    setRecentTransactions([]);
    transactionsService.list({ signal: controller.signal, query: {
      page: 1, page_size: 6, sort_by: 'newest', ...dashboardCategoryFilter(category),
    } }).then((value) => {
      if (!controller.signal.aborted) setRecentTransactions(value.items);
    }).catch((reason) => {
      if (!controller.signal.aborted) setRecentError(reason.message);
    }).finally(() => { if (!controller.signal.aborted) setRecentLoading(false); });
    return () => controller.abort();
  }, [category, lastUpdated, effectiveRole, summaryRequest]);
  const currentSummary = authoritative?.summary;
  const currentCounts = authoritative?.riskCounts;
  const currentOverview = authoritative?.riskOverview;

  const categories = categoryTotals?.items ?? [];
  const recentAlerts = sortNewestFirst(alerts).slice(0, 5);

  return (
    <div className="page dashboard-page">
      <PageHeader title="Dashboard" description="Where risk sits today and what needs attention next."
        actions={import.meta.env.DEV && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={simulateNewTransaction}
            disabled={simulating}
          >
            {simulating ? 'Adding Test Transaction...' : 'Add Test Transaction'}
          </button>
        )} />

      {summaryError
        ? <div className="panel"><ErrorState compact title="Overview unavailable" message={summaryError} onRetry={() => setSummaryRequest((value) => value + 1)} /></div>
        : <SummaryCards summary={currentSummary} highRiskPercentage={currentOverview?.high} loading={!currentSummary} />}

      <div className="dashboard-grid">
        <Panel id="risk-overview-heading" className="dashboard-risk" title="Risk distribution" description="Latest evaluation of every transaction.">
          {currentCounts
            ? <DonutChart counts={currentCounts} percentages={currentOverview} total={currentCounts.low + currentCounts.medium + currentCounts.high} />
            : summaryError ? <EmptyState compact title="Risk distribution unavailable" /> : <LoadingState compact message="Loading risk distribution…" />}
        </Panel>

        <Panel id="recent-alerts-heading" className="dashboard-alerts" title="Recent alerts" description="Newest alerts in your scope." flush
          actions={<Link className="text-link" to="/alerts">View alerts<ArrowRightIcon aria-hidden="true" /></Link>}>
          <RecentCollectionState loading={alertsLoading} error={alertsError} empty={recentAlerts.length === 0} label="recent alerts">
            <AlertsList alerts={recentAlerts} variant="dashboard" />
          </RecentCollectionState>
        </Panel>
      </div>

      <Panel id="recent-transactions-heading" title="Recent transactions" description="Latest evaluated payments." flush
        actions={<Link className="text-link" to="/transactions">View transactions<ArrowRightIcon aria-hidden="true" /></Link>}>
          <label className="dashboard-category-filter">Transaction category <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
          </select></label>
          <p className="dashboard-active-alerts">Showing up to six recent transactions in the selected category across your authorized view.</p>
        <RecentCollectionState loading={recentLoading} error={recentError}
          empty={recentTransactions.length === 0} label="recent transactions" onRetry={() => setSummaryRequest((value) => value + 1)}>
          <RecentTransactionsTable transactions={recentTransactions} highlightId={lastSimulatedTransactionId} />
        </RecentCollectionState>
      </Panel>

      <section className="panel dashboard-category-card" aria-labelledby="category-heading">
        <div className="card-header"><h2 id="category-heading">Transactions by business category</h2></div>
        {categoryTotals && <p>All {categoryTotals.totalTransactions} transactions in your authorized view, grouped by recorded business activity.</p>}
        {!categoryTotals && !categoryError && <p role="status">Loading category totals…</p>}
        {categoryError && <p role="alert">Category totals are unavailable. {categoryError}</p>}
        <div className="dashboard-category-grid">
          {categories.map((item) => {
            return <button type="button" className="dashboard-category-item" key={item.key} onClick={() => setCategory(item.key)} aria-pressed={category === item.key}>
              <strong>{item.name}</strong><span>{item.transactions} transactions · {item.highRiskTransactions} high risk</span>
              <meter min="0" max={Math.max(categoryTotals.totalTransactions, 1)} value={item.transactions} aria-label={`${item.name}: ${item.transactions} of ${categoryTotals.totalTransactions} transactions`} />
            </button>;
          })}
        </div>
        {categoryTotals && !categories.length && <p role="status">No transactions to classify.</p>}
      </section>

      {PRESENTATION_FEATURES.assuranceAnalytics && <AuditAnalytics />}

      {PRESENTATION_FEATURES.roleWorkspace && (
        <RoleWorkspace role={effectiveRole} transactions={transactions} />
      )}
    </div>
  );
}
