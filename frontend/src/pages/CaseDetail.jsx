import DateTime from '../components/DateTime.jsx';
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
import { Panel } from '../components/ui/Layout.jsx';
import { ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { PRIORITY_TONES, SLA_TONES, titleCase, WORKFLOW_TONES } from '../components/statusUtils.js';
import { caseReference, shortReference } from '../utils/presentation.js';

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
  if (error && !bundle) return <div className="page detail-state-page"><section className="panel"><ErrorState title="Case unavailable." message={error} onRetry={reload} />
    <div className="detail-state-actions"><Link className="btn btn-ghost btn-sm" to="/cases"><ArrowLeftIcon width={15} height={15} />Back to Cases</Link></div></section></div>;
  if (!bundle) return <div className="page detail-state-page"><section className="panel"><LoadingState message="Loading case…" /></section></div>;
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
  const canAssign = can(PERMISSIONS.ASSIGN_CASE) && caseRecord.status !== 'CLOSED';
  const showRequestClosure = canRequestClosure && effectiveRole === 'AUDITOR' && caseRecord.status === 'RESOLVED';
  const showReviewClosure = canApprove && caseRecord.status === 'RESOLUTION_REQUESTED';
  const hasActions = (canWork && statusOptions.length > 0) || canAssign || showRequestClosure || showReviewClosure;
  return <div className="page case-detail-page">
    <header className="detail-header">
      <Link className="back-link" to="/cases"><ArrowLeftIcon width={15} height={15} aria-hidden="true" />Cases</Link>
      <div className="detail-header-main">
        <div className="detail-header-copy">
          <p className="page-eyebrow" title={caseRecord.reference ?? caseRecord.id}>{caseReference(caseRecord.reference ?? caseRecord.id)}</p>
          <h1>{caseRecord.title}</h1>
          <div className="detail-title-row">
            <span className={`badge badge-${WORKFLOW_TONES[caseStatus?.tone] ?? 'neutral'}`}>{caseStatus?.label ?? caseRecord.status}</span>
            <span className={`badge badge-${PRIORITY_TONES[caseRecord.priority] ?? 'neutral'}`}>{titleCase(caseRecord.priority)} priority</span>
            <span className={`sla-text tone-${SLA_TONES[sla.tone] ?? 'neutral'}`}>{sla.label}</span>
          </div>
        </div>
        {showReviewClosure && <div className="page-header-actions"><button className="btn btn-primary" onClick={() => setClosureMode('approve')}>Review Closure</button></div>}
        {showRequestClosure && <div className="page-header-actions"><button className="btn btn-primary" disabled={busy} onClick={() => setClosureMode('request')}>Request Closure</button></div>}
      </div>
    </header>
    {error && <p role="alert" className="inline-alert">{error}</p>}
    <section className="panel detail-summary" aria-label="Case details">
      <dl className="transaction-info-grid">{[
        ['Assignee', caseRecord.assignedToName],
        ['Department', caseRecord.department],
        ['Source alert', caseRecord.alertId && <span className="reference-text" title={caseRecord.alertId}>{shortReference(caseRecord.alertId)}</span>],
        ['Transaction', caseRecord.transactionId && <Link className="reference-text" title={caseRecord.transactionId} to={`/transactions/${encodeURIComponent(caseRecord.transactionId)}`}>{shortReference(caseRecord.transactionId)}</Link>],
        ['SLA due', <DateTime value={caseRecord.slaDueAt} />],
      ].map(([label, value]) => <div className="transaction-info-item" key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl>
    </section>
    <div className="detail-layout">
      <div className="detail-main">
        <Panel id="case-summary-heading" title="Summary"><p className="case-description">{caseRecord.description || 'No description recorded.'}</p></Panel>
        <CaseDiscussion comments={comments} canComment={canWork && caseRecord.status !== 'CLOSED'} busy={busy} onSubmit={(message) => perform(() => casesService.addCaseComment(caseId, message))} />
        <CaseEvidencePanel evidence={evidence} canAdd={canWork && caseRecord.status !== 'CLOSED'} enabled={evidenceEnabled} onUpload={(file, category, description) => perform(() => casesService.addCaseEvidence(caseId, file, { category, description }))} onDownload={(evidenceId) => casesService.getCaseEvidence(caseId, evidenceId)} onScan={(evidenceId) => perform(() => casesService.rescanCaseEvidence(caseId, evidenceId))} />
        <Panel id="case-activity-heading" title="Activity" description="Assignment, status, evidence, discussion and closure events."><CaseActivityTimeline events={activity} /></Panel>
      </div>
      <aside className="detail-side" aria-label="Case actions">
        {hasActions && <Panel id="case-actions-heading" title="Workflow">
          <div className="workflow-stack">
            {canWork && statusOptions.length > 0 && <form onSubmit={(event) => { event.preventDefault(); perform(() => casesService.updateCaseStatus(caseId, selectedStatus, statusNote || null)); }} className="workflow-form">
              <label className="field"><span className="field-label">Move to</span><select value={selectedStatus} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map((value) => <option key={value} value={value}>{CASE_STATUS_META[value]?.label ?? titleCase(value)}</option>)}</select></label>
              <label className="field"><span className="field-label">Note (optional)</span><input value={statusNote} maxLength={2000} onChange={(event) => setStatusNote(event.target.value)} /></label>
              <button className="btn btn-secondary btn-sm" disabled={busy}>Save status</button>
            </form>}
            {canAssign && <label className="field"><span className="field-label">Assignee</span><select defaultValue={caseRecord.assignedToId ?? ''} disabled={busy} onChange={(event) => event.target.value && perform(() => casesService.assignCase(caseId, event.target.value))}><option value="">Select assignee</option>{eligibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name} ({titleCase(user.role)})</option>)}</select></label>}
          </div>
        </Panel>}
        <Panel id="case-assignment-heading" title="Assignment history">{assignmentHistory.length ? <ol className="timeline">{assignmentHistory.map((item, index) => <li key={item.id ?? index}><strong>Assigned to {item.assigneeName ?? item.assigneeId ?? 'unassigned'}</strong><span className="timeline-meta">{item.actorName ?? 'Team member'}{item.previousAssigneeName ? ` · from ${item.previousAssigneeName}` : ''} · <DateTime value={item.createdAt} /></span></li>)}</ol> : <p className="muted">No assignment changes recorded.</p>}</Panel>
      </aside>
    </div>
    <CaseClosureDialog open={Boolean(closureMode)} mode={closureMode ?? 'request'} caseRecord={caseRecord} busy={busy} error={error} onClose={() => setClosureMode(null)} onSubmit={(input) => perform(async () => { if (closureMode === 'request') await casesService.requestCaseClosure(caseId, input); else await casesService.decideCaseClosure(caseId, input.approve, input.note); setClosureMode(null); })} />
  </div>;
}
