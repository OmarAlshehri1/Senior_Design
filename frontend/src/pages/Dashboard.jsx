import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useApp from '../context/useApp';
import SummaryCards from '../components/SummaryCards';
import DonutChart from '../components/DonutChart';
import RecentTransactionsTable from '../components/RecentTransactionsTable';
import AlertsList from '../components/AlertsList';
import usePagedResource from '../hooks/usePagedResource.js';
import { dashboardRecentService } from '../services/dashboardRecentService.js';
import RecentCollectionState from '../components/RecentCollectionState.jsx';
import { sortNewestFirst } from '../utils/transactions';
import RoleWorkspace from '../components/RoleWorkspace';
import useAuthorization from '../auth/useAuthorization.js';
import { dashboardService } from '../services/dashboardService.js';
import AuditAnalytics from '../components/AuditAnalytics.jsx';
import { PRESENTATION_FEATURES } from '../config/presentation.js';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { ArrowRightIcon } from '../components/icons.jsx';

export default function Dashboard() {
  const { effectiveRole } = useAuthorization();
  const [authoritative, setAuthoritative] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
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
  } = useApp();
  const currentSummary = authoritative?.summary;
  const currentCounts = authoritative?.riskCounts;
  const currentOverview = authoritative?.riskOverview;

  const recent = usePagedResource(dashboardRecentService.list, { page: 1, page_size: 6 });
  const recentTransactions = recent.items;
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
        <RecentCollectionState loading={recent.status === 'loading'} error={recent.error}
          empty={recentTransactions.length === 0} label="recent transactions" onRetry={() => recent.resource.load()}>
          <RecentTransactionsTable transactions={recentTransactions} highlightId={lastSimulatedTransactionId} />
        </RecentCollectionState>
      </Panel>

      {PRESENTATION_FEATURES.assuranceAnalytics && <AuditAnalytics />}

      {PRESENTATION_FEATURES.roleWorkspace && (
        <RoleWorkspace role={effectiveRole} transactions={transactions} />
      )}
    </div>
  );
}
