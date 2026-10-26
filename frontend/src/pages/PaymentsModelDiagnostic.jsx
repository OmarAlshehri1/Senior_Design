import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.js';

// A separate precomputed Validation diagnostic, never the official saved AI score.
export default function PaymentsModelDiagnostic({ detail }) {
  const [item, setItem] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setItem(null);
    apiClient.get('/payments-model-review', { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      const match = data.items.find((row) => row.record_id === detail.record_id);
      // Never attach a score to a reused ID with different model inputs.
      if (match && match.source.AMOUNT === detail.amount && match.source['VENDOR NAME'] === detail.vendor_name
          && match.source['VOUCHER NUMBER'] === detail.invoice_number) setItem(match);
    }).catch(() => { if (!controller.signal.aborted) setItem(null); });
    return () => controller.abort();
  }, [detail.record_id, detail.amount, detail.vendor_name, detail.invoice_number]);
  if (!item) return null;
  return <aside aria-label="Separate experimental model diagnostic">
    <h3>Experimental Validation diagnostic</h3>
    <p>Raw Anomaly Score: <strong>{item.raw_anomaly_score.toFixed(6)}</strong> · {item.model_nominated ? 'Nominated for investigation review' : 'Not nominated'}</p>
    <p>Exact-name Fit payments: {item.fit_context.count} · Fit median: {item.fit_context.median == null ? 'Unavailable' : `${Number(item.fit_context.median).toLocaleString('en-US')} USD`}</p>
    <p>Precomputed no-calendar model output matched by source record, amount, name and voucher. Separate from the saved rule results and Combined Risk; not a fraud probability.</p>
  </aside>;
}
