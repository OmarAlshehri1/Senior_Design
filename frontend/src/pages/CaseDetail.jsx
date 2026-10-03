import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CASE_STATUS_META } from '../cases/caseModel.js';
import { getSlaPresentation } from '../cases/caseWorkflow.js';
import CaseEvidencePanel from '../components/CaseEvidencePanel.jsx';
import CaseDiscussion from '../components/CaseDiscussion.jsx';
import CaseActivityTimeline from '../components/CaseActivityTimeline.jsx';
import { ArrowLeftIcon } from '../components/icons.jsx';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';
import CaseClosureDialog from '../components/CaseClosureDialog.jsx';
import { casesService } from '../services/casesService.js';

export default function CaseDetail() {
  const { caseId } = useParams();
  const { can, effectiveRole } = useAuthorization();
  const [bundle, setBundle] = useState(null);
  const [closureMode, setClosureMode] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('INVESTIGATING');
  const [statusNote, setStatusNote] = useState('');

  const reload = useCallback(async () => {
    setError(null);
    try { setBundle(await casesService.getCase(caseId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Case could not be loaded.'); }
  }, [caseId]);
  useEffect(() => { reload(); }, [reload]);

  const perform = async (operation) => {
    setBusy(true); setError(null);
    try { await operation(); await reload(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The case update failed.'); return false; }
    finally { setBusy(false); }
  };
  if (error && !bundle) return <div className="card operational-not-found" role="alert"><h1>Case unavailable.</h1><p>{error}</p><Link className="btn btn-primary" to="/cases"><ArrowLeftIcon width={15} height={15} />Back to Cases</Link></div>;
  if (!bundle) return <div className="request-state" role="status">Loading case…</div>;
  const { caseRecord, activity, comments, evidence, eligibleUsers, assignmentHistory } = bundle;
  const caseStatus = CASE_STATUS_META[caseRecord.status];
  const sla = getSlaPresentation({ slaStatus: caseRecord.slaStatus, slaDueAt: caseRecord.slaDueAt, completedAt: caseRecord.completedAt });
  const canWork = can(PERMISSIONS.UPDATE_ASSIGNED_CASE);
  const canRequestClosure = can(PERMISSIONS.REQUEST_CASE_CLOSURE);
  const canApprove = can(PERMISSIONS.APPROVE_CASE_CLOSURE);
  const statusOptions = effectiveRole === 'AUDITOR'
    ? (['OPEN', 'INVESTIGATING'].includes(caseRecord.status) ? ['INVESTIGATING', 'ESCALATED', 'RESOLVED'] : caseRecord.status === 'ESCALATED' ? ['INVESTIGATING', 'RESOLVED'] : [])
    : caseRecord.status === 'ESCALATED' ? ['INVESTIGATING']
      : ['OPEN', 'INVESTIGATING', 'RESOLVED'].includes(caseRecord.status) ? ['ESCALATED'] : [];
  const selectedStatus = statusOptions.includes(status) ? status : (statusOptions[0] ?? '');
  const evidenceEnabled = Boolean(bundle.capabilities?.evidenceUploadsEnabled);
  return <div className="operations-page case-detail-page">
    <Link className="detail-back-link" to="/cases"><ArrowLeftIcon width={15} height={15} />Back to Cases</Link>
    <header className="operational-detail-header"><div><span className="page-eyebrow">Investigation Case · {caseRecord.reference ?? caseRecord.id}</span><h1>{caseRecord.title}</h1><p>{caseRecord.description}</p></div><div className="detail-status-stack"><span className={`workflow-status tone-${caseStatus?.tone ?? 'neutral'}`}>{caseStatus?.label ?? caseRecord.status}</span><span className={`sla-status sla-${sla.tone}`}>{sla.label}</span></div></header>
    <section className="detail-facts" aria-label="Case details">{[['Priority', caseRecord.priority], ['Assigned To', caseRecord.assignedToName], ['Department', caseRecord.department], ['Transaction', caseRecord.transactionId], ['Alert', caseRecord.alertId], ['SLA Due', caseRecord.slaDueAt ? new Date(caseRecord.slaDueAt).toLocaleString() : '—']].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</section>
    {error && <p role="alert" className="request-state-error">{error}</p>}
    <div className="workflow-actions" aria-label="Case actions">
      {canWork && statusOptions.length > 0 && <form onSubmit={(event) => { event.preventDefault(); perform(() => casesService.updateCaseStatus(caseId, selectedStatus, statusNote || null)); }} className="case-status-form"><label><span>Change status</span><select value={selectedStatus} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label><span>Note (optional)</span><input value={statusNote} maxLength={2000} onChange={(event) => setStatusNote(event.target.value)} /></label><button className="btn btn-secondary" disabled={busy}>Save status</button></form>}
      {can(PERMISSIONS.ASSIGN_CASE) && caseRecord.status !== 'CLOSED' && <label>Assign case<select defaultValue={caseRecord.assignedToId ?? ''} disabled={busy} onChange={(event) => event.target.value && perform(() => casesService.assignCase(caseId, event.target.value))}><option value="">Select assignee</option>{eligibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.role})</option>)}</select></label>}
      {canRequestClosure && effectiveRole === 'AUDITOR' && caseRecord.status === 'RESOLVED' && <button className="btn btn-secondary" disabled={busy} onClick={() => setClosureMode('request')}>Request Closure</button>}
      {canApprove && caseRecord.status === 'RESOLUTION_REQUESTED' && <button className="btn btn-primary" onClick={() => setClosureMode('approve')}>Review Closure</button>}
    </div>
    <div className="case-detail-grid"><CaseEvidencePanel evidence={evidence} canAdd={canWork && caseRecord.status !== 'CLOSED'} enabled={evidenceEnabled} onUpload={(file, category, description) => perform(() => casesService.addCaseEvidence(caseId, file, { category, description }))} onDownload={(evidenceId) => casesService.getCaseEvidence(caseId, evidenceId)} /><CaseDiscussion comments={comments} canComment={canWork && caseRecord.status !== 'CLOSED'} busy={busy} onSubmit={(message) => perform(() => casesService.addCaseComment(caseId, message))} /><section className="workflow-panel case-activity-panel" aria-labelledby="case-activity-heading"><h2 id="case-activity-heading">Case Activity</h2><p>Authoritative assignment, status, evidence, discussion, escalation, and closure events.</p><CaseActivityTimeline events={activity} /></section><section className="workflow-panel"><h2>Assignment History</h2>{assignmentHistory.length ? <ol>{assignmentHistory.map((item, index) => <li key={item.id ?? index}>{item.actorName ?? 'Team member'} assigned to {item.assigneeName ?? item.assigneeId ?? 'unassigned'}{item.previousAssigneeName ? ` (from ${item.previousAssigneeName})` : ''} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</li>)}</ol> : <p>No assignment changes recorded.</p>}</section></div>
    <CaseClosureDialog open={Boolean(closureMode)} mode={closureMode ?? 'request'} caseRecord={caseRecord} busy={busy} error={error} onClose={() => setClosureMode(null)} onSubmit={(input) => perform(async () => { if (closureMode === 'request') await casesService.requestCaseClosure(caseId, input); else await casesService.decideCaseClosure(caseId, input.approve, input.note); setClosureMode(null); })} />
  </div>;
}
