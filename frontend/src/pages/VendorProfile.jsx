import { Link, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '../components/icons.jsx';
import { VENDORS } from '../vendors/vendorModel.js';

export const VENDOR_PROFILE_SECTIONS = Object.freeze([
  'Overview',
  'Transactions',
  'Alerts',
  'Cases',
  'Risk History',
]);

export default function VendorProfile() {
  const { vendorId } = useParams();
  const vendor = VENDORS.find((item) => item.id === vendorId);
  if (!vendor) return <div className="card operational-not-found"><span className="page-eyebrow">Vendor lookup</span><h1>Vendor profile unavailable.</h1><p>No authoritative vendor profile is available with ID “{vendorId}”.</p><Link className="btn btn-primary" to="/vendors"><ArrowLeftIcon width={15} height={15} />Back to Vendor Monitoring</Link></div>;
  const metrics = [['Transactions', vendor.transactionCount], ['Total Transaction Value', vendor.totalTransactionValue], ['Active Alerts', vendor.activeAlerts], ['Open Cases', vendor.openCases], ['Rule Violations', vendor.ruleViolations]];
  return <div className="operations-page vendor-profile-page"><Link className="detail-back-link" to="/vendors"><ArrowLeftIcon width={15} height={15} />Back to Vendor Monitoring</Link><header className="operational-detail-header"><div><span className="page-eyebrow">Vendor Risk Profile</span><h1>{vendor.name}</h1><p>Vendor ID {vendor.id}</p></div><span className="workflow-status">{vendor.monitoringStatus}</span></header><section className="operations-summary">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}</section><section className="operations-card"><div className="operations-tabs" aria-label="Vendor profile sections unavailable">{VENDOR_PROFILE_SECTIONS.map((label) => <button key={label} type="button" disabled title="Vendor profile sections are unavailable until vendor monitoring is connected.">{label}</button>)}</div><div className="chart-empty-state" role="status"><div className="chart-empty-visual" aria-hidden="true"><i /><i /><i /><i /></div><h2>Vendor risk data is not available yet.</h2><p>Risk history and related audit records will appear after authoritative vendor analytics are connected.</p></div></section></div>;
}
