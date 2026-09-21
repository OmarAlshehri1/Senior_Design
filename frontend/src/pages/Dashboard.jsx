import { Link } from 'react-router-dom';
import useApp from '../context/useApp';
import SummaryCards from '../components/SummaryCards';
import DonutChart from '../components/DonutChart';
import RecentTransactionsTable from '../components/RecentTransactionsTable';
import AlertsList from '../components/AlertsList';
import { getRecentTransactions } from '../utils/dashboard';
import { sortNewestFirst } from '../utils/transactions';

export default function Dashboard() {
  const {
    transactions,
    alerts,
    summary,
    riskCounts,
    riskOverview,
    simulateNewTransaction,
    simulating,
    lastSimulatedTransactionId,
  } = useApp();

  const recentTransactions = getRecentTransactions(transactions);
  const recentAlerts = sortNewestFirst(alerts).slice(0, 3);

  return (
    <>
      <div className="page-header dashboard-page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Overview of transaction auditing activity and risk status.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={simulateNewTransaction}
          disabled={simulating}
        >
          {simulating ? 'Adding Transaction...' : 'Simulate Transaction'}
        </button>
      </div>

      <SummaryCards summary={summary} highRiskPercentage={riskOverview.high} />

      <div className="dashboard-main-grid">
        <section className="card risk-overview-card" aria-labelledby="risk-overview-heading">
          <div className="card-header">
            <h2 id="risk-overview-heading">Transaction Risk Overview</h2>
          </div>
          <DonutChart
            counts={riskCounts}
            percentages={riskOverview}
            total={summary.transactionsEvaluated}
          />
        </section>

        <section className="card recent-transactions-card" aria-labelledby="recent-transactions-heading">
          <div className="card-header">
            <h2 id="recent-transactions-heading">Recent Transactions</h2>
            <Link className="btn btn-secondary" to="/transactions">View All Transactions</Link>
          </div>
          <RecentTransactionsTable
            transactions={recentTransactions}
            highlightId={lastSimulatedTransactionId}
          />
        </section>
      </div>

      <section className="card dashboard-alerts-card" aria-labelledby="recent-alerts-heading">
        <div className="card-header">
          <h2 id="recent-alerts-heading">Recent Alerts</h2>
          <Link className="card-header-link" to="/alerts">View All Alerts</Link>
        </div>
        <AlertsList alerts={recentAlerts} variant="dashboard" />
      </section>
    </>
  );
}
