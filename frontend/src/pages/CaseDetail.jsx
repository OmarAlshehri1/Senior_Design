import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CASES, CASE_STATUS_META } from '../cases/caseModel.js';
import { getSlaPresentation } from '../cases/caseWorkflow.js';
import CaseEvidencePanel from '../components/CaseEvidencePanel.jsx';
import CaseDiscussion from '../components/CaseDiscussion.jsx';
import CaseActivityTimeline from '../components/CaseActivityTimeline.jsx';
import { ArrowLeftIcon } from '../components/icons.jsx';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';
import CaseClosureDialog from '../components/CaseClosureDialog.jsx';

export default function CaseDetail() {
  const { caseId } = useParams();
  const { can } = useAuthorization();
  const [closureMode, setClosureMode] = useState(null);
  const caseRecord = CASES.find((item) => item.id === caseId);
  if (!caseRecord) return <div className="card operational-not-found"><span className="page-eyebrow">Case lookup</span><h1>Case unavailable.</h1><p>No authorized case is available with ID “{caseId}”. The case service is not connected.</p><Link className="btn btn-primary" to="/cases"><ArrowLeftIcon width={15} height={15} />Back to Cases</Link></div>;
  const status = CASE_STATUS_META[caseRecord.status];
  const sla = getSlaPresentation(caseRecord);
  const canWork = can(PERMISSIONS.UPDATE_ASSIGNED_CASE);
  const canRequestClosure = can(PERMISSIONS.REQUEST_CASE_CLOSURE);
  const canApprove = can(PERMISSIONS.APPROVE_CASE_CLOSURE);
  return <div className="operations-page case-detail-page"><Link className="detail-back-link" to="/cases"><ArrowLeftIcon width={15} height={15} />Back to Cases</Link><header className="operational-detail-header"><div><span className="page-eyebrow">Investigation Case</span><h1>{caseRecord.title ?? caseRecord.id}</h1><p>{caseRecord.description ?? 'No case description is available.'}</p></div><div className="detail-status-stack"><span className={`workflow-status tone-${status.tone}`}>{status.label}</span><span className={`sla-status sla-${sla.tone}`}>{sla.label}</span></div></header><section className="detail-facts" aria-label="Case details">{[['Case ID', caseRecord.id], ['Priority', caseRecord.priority], ['Assigned To', caseRecord.assignedToName], ['Vendor', caseRecord.vendorName], ['Transaction', caseRecord.transactionId], ['Alert', caseRecord.alertId]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</section><div className="workflow-actions" aria-label="Case actions">{canWork && <button className="btn btn-secondary" disabled title="Case updates are unavailable until the service is connected.">Update Status</button>}{canRequestClosure && <button className="btn btn-secondary" onClick={() => setClosureMode('request')}>Request Closure</button>}{canApprove && caseRecord.status === 'RESOLUTION_REQUESTED' && <button className="btn btn-primary" onClick={() => setClosureMode('approve')}>Review Closure</button>}</div><div className="case-detail-grid"><CaseEvidencePanel canAdd={canWork} /><CaseDiscussion canComment={canWork} /><section className="workflow-panel case-activity-panel" aria-labelledby="case-activity-heading"><h2 id="case-activity-heading">Case Activity</h2><p>Authoritative assignment, status, evidence, discussion, escalation, and closure events.</p><CaseActivityTimeline /></section></div><CaseClosureDialog open={Boolean(closureMode)} mode={closureMode ?? 'request'} caseRecord={caseRecord} onClose={() => setClosureMode(null)} /></div>;
}
