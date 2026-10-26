const REASONS = {
  ACTOR_COMPARISON_NOT_VERIFIED: 'Creator and approver identities are not verified for comparison.',
  ACTOR_IDENTITY_MISSING: 'Creator or approver identity is missing.',
  APPROVAL_POLICY_UNAVAILABLE: 'No applicable approval policy is available.',
  APPROVAL_POLICY_AMBIGUOUS: 'More than one approval policy matches.',
  MONETARY_FIELDS_MISSING: 'Amount or currency is missing.',
  VENDOR_IDENTITY_UNRESOLVED: 'The vendor name is not linked to a verified vendor ID.',
  INVOICE_REFERENCE_MISSING: 'An invoice reference is missing; a voucher number does not establish one.',
  PRECISE_EVENT_TIME_MISSING: 'A precise transaction time is missing.',
  HISTORY_COVERAGE_UNAVAILABLE: 'Authoritative history does not cover the required period.',
  HISTORY_INCOMPLETE: 'Required earlier records are not fully prepared.',
  TIME_WINDOW_UNSUPPORTED: 'The required time window cannot be represented.',
  POSITIVE_APPROVAL_LIMIT_REQUIRED: 'A positive approval limit is required.',
  SUBTHRESHOLD_HISTORY_UNAVAILABLE: 'Saved history for payments individually below the approval limit is unavailable.',
  AUTHORITATIVE_VENDOR_REGISTRY_UNAVAILABLE: 'An authoritative vendor registry is unavailable.',
};
const STATUSES = { PASSED: ['Passed', 'clear'], FAILED: ['Failed', 'indicated'], NOT_EVALUATED: ['Not evaluated', 'pending'] };
const words = value => String(value).replaceAll('_', ' ');
const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

export function CoverageCount({ coverage }) {
  return coverage && Number.isInteger(coverage.evaluated) && Number.isInteger(coverage.total)
    ? <span>{coverage.evaluated} / {coverage.total} evaluated</span> : <span>Unavailable</span>;
}

export default function AuditCoverage({ coverage, rules, completed }) {
  return <section className="local-feed-audit" aria-label="Audit coverage">
    <h3>Audit coverage</h3>
    {coverage ? <p><CoverageCount coverage={coverage} /> · {coverage.failed} failed · {coverage.not_evaluated} not evaluated</p>
      : <p>{completed ? 'Saved rule coverage is unavailable through this session’s reader. No rule outcomes are assumed.' : 'Waiting for saved rule results.'}</p>}
    <p>Processing completion means the check was saved. The simulation indicator is separate from these five audit rules.</p>
    {Array.isArray(rules) && rules.length > 0 ? <div className="local-feed-table-scroll"><table className="local-feed-table" aria-label="Saved audit rule results">
      <thead><tr><th>Rule</th><th>Saved result</th><th>Reason / missing data</th></tr></thead>
      <tbody>{rules.map(rule => {
        const [label, tone] = STATUSES[rule.status] || ['Unavailable', 'neutral'];
        const reasons = strings(rule.evidence?.gate_reasons);
        const missing = strings(rule.evidence?.missing_fields);
        const alternatives = (Array.isArray(rule.evidence?.missing_any_of) ? rule.evidence.missing_any_of : [])
          .map(group => Array.isArray(group) ? strings(group).map(words).join(' or ') : words(group));
        return <tr key={rule.rule_key}><td>{rule.rule_name || words(rule.rule_key)}</td>
          <td><span className={`local-feed-badge ${tone}`}>{label}</span></td>
          <td>{reasons.length ? <ul>{reasons.map(reason => <li key={reason}>{REASONS[reason] || words(reason)}</li>)}</ul> : <p>{rule.detail || 'No additional reason was saved.'}</p>}
            {missing.length > 0 && <p>Missing: {missing.map(words).join(', ')}.</p>}
            {alternatives.length > 0 && <p>Required alternatives: {alternatives.join('; ')}.</p>}</td></tr>;
      })}</tbody></table></div> : completed && <p>Detailed saved rule results are unavailable in this session.</p>}
  </section>;
}
