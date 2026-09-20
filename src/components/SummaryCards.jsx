import { DocIcon, ClipboardCheckIcon, TriangleAlertIcon, GaugeIcon } from './icons';

function Sparkline({ variant, seed }) {
  const bars = Array.from({ length: 28 }, (_, i) => {
    const v = Math.abs(Math.sin(i * 12.9898 * (seed + 1)) * 43758.5453) % 1;
    return Math.round(20 + v * 80);
  });
  return (
    <div className="sparkline">
      {bars.map((h, i) => (
        <span key={i} className={`spark-${variant}`} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function SummaryCard({ label, value, valueClass, iconClass, icon: Icon, sparkVariant, seed }) {
  return (
    <div className="summary-card">
      <div className="summary-card-top">
        <span className="summary-card-label">{label}</span>
        <span className={`summary-card-icon ${iconClass}`}>
          <Icon />
        </span>
      </div>
      <div className={`summary-card-value ${valueClass}`}>{value}</div>
      <Sparkline variant={sparkVariant} seed={seed} />
    </div>
  );
}

export default function SummaryCards({ summary }) {
  return (
    <div className="summary-grid">
      <SummaryCard
        label="Total Transactions Today"
        value={summary.totalTransactionsToday.toLocaleString('en-US')}
        valueClass="value-blue"
        iconClass="icon-blue"
        icon={DocIcon}
        sparkVariant="blue"
        seed={1}
      />
      <SummaryCard
        label="Transactions Evaluated"
        value={summary.transactionsEvaluated.toLocaleString('en-US')}
        valueClass="value-green"
        iconClass="icon-green"
        icon={ClipboardCheckIcon}
        sparkVariant="green"
        seed={2}
      />
      <SummaryCard
        label="High-Risk Transactions"
        value={summary.highRiskTransactions}
        valueClass="value-red"
        iconClass="icon-red"
        icon={TriangleAlertIcon}
        sparkVariant="red"
        seed={3}
      />
      <SummaryCard
        label="Average Risk Score"
        value={`${summary.averageRiskScore}/100`}
        valueClass="value-orange"
        iconClass="icon-orange"
        icon={GaugeIcon}
        sparkVariant="orange"
        seed={4}
      />
    </div>
  );
}
