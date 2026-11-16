import { useEffect, useRef, useState } from 'react';
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
import { Badge, PageHeader, Panel } from '../components/ui/Layout.jsx';
import { SelectField } from '../components/ui/Filters.jsx';
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
  const [demo, setDemo] = useState(null);
  const demoTimer = useRef(null);
  useEffect(() => {
    setDemo(null);
    return () => { clearTimeout(demoTimer.current); demoTimer.current = null; };
  }, [effectiveRole]);
  const startDemo = () => {
    if (demoTimer.current !== null) return;
    const startedAt = performance.now();
    setDemo({ status: 'processing' });
    // Presentation only: never send this fixture to a service or shared store.
    demoTimer.current = setTimeout(() => {
      setDemo({ status: 'complete', elapsed: ((performance.now() - startedAt) / 1000).toFixed(1),
        transaction: { id: 'TR-DEMO-001', vendor: 'Demo Vendor', amount: 1250, currency: 'USD',
          category: 'Presentation demo', riskLevel: 'Medium Risk' } });
      demoTimer.current = null;
    }, 1100);
  };
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
        actions={(
          <button
            type="button"
            className="btn btn-secondary"
            onClick={startDemo}
            disabled={demo?.status === 'processing'}
          >
            Real-time test
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
        <div className="dashboard-recent-toolbar">
          <SelectField label="Transaction category" value={category} onChange={setCategory}
            options={[{ value: '', label: 'All categories' }, ...categories.map((item) => ({ value: item.key, label: item.name }))]} />
          <p>Up to six recent transactions in the selected category.</p>
        </div>
        {demo && <div className="dashboard-demo-status" role="status" aria-live="polite">
          <Badge tone="info">Demo</Badge>
          <span>{demo.status === 'processing' ? 'Evaluating transaction…' : `Demo complete · UI demo elapsed: ${demo.elapsed} s (frontend timer)`}</span>
          <span className="muted">Simulated workflow and risk result.</span>
          {demo.status === 'complete' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDemo(null)}>Dismiss demo</button>}
        </div>}
        {demo?.transaction && (recentLoading || recentError || recentTransactions.length === 0) &&
          <RecentTransactionsTable transactions={[]} demoTransaction={demo.transaction} />}
        <RecentCollectionState loading={recentLoading} error={recentError}
          empty={recentTransactions.length === 0} label="recent transactions" onRetry={() => setSummaryRequest((value) => value + 1)}>
          <RecentTransactionsTable transactions={recentTransactions} demoTransaction={demo?.transaction} />
        </RecentCollectionState>
      </Panel>

      <Panel id="category-heading" className="dashboard-category-card" title="Transactions by business category"
        description={categoryTotals ? `${categoryTotals.totalTransactions.toLocaleString('en-US')} transactions in your authorized view, grouped by recorded business activity.` : undefined}>
        {!categoryTotals && !categoryError && <LoadingState compact message="Loading category totals…" />}
        {categoryError && <ErrorState compact title="Category totals are unavailable." message={categoryError} />}
        <div className="dashboard-category-grid">
          {categories.map((item) => {
            return <button type="button" className="dashboard-category-item" key={item.key} onClick={() => setCategory(item.key)} aria-pressed={category === item.key}>
              <span className="dashboard-category-summary"><strong>{item.name}</strong>
                <span className="dashboard-category-count">{item.transactions.toLocaleString('en-US')} transactions</span>
                <Badge tone={item.highRiskTransactions ? 'high' : 'neutral'}>{item.highRiskTransactions.toLocaleString('en-US')} high risk</Badge>
              </span>
              <span className="dashboard-category-bar" role="meter" aria-valuemin={0} aria-valuemax={Math.max(categoryTotals.totalTransactions, 1)} aria-valuenow={item.transactions}
                aria-label={`${item.name}: ${item.transactions} of ${categoryTotals.totalTransactions} transactions`}>
                <span style={{ width: `${(item.transactions / Math.max(categoryTotals.totalTransactions, 1)) * 100}%` }} />
              </span>
            </button>;
          })}
        </div>
        {categoryTotals && !categories.length && <EmptyState compact title="No transactions to classify." />}
      </Panel>

      {PRESENTATION_FEATURES.assuranceAnalytics && <AuditAnalytics />}

      {PRESENTATION_FEATURES.roleWorkspace && (
        <RoleWorkspace role={effectiveRole} transactions={transactions} />
      )}
    </div>
  );
}
