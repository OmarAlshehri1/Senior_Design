import { getRiskLevel } from '../utils/risk.js';
import { sortNewestFirst } from '../utils/transactions.js';

// Frontend-only fixtures. No audit engine or machine-learning model runs here.
export const vendors = [
  { name: 'Riyadh Wholesale Trading', category: 'Inventory' },
  { name: 'Gulf Packaging Co.', category: 'Packaging' },
  { name: 'Al Noor Supplies', category: 'Store Supplies' },
  { name: 'Eastern Distribution Co.', category: 'Inventory' },
  { name: 'Nesma Logistics', category: 'Logistics' },
  { name: 'Al Zamil Store Fixtures', category: 'Equipment' },
  { name: 'Jeddah Fresh Foods', category: 'Inventory' },
  { name: 'Tabuk Cleaning Supplies', category: 'Store Supplies' },
  { name: 'Dammam Electrical Co.', category: 'Maintenance' },
  { name: 'Al Khobar IT Services', category: 'Technology' },
  { name: 'Makkah Textiles Ltd.', category: 'Inventory' },
  { name: 'Qassim Transport Co.', category: 'Logistics' },
];

const ruleDefs = [
  {
    key: 'duplicatePayment',
    label: 'Duplicate Payment',
    description: 'Detects payments made to the same vendor for the same amount within a short time window.',
    passedDetail: 'No matching payment was identified for the same vendor and amount.',
    failedDetail: 'Possible duplicate payment found for the same vendor and amount.',
  },
  {
    key: 'approvalLimit',
    label: 'Approval Limit',
    description: 'Flags transactions that exceed the predefined approval limit for their category.',
    passedDetail: 'The amount is within the configured approval limits.',
    failedDetail: 'The amount may exceed the configured approval limits.',
  },
  {
    key: 'invoiceSplitting',
    label: 'Invoice Splitting',
    description: 'Detects multiple smaller invoices used to avoid an approval threshold.',
    passedDetail: 'No related invoice-splitting pattern was identified.',
    failedDetail: 'Related purchases may indicate an invoice-splitting pattern.',
  },
  {
    key: 'ghostVendor',
    label: 'Ghost Vendor',
    description: 'Flags payments to vendors with no verifiable registration or transaction history.',
    passedDetail: 'The vendor is present in the registered vendor list.',
    failedDetail: 'The vendor could not be verified against the registered vendor list.',
  },
  {
    key: 'segregationOfDuties',
    label: 'Segregation of Duties',
    description: 'Flags cases where the same person requested and approved a transaction.',
    passedDetail: 'Requester and approver are recorded as different users.',
    failedDetail: 'Requester and approver appear to be the same user.',
  },
];

export const auditRules = ruleDefs.map((rule) => ({
  key: rule.key,
  label: rule.label,
  description: rule.description,
  status: 'Demo Only',
}));

export function buildDemoRuleResults(failedRule = null) {
  return Object.fromEntries(
    ruleDefs.map((rule) => [
      rule.key,
      {
        status: rule.key === failedRule ? 'Failed' : 'Passed',
        detail: rule.key === failedRule ? rule.failedDetail : rule.passedDetail,
      },
    ])
  );
}

const fixtureDate = 'August 30, 2026';

const riskExplanations = {
  duplicatePayment: 'The recorded risk score is supported by a possible duplicate payment and elevated transaction signals.',
  approvalLimit: 'The recorded risk score reflects an approval-limit exception that requires auditor review.',
  invoiceSplitting: 'The recorded risk score reflects a possible invoice-splitting pattern across related purchases.',
  ghostVendor: 'The recorded risk score reflects vendor-verification concerns that require auditor review.',
  segregationOfDuties: 'The recorded risk score reflects a segregation-of-duties exception involving the requester and approver.',
};

function fixtureTimestamp(time) {
  return `2026-08-30T${time}:00+03:00`;
}

// Scores are manually curated display fixtures. React does not calculate the final score.
const transactionFixtures = [
  {
    id: 'TX-10482', vendor: 'Riyadh Wholesale Trading', category: 'Inventory', amount: 2450,
    time: '14:32', ruleScore: 22, aiScore: 12, riskScore: 18,
  },
  {
    id: 'TX-10481', vendor: 'Gulf Packaging Co.', category: 'Packaging', amount: 1180,
    time: '14:28', ruleScore: 27, aiScore: 20, riskScore: 24,
  },
  {
    id: 'TX-10480', vendor: 'Al Noor Supplies', category: 'Store Supplies', amount: 7850,
    time: '14:21', ruleScore: 66, aiScore: 54, riskScore: 61, failedRule: 'invoiceSplitting',
    alert: {
      id: 'AL-3',
      title: 'Invoice Splitting Detected',
      description: 'Possible invoice splitting detected across related purchases.',
      status: 'Active',
      reason: 'Invoice Splitting is marked Failed in this simulated transaction.',
    },
  },
  {
    id: 'TX-10479', vendor: 'Eastern Distribution Co.', category: 'Inventory', amount: 3250,
    time: '14:18', ruleScore: 23, aiScore: 15, riskScore: 20,
  },
  {
    id: 'TX-10478', vendor: 'Nesma Logistics', category: 'Logistics', amount: 950,
    time: '14:12', ruleScore: 25, aiScore: 18, riskScore: 22,
  },
  {
    id: 'TX-10477', vendor: 'Al Zamil Store Fixtures', category: 'Equipment', amount: 6450,
    time: '14:05', ruleScore: 65, aiScore: 47, riskScore: 58, failedRule: 'approvalLimit',
    alert: {
      id: 'AL-2',
      title: 'Approval Limit Exception',
      description: 'Transaction may exceed the configured approval limit.',
      status: 'Active',
      reason: 'Approval Limit is marked Failed in this simulated transaction.',
    },
  },
  {
    id: 'TX-10476', vendor: 'Riyadh Wholesale Trading', category: 'Inventory', amount: 1750,
    time: '13:58', ruleScore: 19, aiScore: 11, riskScore: 16,
  },
  {
    id: 'TX-10475', vendor: 'Gulf Packaging Co.', category: 'Packaging', amount: 680,
    time: '13:51', ruleScore: 23, aiScore: 13, riskScore: 19,
  },
  {
    id: 'TX-10474', vendor: 'Jeddah Fresh Foods', category: 'Inventory', amount: 4120,
    time: '13:44', ruleScore: 30, aiScore: 22, riskScore: 27,
  },
  {
    id: 'TX-10473', vendor: 'Tabuk Cleaning Supplies', category: 'Store Supplies', amount: 540,
    time: '13:37', ruleScore: 17, aiScore: 9, riskScore: 14,
  },
  {
    id: 'TX-10472', vendor: 'Dammam Electrical Co.', category: 'Maintenance', amount: 8900,
    time: '13:29', ruleScore: 70, aiScore: 58, riskScore: 65, failedRule: 'segregationOfDuties',
    alert: {
      id: 'AL-5',
      title: 'Segregation of Duties Violation',
      description: 'Requester and approver appear to be the same user.',
      status: 'Reviewed',
      reason: 'Segregation of Duties is marked Failed in this simulated transaction.',
    },
  },
  {
    id: 'TX-10471', vendor: 'Al Khobar IT Services', category: 'Technology', amount: 12500,
    time: '13:20', ruleScore: 38, aiScore: 31, riskScore: 35,
  },
  {
    id: 'TX-10470', vendor: 'Makkah Textiles Ltd.', category: 'Inventory', amount: 3690,
    time: '13:12', ruleScore: 26, aiScore: 19, riskScore: 23,
  },
  {
    id: 'TX-10469', vendor: 'Qassim Transport Co.', category: 'Logistics', amount: 1420,
    time: '13:05', ruleScore: 21, aiScore: 14, riskScore: 18,
  },
  {
    id: 'TX-10468', vendor: 'Riyadh Wholesale Trading', category: 'Inventory', amount: 15800,
    time: '12:58', ruleScore: 83, aiScore: 71, riskScore: 78, failedRule: 'duplicatePayment',
    alert: {
      id: 'AL-6',
      title: 'Duplicate Payment Detected',
      description: 'Possible duplicate payment detected for the same vendor and amount.',
      status: 'Active',
      reason: 'Duplicate Payment is marked Failed and the transaction is High Risk.',
    },
  },
  {
    id: 'TX-10467', vendor: 'Eastern Distribution Co.', category: 'Inventory', amount: 2980,
    time: '12:50', ruleScore: 24, aiScore: 17, riskScore: 21,
  },
  {
    id: 'TX-10466', vendor: 'Gulf Packaging Co.', category: 'Packaging', amount: 760,
    time: '12:42', ruleScore: 18, aiScore: 10, riskScore: 15,
  },
  {
    id: 'TX-10465', vendor: 'Al Noor Supplies', category: 'Store Supplies', amount: 5320,
    time: '12:35', ruleScore: 33, aiScore: 26, riskScore: 30,
  },
  {
    id: 'TX-10464', vendor: 'Nesma Logistics', category: 'Logistics', amount: 1080,
    time: '12:27', ruleScore: 23, aiScore: 16, riskScore: 20,
  },
  {
    id: 'TX-10463', vendor: 'Al Zamil Store Fixtures', category: 'Equipment', amount: 9450,
    time: '12:19', ruleScore: 73, aiScore: 63, riskScore: 69, failedRule: 'ghostVendor',
    alert: {
      id: 'AL-4',
      title: 'Ghost Vendor Flagged',
      description: 'Vendor could not be verified against the registered vendor list.',
      status: 'Reviewed',
      reason: 'Ghost Vendor is marked Failed in this simulated transaction.',
    },
  },
  {
    id: 'TX-10462', vendor: 'Dammam Electrical Co.', category: 'Maintenance', amount: 2340,
    time: '12:11', ruleScore: 28, aiScore: 21, riskScore: 25,
  },
  {
    id: 'TX-10461', vendor: 'Jeddah Fresh Foods', category: 'Inventory', amount: 6780,
    time: '12:03', ruleScore: 36, aiScore: 29, riskScore: 33,
  },
  {
    id: 'TX-10460', vendor: 'Makkah Textiles Ltd.', category: 'Inventory', amount: 1990,
    time: '11:55', ruleScore: 20, aiScore: 13, riskScore: 17,
  },
  {
    id: 'TX-10496', vendor: 'Riyadh Wholesale Trading', category: 'Inventory', amount: 18750,
    time: '14:42', ruleScore: 90, aiScore: 80, riskScore: 86, failedRule: 'duplicatePayment',
    alert: {
      id: 'AL-1',
      title: 'Duplicate Payment Detected',
      description: 'Possible duplicate payment detected for the same vendor and amount.',
      status: 'Active',
      reason: 'Duplicate Payment is marked Failed and the transaction is High Risk.',
    },
  },
];

function toFullTransaction({ failedRule = null, alert: _alert = null, ...transaction }) {
  return {
    ...transaction,
    timestamp: fixtureTimestamp(transaction.time),
    date: fixtureDate,
    currency: 'SAR',
    ruleStatus: failedRule ? 'Review' : 'Passed',
    rules: buildDemoRuleResults(failedRule),
    aiStatus: transaction.aiScore >= 50 ? 'Elevated Anomaly Score' : 'Routine Demo Score',
    aiExplanation: transaction.aiScore >= 50
      ? 'The transaction shows elevated anomaly indicators compared with the current activity baseline.'
      : 'The transaction is broadly consistent with the current activity baseline.',
    riskExplanation: riskExplanations[failedRule]
      || 'No failed audit rules are recorded, and the transaction remains within the recorded low-risk range.',
    dataQuality: { status: 'Complete', missingFields: [] },
  };
}

export const initialTransactions = sortNewestFirst(transactionFixtures.map(toFullTransaction));

export const initialAlerts = sortNewestFirst(
  transactionFixtures
    .filter((transaction) => transaction.alert)
    .map((transaction) => ({
      ...transaction.alert,
      transactionId: transaction.id,
      timestamp: fixtureTimestamp(transaction.time),
      time: transaction.time,
      severity: getRiskLevel(transaction.riskScore).replace(' Risk', ''),
      riskScore: transaction.riskScore,
    }))
);
