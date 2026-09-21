import { auditRules } from '../data/mockData';
import { UsersIcon, LimitIcon, DuplicateIcon, SplitIcon, GhostIcon } from '../components/icons';

const iconMap = {
  segregationOfDuties: UsersIcon,
  approvalLimit: LimitIcon,
  duplicatePayment: DuplicateIcon,
  invoiceSplitting: SplitIcon,
  ghostVendor: GhostIcon,
};

export default function AuditRules() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit Rules</h1>
          <p>Read-only demo definitions. No audit rule engine is connected yet.</p>
        </div>
      </div>

      <div className="rules-grid">
        {auditRules.map((rule) => {
          const Icon = iconMap[rule.key];
          return (
            <div className="card rule-card" key={rule.key}>
              <div className="rule-card-top">
                <span className="rule-card-icon">
                  <Icon />
                </span>
                <span className="demo-pill">{rule.status}</span>
              </div>
              <h3>{rule.label}</h3>
              <p>{rule.description}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
