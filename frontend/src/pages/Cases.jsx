import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { CASE_PRIORITIES, CASE_STATUS_META, CASE_STATUSES } from '../cases/caseModel.js';
import { getSlaPresentation } from '../cases/caseWorkflow.js';
import { casesService } from '../services/casesService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

export default function Cases() {
  const { can } = useAuthorization();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [priority, setPriority] = useState('ALL');
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      casesService.listCases({ query: {
        page: 1, page_size: 100,
        status: status === 'ALL' ? null : status,
        priority: priority === 'ALL' ? null : priority,
        search: search.trim() || null,
      } }).then((value) => {
        if (active) setResult(value);
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Cases could not be loaded.');
      }).finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [search, status, priority]);

  return (
    <div className="operations-page cases-page">
      <div className="page-header">
        <div><span className="page-eyebrow">Investigations</span><h1>Case Management</h1><p>Coordinate evidence, accountability, resolution, and controlled closure.</p></div>
        {can(PERMISSIONS.CREATE_CASE) && <Link className="btn btn-primary" to="/alerts">Create Case from Alert</Link>}
      </div>
      <section className="operations-card" aria-labelledby="case-queue-heading">
        <div className="operations-card-header"><div><h2 id="case-queue-heading">Case Queue</h2><p>Cases visible within your authorized assignment scope.</p></div><span className="result-count">{result.total} cases</span></div>
        <div className="operations-toolbar">
          <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reference, title, alert, or transaction" /></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option>{Object.values(CASE_STATUSES).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
          <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="ALL">All priorities</option>{Object.values(CASE_PRIORITIES).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        {loading ? <div className="request-state" role="status">Loading cases…</div>
          : error ? <div className="request-state request-state-error" role="alert"><h3>Cases could not be loaded.</h3><p>{error}</p></div>
            : result.items.length === 0 ? <ManagementEmptyState title="No cases match this view." description="Cases are created only from an explicit Alert or Transaction review action." />
              : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Case ID</th><th>Title</th><th>Source</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>SLA</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
                {result.items.map((item) => {
                  const caseStatus = CASE_STATUS_META[item.status];
                  const sla = getSlaPresentation({ slaStatus: item.slaStatus, slaDueAt: item.slaDueAt, completedAt: item.completedAt });
                  return <tr key={item.id}>
                    <td>{item.reference ?? item.id}</td><td>{item.title}</td>
                    <td>{item.alertId ?? item.transactionId ?? '—'}</td><td>{item.priority}</td>
                    <td><span className={`workflow-status tone-${caseStatus?.tone ?? 'neutral'}`}>{caseStatus?.label ?? item.status}</span></td>
                    <td>{item.assignedToName ?? '—'}</td><td><span className={`sla-status sla-${sla.tone}`}>{sla.label}</span></td>
                    <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}</td>
                    <td><Link className="btn btn-secondary" to={`/cases/${encodeURIComponent(item.id)}`}>Open</Link></td>
                  </tr>;
                })}
              </tbody></table></div>}
      </section>
    </div>
  );
}
