import { useEffect, useState } from 'react';
import { auditRulesService } from '../services/auditRulesService.js';
import { toggleExpandedRuleIds } from '../utils/auditRules';
import { ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { UsersIcon, LimitIcon, DuplicateIcon, SplitIcon, GhostIcon } from '../components/icons';

const iconMap = {
  segregationOfDuties: UsersIcon,
  approvalLimit: LimitIcon,
  duplicatePayment: DuplicateIcon,
  invoiceSplitting: SplitIcon,
  ghostVendor: GhostIcon,
};

export default function AuditRules() {
  const [expandedRuleIds, setExpandedRuleIds] = useState(() => new Set());
  const [rules, setRules] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    auditRulesService.list().then(setRules).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Audit rule definitions are unavailable.');
    });
  }, []);

  const toggleRule = (ruleId) => {
    setExpandedRuleIds((current) => toggleExpandedRuleIds(current, ruleId));
  };

  return (
    <div className="page audit-rules-page">
      <div className="page-header audit-rules-page-header">
        <div className="page-header-copy">
          <h1>Audit Rules</h1>
          <p className="page-description">The five controls every payment is checked against. Failed rules raise the risk score.</p>
        </div>
        {rules.length > 0 && <span className="badge badge-neutral">{rules.length} rules active</span>}
      </div>

      {error && <section className="panel"><ErrorState title="Audit rules are unavailable." message={error} /></section>}
      {rules.length === 0 && !error && <section className="panel"><LoadingState message="Loading rule definitions…" /></section>}

      <div className="rules-grid" aria-label="Audit rule definitions">
        {rules.map((rule) => {
          const Icon = iconMap[rule.key];
          const isExpanded = expandedRuleIds.has(rule.id);
          const detailsId = `${rule.id.toLowerCase()}-details`;

          return (
            <article className="panel rule-card" key={rule.id}>
              <div className="rule-card-top">
                <span className="rule-card-icon" aria-hidden="true">
                  <Icon aria-hidden="true" />
                </span>
                <span className="badge badge-low">{rule.status}</span>
              </div>
              <span className="rule-id">{rule.id}</span>
              <h2>{rule.name}</h2>
              <span className="rule-category">{rule.category}</span>
              <p className="rule-description">{rule.description}</p>

              <button
                type="button"
                className="rule-details-toggle"
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                onClick={() => toggleRule(rule.id)}
              >
                {isExpanded ? 'Hide Details' : 'View Details'}
                <span className={`rule-toggle-chevron${isExpanded ? ' is-expanded' : ''}`} aria-hidden="true">
                  ↓
                </span>
              </button>

              <div className="rule-details" id={detailsId} hidden={!isExpanded}>
                <section aria-labelledby={`${rule.id}-fields-heading`}>
                  <h3 id={`${rule.id}-fields-heading`}>Required Fields</h3>
                  <div className="rule-field-list">
                    {rule.requiredFields.map((field) => (
                      <span className="rule-field-chip" key={field}>{field}</span>
                    ))}
                  </div>
                </section>
                <section aria-labelledby={`${rule.id}-evaluation-heading`}>
                  <h3 id={`${rule.id}-evaluation-heading`}>Evaluation</h3>
                  <p>{rule.evaluation}</p>
                </section>
                <section className="rule-configuration" aria-labelledby={`${rule.id}-configuration-heading`}>
                  <h3 id={`${rule.id}-configuration-heading`}>Configuration</h3>
                  <p>{rule.configurationNote}</p>
                </section>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
