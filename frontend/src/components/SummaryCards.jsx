import { Link } from 'react-router-dom';
import { DocIcon, ClipboardCheckIcon, TriangleAlertIcon, GaugeIcon } from './icons';
import { DASHBOARD_RISK_LINKS } from '../utils/dashboard';

function SummaryCard({ label, value, context, valueClass, iconClass, icon: Icon, to }) {
  const content = (
    <>
      <div className="summary-card-top">
        <span className="summary-card-label">{label}</span>
        <span className={`summary-card-icon ${iconClass}`}>
          <Icon />
        </span>
      </div>
      <div className={`summary-card-value ${valueClass}`}>{value}</div>
      <div className="summary-card-context">{context}</div>
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
  );
}
