import { MetricStrip } from './ui/Layout.jsx';

const count = (value) => Number(value ?? 0).toLocaleString('en-US');

export default function SummaryCards({ summary, highRiskPercentage, loading = false }) {
  const evaluatedPercentage = summary?.totalTransactions
    ? Math.round((summary.transactionsEvaluated / summary.totalTransactions) * 100)
    : 0;

  return <MetricStrip label="Audit overview" loading={loading} items={[
    { label: 'Transactions', value: summary && count(summary.totalTransactions), hint: 'In the current dataset', tone: 'primary' },
    { label: 'Evaluated', value: summary && count(summary.transactionsEvaluated), hint: `${evaluatedPercentage}% coverage`, tone: 'low' },
    { label: 'Active alerts', value: summary && count(summary.activeAlerts), hint: 'In your scope', tone: 'medium' },
    { label: 'High risk', value: summary && count(summary.highRiskTransactions), hint: `${highRiskPercentage ?? 0}% of evaluated`, tone: 'high' },
    { label: 'Average risk', value: summary && `${summary.averageRiskScore}`, hint: 'Score out of 100' },
  ]} />;
}
