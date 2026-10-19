import { apiClient } from './apiClient.js';

export function businessReportRequest({ day = '', recipient, sender, dataContext = 'UNVERIFIED', useGemini } = {}) {
  const request = { data_context: dataContext };
  if (typeof useGemini === 'boolean') request.use_gemini = useGemini;
  if (recipient?.trim()) request.recipient = recipient.trim();
  if (sender?.trim()) request.sender = sender.trim();
  if (day) {
    const start = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== day) {
      throw new TypeError('Select a valid UTC day.');
    }
    request.period_start = start.toISOString();
    request.period_end = new Date(start.getTime() + 86400000).toISOString();
  }
  return request;
}

export function createBusinessReportsService(client = apiClient) {
  const path = (id) => {
    if (!id) throw new TypeError('Select a business report.');
    return `/reports/business/${encodeURIComponent(id)}`;
  };
  return Object.freeze({
    list: (options = {}) => client.get('/reports/business', options),
    create: (input, options = {}) => client.post('/reports/business', businessReportRequest(input), options),
    get: (id, options = {}) => client.get(path(id), options),
    download: (id, format = 'html', options = {}) => {
      if (!['html', 'xlsx'].includes(format)) throw new TypeError('Unsupported report format.');
      return client.getFile(`${path(id)}/download`, { ...options, query: { format } });
    },
  });
}

export const businessReportsService = createBusinessReportsService();
