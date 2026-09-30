import ManagementEmptyState from './ManagementEmptyState.jsx';

export default function CaseEvidencePanel({ evidence = [], canAdd = false }) {
  return (
    <section className="workflow-panel" aria-labelledby="case-evidence-heading">
      <div className="workflow-panel-header"><div><h2 id="case-evidence-heading">Evidence Attachments</h2><p>Documents and records supporting the investigation.</p></div>{canAdd && <button type="button" className="btn btn-secondary" disabled title="Evidence upload is not available yet.">Add Evidence</button>}</div>
      <label className="evidence-input-preview"><span>Evidence file</span><input type="file" disabled aria-describedby="evidence-help" /><small id="evidence-help">Upload becomes available after server-side file validation and malware scanning are connected.</small></label>
      {evidence.length === 0 ? <ManagementEmptyState title="No evidence has been attached." description="Validated attachment metadata will appear here; files are not stored locally." /> : null}
    </section>
  );
}
