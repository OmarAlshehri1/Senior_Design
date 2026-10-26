import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.js';
import { modelReviewSummary } from './paymentsModelReviewSummary.js';

const money = (value) => value == null ? 'No Fit history' : `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

function ReviewForm({ item, onSave, saving }) {
  const [outcome, setOutcome] = useState(item.review.outcome || '');
  const [note, setNote] = useState(item.review.note || '');
  return <form onSubmit={(event) => { event.preventDefault(); onSave({ outcome, note, expected_version: item.review.version }); }}>
    <label>Needs investigation?<select required value={outcome} disabled={saving} onChange={(event) => setOutcome(event.target.value)}>
      <option value="">Choose an assessment</option><option value="YES">Yes</option><option value="NO">No</option>
      <option value="INSUFFICIENT_INFORMATION">Insufficient information</option>
    </select></label>
    <label>Reason<textarea required maxLength={2000} value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} /></label>
    <button type="submit" disabled={saving || !outcome || !note.trim()}>{saving ? 'Saving…' : 'Save my review'}</button>
  </form>;
}

export default function PaymentsModelReview() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setMessage(''); setLoading(true);
    apiClient.get(`/payments-model-review?page=${page}&page_size=25`, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) { setData(response); setSelected((previous) => response.items.some((row) => row.case_id === previous) ? previous : (response.items[0]?.case_id || '')); }
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err.code === 'MODEL_REVIEW_DISABLED' ? 'This pilot is not enabled on the current backend.' : err.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, page]);
  const item = data?.items.find((row) => row.case_id === selected);
  const summary = data ? modelReviewSummary(data) : null;
  async function save(body) {
    setSaving(true); setError(''); setMessage('');
    try {
      await apiClient.post(`/payments-model-review/${encodeURIComponent(item.case_id)}`, body);
      const refreshed = await apiClient.get(`/payments-model-review?page=${page}&page_size=25`);
      setData(refreshed);
      setMessage('Your review was saved. This does not change audit outcomes or Combined Risk.');
    } catch (err) {
      setError(err.code === 'REVIEW_VERSION_CONFLICT' ? 'This review changed in another tab. Reload the sample before saving again.' : err.message);
      if ([401, 403].includes(err.status)) setData(null);
    } finally { setSaving(false); }
  }
  return <section aria-label="Experimental anomaly review">
    <h2>Experimental anomaly review</h2>
    <p>Historical Validation sample · No-calendar model · Combined Risk is not scored.</p>
    <p>30 model-nominated and 30 non-nominated payments. Scores indicate unusual patterns, not fraud probability. Assess whether investigation is useful.</p>
    <p>Your assessment is saved under your signed-in account on this staging backend. This source-scoped pilot is separate from team exception reviews.</p>
    <button type="button" disabled={saving || loading} onClick={() => setReload((value) => value + 1)}>Reload sample</button>
    {loading && <p role="status">Loading Validation sample…</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {data && <>
      <div aria-label="Review pagination">
        <button type="button" disabled={saving || page === 1} onClick={() => setPage((value) => value - 1)}>Previous page</button>
        <span> Page {page} </span>
        <button type="button" disabled={saving || page * data.page_size >= data.total} onClick={() => setPage((value) => value + 1)}>Next page</button>
      </div>
      <h3>My Review Summary</h3>
      <p>{summary.reviewed} / {summary.total} reviewed by you. Pending cases are not counted as No.</p>
      {!summary.reviewed && <p>No assessments saved yet. No model-quality conclusion is available.</p>}
      <div className="table-container"><table aria-label="My review summary">
        <thead><tr><th>Sample group</th><th>Needs investigation: Yes</th><th>No</th><th>Insufficient information</th><th>Pending</th><th>Total</th></tr></thead>
        <tbody>{summary.groups.map((group) => <tr key={String(group.nominated)}>
          <td>{group.nominated ? 'Model nominated' : 'Not nominated'}</td><td>{group.yes}</td><td>{group.no}</td>
          <td>{group.insufficient}</td><td>{group.pending}</td><td>{group.total}</td>
        </tr>)}</tbody>
      </table></div>
      <p>These are your current investigation-usefulness assessments, not fraud labels or model accuracy. This balanced 30/30 sample does not represent population prevalence.</p>
      <label>Payment<select value={selected} disabled={saving} onChange={(event) => { setSelected(event.target.value); setMessage(''); setError(''); }}>
        {data.items.map((row) => <option key={row.case_id} value={row.case_id}>{row.case_id} — {row.source['VENDOR NAME']} {row.review.version ? '(reviewed)' : ''}</option>)}
      </select></label>
    </>}
    {item && <>
      <h3>{item.case_id}: {item.source['VENDOR NAME']}</h3>
      <p>Source record: {item.record_id} · Original date (MM/DD/YYYY): {item.source['CHECK DATE']}</p>
      <dl>
        <div><dt>Payment amount</dt><dd>{money(item.source.AMOUNT)}</dd></div>
        <div><dt>Raw Anomaly Score</dt><dd>{item.raw_anomaly_score.toFixed(6)}</dd></div>
        <div><dt>Model nomination</dt><dd>{item.model_nominated ? 'Nominated for review' : 'Not nominated'}</dd></div>
        <div><dt>Fit payments for same name</dt><dd>{item.fit_context.count}</dd></div>
        <div><dt>Fit median payment</dt><dd>{money(item.fit_context.median)}</dd></div>
        <div><dt>Amount / Fit median</dt><dd>{item.fit_context.amount_to_median == null ? 'Unavailable' : `${item.fit_context.amount_to_median.toLocaleString('en-US', { maximumFractionDigits: 4 })}×`}</dd></div>
      </dl>
      <p>Fit minimum: {money(item.fit_context.minimum)} · Fit maximum: {money(item.fit_context.maximum)}</p>
      <p>Voucher: {item.source['VOUCHER NUMBER'] || 'Missing'} · Department: {item.source['DEPARTMENT NAME'] || 'Missing'} · Contract: {item.source['CONTRACT NUMBER'] || 'Missing'}</p>
      <p>Comparison uses the exact source display name, not verified supplier identity. Fit statistics cover the earlier Fit period; invoices and contracts may be needed to explain differences.</p>
      <h3>Latest available Fit examples (up to five)</h3>
      {item.fit_examples.length ? <div className="table-container"><table>
        <thead><tr><th>Source record</th><th>Original date (MM/DD/YYYY)</th><th>Amount</th><th>Voucher</th></tr></thead>
        <tbody>{item.fit_examples.map((row) => <tr key={row.record_id}><td>{row.record_id}</td><td>{row.source['CHECK DATE']}</td><td>{money(row.source.AMOUNT)}</td><td>{row.source['VOUCHER NUMBER'] || 'Missing'}</td></tr>)}</tbody>
      </table></div> : <p>No exact-name Fit history is available. This does not mean the vendor is unregistered.</p>}
      <ReviewForm key={`${item.case_id}-${item.review.version}`} item={item} onSave={save} saving={saving} />
      {item.review.updated_at && <p>Last saved: {new Date(item.review.updated_at).toLocaleString()} · Version {item.review.version}</p>}
    </>}
  </section>;
}
