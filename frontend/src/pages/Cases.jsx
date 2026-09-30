import { useMemo, useState } from 'react';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { CASE_PRIORITIES, CASE_STATUSES, CASES } from '../cases/caseModel.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

export default function Cases() {
  const { can } = useAuthorization();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [priority, setPriority] = useState('ALL');
  const canCreate = can(PERMISSIONS.CREATE_CASE);
  const cases = useMemo(() => CASES.filter((item) => (status === 'ALL' || item.status === status) && (priority === 'ALL' || item.priority === priority) && (!search.trim() || [item.id, item.title, item.vendorName].some((value) => String(value ?? '').toLowerCase().includes(search.toLowerCase())))), [search, status, priority]);
  const metrics = ['Open Cases', 'Investigating', 'Escalated', 'Awaiting Closure'];
  return (
    <div className="operations-page cases-page">
      <div className="page-header"><div><span className="page-eyebrow">Investigations</span><h1>Case Management</h1><p>Coordinate evidence, accountability, resolution, and controlled closure.</p></div><button type="button" className="btn btn-primary" disabled title="Case creation is not available until the service is connected.">{canCreate ? 'Create Case' : 'Create Case — Restricted'}</button></div>
      <section className="operations-summary" aria-label="Case summary">{metrics.map((label) => <article key={label}><span>{label}</span><strong aria-label="Unavailable">—</strong></article>)}</section>
      <section className="operations-card" aria-labelledby="case-queue-heading">
        <div className="operations-card-header"><div><h2 id="case-queue-heading">Case Queue</h2><p>Cases visible within your authorized assignment scope.</p></div><span className="result-count">{cases.length} cases</span></div>
        <div className="operations-toolbar">
          <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search case, vendor, or title" /></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option>{Object.values(CASE_STATUSES).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
          <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="ALL">All priorities</option>{Object.values(CASE_PRIORITIES).map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Case ID</th><th>Title</th><th>Vendor</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>SLA</th><th>Updated</th><th>Actions</th></tr></thead><tbody /></table><ManagementEmptyState title="No cases are available yet." description="Created or assigned investigations will appear here when case management is connected." /></div>
      </section>
    </div>
  );
}
