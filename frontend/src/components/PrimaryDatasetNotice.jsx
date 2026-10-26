import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.js';
import './PrimaryDatasetNotice.css';

export default function PrimaryDatasetNotice() {
  const [dataset, setDataset] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    apiClient.get('/system/dataset', { signal: controller.signal })
      .then(setDataset).catch(() => {});
    return () => controller.abort();
  }, []);
  if (!dataset?.enabled || !dataset.simulation_enriched) return null;
  return (
    <aside className="primary-dataset-notice" aria-label="Current dataset">
      <strong>{dataset.label} · {dataset.currency}</strong>
      <p>Payment source data includes simulated actors, approval limits and time of day.
        Rule results use those references. AI scores rank unusual payment patterns and do not indicate fraud probability.</p>
    </aside>
  );
}
