import { Link } from 'react-router-dom';
import useApp from '../context/useApp';
import SummaryCards from '../components/SummaryCards';
import DonutChart from '../components/DonutChart';
import TransactionsTable from '../components/TransactionsTable';
import AlertsList from '../components/AlertsList';
import { DocIcon, CheckShieldIcon } from '../components/icons';
import { sortNewestFirst } from '../utils/transactions';

export default function Dashboard() {
  const {
    transactions,
    alerts,
    summary,
    riskOverview,
    simulateNewTransaction,
    simulating,
    lastSimulatedTransactionId,
  } = useApp();

  const recentTransactions = sortNewestFirst(transactions).slice(0, 7);
  const recentAlerts = sortNewestFirst(alerts).slice(0, 3);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Overview of the current simulated frontend dataset.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={simulateNewTransaction} disabled={simulating}>
          {simulating ? 'Adding demo transaction...' : 'Simulate Demo Transaction'}
        </button>
      </div>

      <SummaryCards summary={summary} />

      <div className="dashboard-grid">
        <div className="dashboard-left">
          <div className="card">
            <div className="card-header">
              <h2>Transaction Risk Overview</h2>
            </div>
            <DonutChart
              low={riskOverview.low}
              medium={riskOverview.medium}
              high={riskOverview.high}
              total={summary.transactionsEvaluated}
            />
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Recent Alerts</h2>
              <Link to="/alerts" style={{ fontSize: 13, color: 'var(--blue)', fontWeight: 600 }}>
                View All Alerts
              </Link>
            </div>
            <AlertsList alerts={recentAlerts} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Recent Transactions</h2>
            <Link className="btn btn-secondary" to="/transactions">View All Transactions</Link>
          </div>
          <TransactionsTable transactions={recentTransactions} highlightId={lastSimulatedTransactionId} />
        </div>
      </div>

      <div className="bottom-grid">
        <div className="action-card">
          <div className="action-card-left">
            <span className="action-card-icon">
              <DocIcon />
            </span>
            <div>
              <h3>Daily Report Preview</h3>
              <p>View a frontend-only summary. File generation requires backend integration.</p>
            </div>
          </div>
          <Link className="btn btn-primary" to="/reports">
            <DocIcon width={15} height={15} />
            View Report Preview
          </Link>
        </div>

        <div className="status-card demo-status">
          <span className="status-card-icon">
            <CheckShieldIcon />
          </span>
          <div>
            <h3>System Status</h3>
            <div className="status-value">Frontend Demo Mode</div>
            <div className="status-sub">
              Backend monitoring is not connected.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
