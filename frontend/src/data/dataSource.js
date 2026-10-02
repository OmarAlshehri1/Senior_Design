import {
  buildDemoRuleResults,
  initialAlerts,
  vendors,
} from './mockData.js';

export const DATA_SOURCE_KIND = Object.freeze({
  FRONTEND_PREVIEW: 'frontend-preview',
  API: 'api',
});

export const currentDataSource = Object.freeze({
  kind: DATA_SOURCE_KIND.API,
  initialTransactions: Object.freeze([]),
  initialAlerts,
  vendors,
  buildRuleResults: buildDemoRuleResults,
});