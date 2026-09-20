// Mock data for the Continuous Auditing System frontend prototype.
// All values are simulated — there is no real backend, AI model, or database.

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
  },
  {
    key: 'approvalLimit',
    label: 'Approval Limit',
    description: 'Flags transactions that exceed the predefined approval limit for their category.',
  },
  {
    key: 'invoiceSplitting',
    label: 'Invoice Splitting',
    description: 'Detects multiple smaller invoices used to avoid an approval threshold.',
  },
  {
    key: 'ghostVendor',
    label: 'Ghost Vendor',
    description: 'Flags payments to vendors with no verifiable registration or transaction history.',
  },
  {
    key: 'segregationOfDuties',
    label: 'Segregation of Duties',
    description: 'Flags cases where the same person requested and approved a transaction.',
  },
];

export const auditRules = ruleDefs.map((r) => ({
  ...r,
  status: 'Active',
}));

function riskLevelFromScore(score) {
  if (score >= 61) return 'High Risk';
  if (score >= 31) return 'Medium Risk';
  return 'Low Risk';
}

// Base set of transactions matching the dashboard reference image.
const baseTransactions = [
  { id: 'TX-10482', vendor: 'Riyadh Wholesale Trading', category: 'Inventory', amount: 2450, time: '14:32', ruleStatus: 'Passed', aiScore: 12, riskScore: 18 },
  { id: 'TX-10481', vendor: 'Gulf Packaging Co.', category: 'Packaging', amount: 1180, time: '14:28', ruleStatus: 'Passed', aiScore: 20, riskScore: 24 },
  { id: 'TX-10480', vendor: 'Al Noor Supplies', category: 'Store Supplies', amount: 7850, time: '14:21', ruleStatus: 'Review', aiScore: 54, riskScore: 61 },
  { id: 'TX-10479', vendor: 'Eastern Distribution Co.', category: 'Inventory', amount: 3250, time: '14:18', ruleStatus: 'Passed', aiScore: 15, riskScore: 20 },
  { id: 'TX-10478', vendor: 'Nesma Logistics', category: 'Logistics', amount: 950, time: '14:12', ruleStatus: 'Passed', aiScore: 18, riskScore: 22 },
  { id: 'TX-10477', vendor: 'Al Zamil Store Fixtures', category: 'Equipment', amount: 6450, time: '14:05', ruleStatus: 'Review', aiScore: 47, riskScore: 58 },
  { id: 'TX-10476', vendor: 'Riyadh Wholesale Trading', category: 'Inventory', amount: 1750, time: '13:58', ruleStatus: 'Passed', aiScore: 11, riskScore: 16 },
  { id: 'TX-10475', vendor: 'Gulf Packaging Co.', category: 'Packaging', amount: 680, time: '13:51', ruleStatus: 'Passed', aiScore: 13, riskScore: 19 },
];

// Extra transactions so the Transactions page has 20+ entries.
const extraTransactions = [
  { id: 'TX-10474', vendor: 'Jeddah Fresh Foods', category: 'Inventory', amount: 4120, time: '13:44', ruleStatus: 'Passed', aiScore: 22, riskScore: 27 },
  { id: 'TX-10473', vendor: 'Tabuk Cleaning Supplies', category: 'Store Supplies', amount: 540, time: '13:37', ruleStatus: 'Passed', aiScore: 9, riskScore: 14 },
  { id: 'TX-10472', vendor: 'Dammam Electrical Co.', category: 'Maintenance', amount: 8900, time: '13:29', ruleStatus: 'Review', aiScore: 58, riskScore: 65 },
  { id: 'TX-10471', vendor: 'Al Khobar IT Services', category: 'Technology', amount: 12500, time: '13:20', ruleStatus: 'Passed', aiScore: 31, riskScore: 35 },
  { id: 'TX-10470', vendor: 'Makkah Textiles Ltd.', category: 'Inventory', amount: 3690, time: '13:12', ruleStatus: 'Passed', aiScore: 19, riskScore: 23 },
  { id: 'TX-10469', vendor: 'Qassim Transport Co.', category: 'Logistics', amount: 1420, time: '13:05', ruleStatus: 'Passed', aiScore: 14, riskScore: 18 },
  { id: 'TX-10468', vendor: 'Riyadh Wholesale Trading', category: 'Inventory', amount: 15800, time: '12:58', ruleStatus: 'Review', aiScore: 71, riskScore: 78 },
  { id: 'TX-10467', vendor: 'Eastern Distribution Co.', category: 'Inventory', amount: 2980, time: '12:50', ruleStatus: 'Passed', aiScore: 17, riskScore: 21 },
  { id: 'TX-10466', vendor: 'Gulf Packaging Co.', category: 'Packaging', amount: 760, time: '12:42', ruleStatus: 'Passed', aiScore: 10, riskScore: 15 },
  { id: 'TX-10465', vendor: 'Al Noor Supplies', category: 'Store Supplies', amount: 5320, time: '12:35', ruleStatus: 'Passed', aiScore: 26, riskScore: 30 },
  { id: 'TX-10464', vendor: 'Nesma Logistics', category: 'Logistics', amount: 1080, time: '12:27', ruleStatus: 'Passed', aiScore: 16, riskScore: 20 },
  { id: 'TX-10463', vendor: 'Al Zamil Store Fixtures', category: 'Equipment', amount: 9450, time: '12:19', ruleStatus: 'Review', aiScore: 63, riskScore: 69 },
  { id: 'TX-10462', vendor: 'Dammam Electrical Co.', category: 'Maintenance', amount: 2340, time: '12:11', ruleStatus: 'Passed', aiScore: 21, riskScore: 25 },
  { id: 'TX-10461', vendor: 'Jeddah Fresh Foods', category: 'Inventory', amount: 6780, time: '12:03', ruleStatus: 'Passed', aiScore: 29, riskScore: 33 },
  { id: 'TX-10460', vendor: 'Makkah Textiles Ltd.', category: 'Inventory', amount: 1990, time: '11:55', ruleStatus: 'Passed', aiScore: 13, riskScore: 17 },
];

// The flagged example transaction from the spec (Page 2 reference example).
const flaggedExample = {
  id: 'TX-10496',
  vendor: 'Riyadh Wholesale Trading',
  category: 'Inventory',
  amount: 18750,
  date: 'August 30, 2026',
  time: '14:42',
  ruleStatus: 'Review',
  aiScore: 80,
  riskScore: 86,
  rules: {
    duplicatePayment: { status: 'FAILED', detail: 'Possible duplicate payment detected' },
    approvalLimit: { status: 'PASSED', detail: 'Within approved transaction limit' },
    invoiceSplitting: { status: 'PASSED', detail: 'No invoice splitting pattern detected' },
    ghostVendor: { status: 'PASSED', detail: 'Vendor verified and recognized' },
    segregationOfDuties: { status: 'PASSED', detail: 'Requester and approver differ' },
  },
  ruleBasedRisk: 90,
  aiAnomalyRisk: 80,
  aiStatus: 'Unusual Transaction',
  aiReason: "Transaction amount and payment pattern are unusual compared with this vendor's normal activity.",
  alertStatus: 'Active',
  alertGenerated: '14:42:03',
  flagReason: 'Duplicate payment rule violation combined with unusual transaction behavior.',
};

function buildDefaultRules(t) {
  const failDuplicate = t.riskScore >= 61;
  return {
    duplicatePayment: failDuplicate
      ? { status: 'FAILED', detail: 'Possible duplicate payment detected' }
      : { status: 'PASSED', detail: 'No duplicate payment detected' },
    approvalLimit: { status: t.amount > 8000 ? 'FAILED' : 'PASSED', detail: t.amount > 8000 ? 'Transaction exceeds approval limit' : 'Within approved transaction limit' },
    invoiceSplitting: { status: 'PASSED', detail: 'No invoice splitting pattern detected' },
    ghostVendor: { status: 'PASSED', detail: 'Vendor verified and recognized' },
    segregationOfDuties: { status: 'PASSED', detail: 'Requester and approver differ' },
  };
}

function toFullTransaction(t) {
  const status = riskLevelFromScore(t.riskScore);
  return {
    ...t,
    date: 'August 30, 2026',
    status,
    rules: t.rules || buildDefaultRules(t),
    ruleBasedRisk: t.ruleBasedRisk ?? Math.min(100, t.riskScore + 4),
    aiAnomalyRisk: t.aiAnomalyRisk ?? t.aiScore,
    aiStatus: t.aiStatus || (status === 'High Risk' ? 'Unusual Transaction' : 'Normal Activity'),
    aiReason: t.aiReason || (status === 'High Risk'
      ? "Transaction amount and payment pattern are unusual compared with this vendor's normal activity."
      : 'Transaction pattern is consistent with normal vendor activity.'),
    alertStatus: t.alertStatus || (status !== 'Low Risk' ? 'Active' : 'None'),
    alertGenerated: t.alertGenerated || `${t.time}:00`,
    flagReason: t.flagReason || (status === 'High Risk'
      ? 'Duplicate payment rule violation combined with unusual transaction behavior.'
      : status === 'Medium Risk'
        ? 'Transaction amount approaching approval limit threshold.'
        : ''),
  };
}

export const initialTransactions = [
  ...baseTransactions,
  toFullTransaction(flaggedExample),
  ...extraTransactions,
].map((t) => (t.rules ? t : toFullTransaction(t)));

export const initialAlerts = [
  {
    id: 'AL-1',
    transactionId: 'TX-10496',
    title: 'Duplicate Payment Detected',
    description: 'Payment made to the same vendor within 7 days.',
    time: '14:42',
    severity: 'High',
    riskScore: 86,
    status: 'Active',
    reason: 'Duplicate payment rule violation combined with unusual transaction behavior.',
  },
  {
    id: 'AL-2',
    transactionId: 'TX-10477',
    title: 'Approval Limit Exceeded',
    description: 'Transaction amount exceeds the predefined approval limit.',
    time: '14:05',
    severity: 'Medium',
    riskScore: 58,
    status: 'Active',
    reason: 'Transaction amount exceeds the predefined approval limit for its category.',
  },
  {
    id: 'AL-3',
    transactionId: 'TX-10480',
    title: 'Invoice Splitting Detected',
    description: 'Multiple invoices detected for the same purchase.',
    time: '13:47',
    severity: 'Medium',
    riskScore: 61,
    status: 'Active',
    reason: 'Multiple smaller invoices detected that together exceed the approval threshold.',
  },
  {
    id: 'AL-4',
    transactionId: 'TX-10463',
    title: 'Ghost Vendor Flagged',
    description: 'Vendor has no prior verifiable transaction history.',
    time: '12:19',
    severity: 'Medium',
    riskScore: 69,
    status: 'Reviewed',
    reason: 'Vendor could not be verified against the registered vendor list.',
  },
  {
    id: 'AL-5',
    transactionId: 'TX-10472',
    title: 'Segregation of Duties Violation',
    description: 'Same user requested and approved this transaction.',
    time: '13:29',
    severity: 'Medium',
    riskScore: 65,
    status: 'Reviewed',
    reason: 'Requester and approver were the same user account.',
  },
];

export const dashboardSummary = {
  totalTransactionsToday: 1248,
  transactionsEvaluated: 1231,
  highRiskTransactions: 17,
  averageRiskScore: 28,
};

export const riskOverview = {
  low: 78,
  medium: 17,
  high: 5,
};
