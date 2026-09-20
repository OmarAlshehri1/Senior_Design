import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import SummaryCards from '../components/SummaryCards';
import DonutChart from '../components/DonutChart';
import TransactionsTable from '../components/TransactionsTable';
import AlertsList from '../components/AlertsList';
import { riskOverview } from '../data/mockData';
import { DocIcon, CheckShieldIcon } from '../components/icons';

export default function Dashboard() {
  const { transactions, alerts, summary, simulateNewTransaction, simulating } = useApp();

  const recentTransactions = transactions.slice(0, 7);
  const recentAlerts = alerts.slice(0, 3);
  const newestId = transactions[0]?.processing || transactions[0]?.status === 'High Risk' ? transactions[0].id : undefined;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Overview of today&apos;s transaction audit activity.</p>
        </div>
        <button className="btn btn-primary" onClick={simulateNewTransaction} disabled={simulating}>
          {simulating ? 'Processing transaction...' : 'Simulate New Transaction'}
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
            <Link to="/transactions">
              <button className="btn btn-secondary">View All Transactions</button>
            </Link>
          </div>
          <TransactionsTable transactions={recentTransactions} highlightId={newestId} />
        </div>
      </div>

      <div className="bottom-grid">
        <div className="action-card">
          <div className="action-card-left">
            <span className="action-card-icon">
              <DocIcon />
            </span>
            <div>
              <h3>Generate Daily Audit Report</h3>
              <p>Generate a comprehensive report of today&apos;s transactions, alerts, and audit summary.</p>
            </div>
          </div>
          <Link to="/reports">
            <button className="btn btn-primary">
              <DocIcon width={15} height={15} />
              Generate Report
            </button>
          </Link>
        </div>

        <div className="status-card">
          <span className="status-card-icon">
            <CheckShieldIcon />
          </span>
          <div>
            <h3>System Status</h3>
            <div className="status-value">Monitoring Active</div>
            <div className="status-sub">
              <span className="dot-pulse" />
              All systems are running smoothly.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
