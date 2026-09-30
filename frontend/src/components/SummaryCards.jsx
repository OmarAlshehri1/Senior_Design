import { Link } from 'react-router-dom';
import { DocIcon, ClipboardCheckIcon, TriangleAlertIcon, GaugeIcon } from './icons';
import { DASHBOARD_RISK_LINKS } from '../utils/dashboard';

function SummaryCard({ label, value, context, valueClass, iconClass, icon: Icon, to }) {
  const content = (
    <>
      <span className={`summary-card-icon ${iconClass}`} aria-hidden="true"><Icon /></span>
      <span className="summary-card-copy">
        <span className="summary-card-label">{label}</span>
        <strong className={`summary-card-value ${valueClass}`}>{value}</strong>
        <span className="summary-card-context">{context}</span>
      </span>
    </>
  );

  if (to) {
    return (
      <Link
        className="summary-card summary-card-link"
        to={to}
        aria-label={`${label}: ${value}. ${context}`}
      >
        {content}
      </Link>
    );
  }

  return <div className="summary-card">{content}</div>;
}

export default function SummaryCards({ summary, highRiskPercentage }) {
  const evaluatedPercentage = summary.totalTransactions
    ? Math.round((summary.transactionsEvaluated / summary.totalTransactions) * 100)
    : 0;

  return (
    <section className="system-overview" aria-labelledby="system-overview-heading">
      <div className="system-overview-heading">
        <h2 id="system-overview-heading">System Overview</h2>
        <p>Current audit activity across the system.</p>
      </div>
      <div className="summary-grid">
        <SummaryCard
        label="Total Transactions"
        value={summary.totalTransactions.toLocaleString('en-US')}
        valueClass="value-blue"
        iconClass="icon-blue"
        icon={DocIcon}
        context="Current dataset"
      />
        <SummaryCard
        label="Transactions Evaluated"
        value={summary.transactionsEvaluated.toLocaleString('en-US')}
        valueClass="value-green"
        iconClass="icon-green"
        icon={ClipboardCheckIcon}
        context={`${evaluatedPercentage}% evaluated`}
      />
        <SummaryCard
        label="High-Risk Transactions"
        value={summary.highRiskTransactions}
        valueClass="value-red"
        iconClass="icon-red"
        icon={TriangleAlertIcon}
        context={`${highRiskPercentage}% of evaluated`}
        to={DASHBOARD_RISK_LINKS.high}
      />
        <SummaryCard
        label="Average Risk Score"
        value={`${summary.averageRiskScore}/100`}
        valueClass="value-orange"
        iconClass="icon-orange"
        icon={GaugeIcon}
        context="Current dataset average"
        />
      </div>
    </section>
  );
}
