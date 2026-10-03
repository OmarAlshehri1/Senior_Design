import { useEffect, useState } from 'react';
import { ANALYTICS_PERIODS, createAuditCoverage, createTrendModel } from '../analytics/analyticsModels.js';
import { analyticsService } from '../services/analyticsService.js';

function PeriodSelect({ id, value, onChange }) {
  return <label className="analytics-period"><span>Period</span><select id={id} value={value} onChange={(event) => onChange(event.target.value)}>{ANALYTICS_PERIODS.map((period) => <option key={period} value={period}>{period.replace('_', ' ').toLowerCase()}</option>)}</select></label>;
}

function Empty({ children }) {
  return <div className="chart-empty-state" role="status"><h3>{children}</h3></div>;
}

export default function AuditAnalytics() {
  const [period, setPeriod] = useState('30_DAYS');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    analyticsService.getOverview(period).then((value) => { if (active) setOverview(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Audit analytics are unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period]);
  const coverage = overview?.coverage ?? createAuditCoverage();
  const risk = overview?.riskTrends ?? createTrendModel({ period });
  const rules = overview?.ruleViolationTrends ?? createTrendModel({ period });
  return <section className="report-analytics" aria-labelledby="audit-analytics-heading">
    <div className="report-section-header"><div><span className="report-section-eyebrow">Assurance analytics</span><h2 id="audit-analytics-heading">Audit Coverage &amp; Risk Trends</h2><p>Coverage uses the latest persisted evaluation for every stored transaction.</p></div><PeriodSelect id="analytics-period" value={period} onChange={setPeriod} /></div>
    {error && <div className="request-state request-state-error" role="alert">{error}</div>}
    {loading && <div className="request-state" role="status">Loading authoritative analytics…</div>}
    {!loading && !error && <>
      <section className="card analytics-card" aria-labelledby="coverage-heading"><div className="analytics-card-header"><div><h3 id="coverage-heading">Audit Coverage</h3><p>Transactions with at least one executed rule divided by all stored transactions.</p></div><strong className="coverage-value">{coverage.coveragePercentage ?? 0}%</strong></div>
        <div className="analytics-metrics">{[['Total Transactions', coverage.totalTransactions], ['Fully Evaluated', coverage.fullyEvaluated], ['Partially Evaluated', coverage.partiallyEvaluated], ['Not Evaluated', coverage.notEvaluated]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value ?? 0}</strong></div>)}</div>
        {coverage.byRule.length === 0 ? <Empty>No per-rule evaluation records are available.</Empty> : <div className="coverage-table-wrap"><table className="operations-table"><caption>Coverage by Rule (denominator: all stored transactions)</caption><thead><tr><th>Audit Rule</th><th>Evaluated</th><th>Not Evaluated</th><th>Coverage</th></tr></thead><tbody>{coverage.byRule.map((rule) => <tr key={rule.ruleKey}><th scope="row">{rule.ruleName ?? rule.ruleKey}</th><td>{rule.evaluatedTransactions}</td><td>{rule.notEvaluatedTransactions}</td><td>{rule.coveragePercentage}%</td></tr>)}</tbody></table></div>}
        <aside className="coverage-exclusions"><h4>Why rules were not evaluated</h4>{coverage.exclusions.length === 0 ? <p>No unevaluated rules in the latest snapshots.</p> : <ul>{coverage.exclusions.map((item) => <li key={`${item.ruleKey}-${item.reason}`}>{item.ruleKey}: {item.reason.replaceAll('_', ' ').toLowerCase()} ({item.transactionCount})</li>)}</ul>}</aside>
      </section>
      <div className="analytics-grid"><section className="card analytics-card" aria-labelledby="risk-trend-heading"><div className="analytics-card-header"><div><h3 id="risk-trend-heading">Risk Trend</h3><p>Daily persisted risk snapshots, alerts created, and case outcomes.</p></div></div>{risk.series.length === 0 ? <Empty>No risk snapshots in this period.</Empty> : <div className="coverage-table-wrap"><table className="operations-table"><thead><tr><th>Date (UTC)</th><th>Average Risk</th><th>High</th><th>Medium</th><th>Low</th><th>Alerts</th><th>Confirmed</th><th>False Positives</th></tr></thead><tbody>{risk.series.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.average_risk_score ?? '—'}</td><td>{row.high_risk_transactions}</td><td>{row.medium_risk_transactions}</td><td>{row.low_risk_transactions}</td><td>{row.alerts_created}</td><td>{row.confirmed_issues}</td><td>{row.false_positives}</td></tr>)}</tbody></table></div>}</section>
        <section className="card analytics-card" aria-labelledby="rule-trend-heading"><div className="analytics-card-header"><div><h3 id="rule-trend-heading">Violations by Rule Over Time</h3><p>Failed results from latest evaluations recorded each UTC day.</p></div></div>{rules.series.length === 0 ? <Empty>No rule evaluations in this period.</Empty> : <div className="coverage-table-wrap"><table className="operations-table"><thead><tr><th>Date (UTC)</th><th>Rule</th><th>Violations</th></tr></thead><tbody>{rules.series.map((row) => <tr key={`${row.date}-${row.rule_key}`}><td>{row.date}</td><td>{row.rule_name}</td><td>{row.violations}</td></tr>)}</tbody></table></div>}</section></div>
    </>}
  </section>;
}
