const productionHosts = new Set(['senior-design-1ypl.onrender.com', 'senior-design-gold.vercel.app']);

export function validatePaymentsStaging(source) {
  if (source.VITE_PAYMENTS_DEPLOYMENT_ENV !== 'staging') return;
  const api = new URL(source.VITE_API_BASE_URL);
  const ws = new URL(source.VITE_WS_URL);
  if (api.protocol !== 'https:' || ws.protocol !== 'wss:' || api.host !== ws.host
      || !api.hostname.includes('.') || api.hostname === '127.0.0.1'
      || productionHosts.has(api.hostname) || api.username || api.password || ws.username || ws.password
      || api.pathname !== '/api/v1' || ws.pathname !== '/ws/alerts'
      || api.search || api.hash || ws.search || ws.hash) {
    throw new Error('Payments Staging requires matching HTTPS/WSS Staging backend URLs.');
  }
}
