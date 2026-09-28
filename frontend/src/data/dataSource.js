import {
  buildDemoRuleResults,
  initialAlerts,
  initialTransactions,
  vendors,
} from './mockData.js';

export const DATA_SOURCE_KIND = Object.freeze({
  FRONTEND_PREVIEW: 'frontend-preview',
  API: 'api',
});

// This remains the active source until API activation is explicitly implemented.
// Keeping the boundary here localizes the future source swap without changing pages.
export const currentDataSource = Object.freeze({
  kind: DATA_SOURCE_KIND.FRONTEND_PREVIEW,
  initialTransactions,
  initialAlerts,
  vendors,
  buildRuleResults: buildDemoRuleResults,
});
