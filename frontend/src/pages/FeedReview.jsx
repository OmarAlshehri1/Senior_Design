import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.js';
import FeedExceptions from './FeedExceptions.jsx';
import FeedSummary from './FeedSummary.jsx';
import PaymentsModelReview from './PaymentsModelReview.jsx';
import PaymentsModelDiagnostic from './PaymentsModelDiagnostic.jsx';
import useAuthorization from '../auth/useAuthorization.js';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { SelectField } from '../components/ui/Filters.jsx';
import './feedReview.css';

const time = (value) => value ? new Date(value).toLocaleString() : 'Unavailable';

export default function FeedReview() {
  const { effectiveRole } = useAuthorization();
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedEnabled, setFeedEnabled] = useState(false);
  const [exceptions, setExceptions] = useState(false);
  const [summary, setSummary] = useState(false);
  const [modelReview, setModelReview] = useState(false);
  const [modelCapability, setModelCapability] = useState(null);
  const canReviewModel = modelCapability?.enabled && modelCapability.source_id === source;

  useEffect(() => {
    let active = true;
    let timer;
    async function refreshCapability() {
      try {
        const capability = await apiClient.get('/payments-model-review/capabilities');
        if (active) setModelCapability(capability);
      } catch {
        if (active) setModelCapability(null);
      } finally {
        if (active) timer = setTimeout(refreshCapability, 15000);
      }
    }
    refreshCapability();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    apiClient.get('/feed-review/capabilities').then((capability) => {
      if (!active) return { items: [] };
      setFeedEnabled(capability.enabled === true);
      return capability.enabled ? apiClient.get('/feed-review/sources') : { items: [] };
    }).then((response) => {
      if (!active) return;
      setSources(response.items);
      setSource(response.items[0]?.id || '');
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!source) return undefined;
    let active = true;
    let timer;
    setResult(null);
    setLoading(true);
    async function refresh() {
      try {
        const response = await apiClient.get('/feed-review/transactions', {
          query: { source_id: source, page, page_size: 25 },
        });
        if (active) { setResult(response); setError(''); }
      } catch (err) {
        // Clear previously visible rows if permission is revoked or the request fails.
        if (active) { setResult(null); setDetail(null); setError(err.message); }
      } finally {
        if (active) { setLoading(false); timer = setTimeout(refresh, 5000); }
      }
    }
    refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [source, page]);

  useEffect(() => {
    setDetail(null);
    setDetailError('');
    if (!source || !selected) return undefined;
    let active = true;
    apiClient.get(`/feed-review/transactions/${encodeURIComponent(selected)}`, {
      query: { source_id: source },
    }).then((response) => { if (active) setDetail(response); })
      .catch((err) => { if (active) setDetailError(err.message); });
    return () => { active = false; };
  }, [source, selected]);

  if (!loading && !feedEnabled && !error) return <div className="page feed-review-page">
    <PageHeader title="Feed review" /><p>Feed review is not enabled on this backend.</p>
  </div>;

  return <div className="page feed-review-page">
    <PageHeader title="Feed review" />
    <section className="filter-bar feed-review-toolbar" aria-label="Feed review controls">
      <SelectField label="Source" value={source} onChange={(value) => {
        setSource(value); setPage(1); setSelected(null); setDetail(null); setModelReview(false);
      }} options={sources.map((item) => ({ value: item.id, label: `${item.id}${item.active ? '' : ' (inactive)'}` }))} />
      <div className="feed-review-actions">
        <button type="button" className="btn btn-secondary" onClick={() => { setExceptions(!exceptions); setSummary(false); setModelReview(false); setSelected(null); }}>{exceptions ? 'All transactions' : 'Review exceptions'}</button>
        {['ADMIN', 'SUPERVISOR'].includes(effectiveRole) && <button type="button" className="btn btn-secondary" onClick={() => { setSummary(!summary); setExceptions(false); setModelReview(false); setSelected(null); }}>{summary ? 'Back to transactions' : 'Summary report'}</button>}
        {canReviewModel && <button type="button" className="btn btn-secondary" onClick={() => { setModelReview(!modelReview); setExceptions(false); setSummary(false); setSelected(null); }}>{modelReview ? 'Back to transactions' : 'Experimental model review'}</button>}
      </div>
    </section>
    {modelReview && canReviewModel && <PaymentsModelReview />}
    {exceptions && !summary && source && <FeedExceptions key={source} source={source} />}
    {summary && source && <FeedSummary key={source} source={source} />}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading saved results…</p>}
    {!loading && !error && !sources.length && <p>No feed sources are assigned to your account or active team.</p>}
    {!exceptions && !summary && !(modelReview && canReviewModel) && result && <section className="panel" aria-label="Feed transactions">
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Record</th><th>Vendor</th><th>Department / category</th><th>Amount</th><th>Original date</th><th>Arrival</th><th>Processing</th><th>Coverage</th><th>Evidence</th></tr></thead>
        <tbody>{result.items.map((row) => <tr key={row.id}>
          <td data-label="Record">{row.record_id}</td><td data-label="Vendor">{row.vendor_name || 'Unavailable'}</td>
          <td data-label="Department / category">{row.category || 'Uncategorized'}</td>
          <td data-label="Amount">{row.amount ?? 'Unavailable'} {row.currency}</td>
          <td data-label="Original date">{row.source_date || time(row.transaction_timestamp)}</td><td data-label="Arrival">{time(row.received_at)}</td>
          <td data-label="Processing">{row.processing_status || 'Unavailable'}</td>
          <td data-label="Coverage">{row.coverage ? `${row.coverage.evaluated}/${row.coverage.total}` : 'Not evaluated'}</td>
          <td data-label="Evidence"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(row.id)}>Details</button></td>
        </tr>)}</tbody>
      </table></div>
      {!result.items.length && <p>No canonical feed transactions are available on this page.</p>}
      <div className="pagination-bar"><button type="button" className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => { setPage(page - 1); setSelected(null); }}>Previous</button>
        <span> Page {page} · {result.total} records </span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page * 25 >= result.total} onClick={() => { setPage(page + 1); setSelected(null); }}>Next</button></div>
    </section>}
    {selected && <Panel id="feed-evidence-heading" title="Rule evidence" aria-label="Saved rule evidence"
      actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>Close details</button>}>
      {detailError && <p role="alert">{detailError}</p>}
      {!detail && !detailError && <p role="status">Loading evidence…</p>}
      {detail && <>
        <p>Department / category: {detail.category || 'Uncategorized'}</p>
        <p>Invoice: {detail.invoice_number || 'Unavailable'} · Evaluated: {time(detail.evaluated_at)}</p>
        <p>Clock: {detail.time_basis || 'Unavailable'} · Combined risk: {detail.risk_score ?? 'Not scored'} {detail.risk_level}</p>
        <p>AI anomaly score: {detail.ai_score == null ? 'Not scored' : `${detail.ai_score}/100`}</p>
        {detail.ai_score != null && <p>The AI score shows how unusual this payment is compared with its reference history. It is not a probability of fraud.</p>}
        {detail.ai_score != null && detail.risk_score == null && <p>Combined risk is unavailable until all five audit checks can be evaluated.</p>}
        {detail.unscored_reason && <p>Scoring reason: {detail.unscored_reason}</p>}
        {modelCapability?.inline_diagnostics && canReviewModel && <PaymentsModelDiagnostic detail={detail} />}
        <ul>{(detail.rules || []).map((rule) => <li key={rule.rule_key}>
          {rule.rule_key}: <strong>{rule.status}</strong> {rule.detail} {rule.gate_reasons?.join(', ')}
        </li>)}</ul>
      </>}
    </Panel>}
  </div>;
}
