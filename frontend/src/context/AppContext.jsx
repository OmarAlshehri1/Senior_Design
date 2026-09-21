import { useCallback, useMemo, useState } from 'react';
import AppContext from './contextStore';
import {
  buildDemoRuleResults,
  initialAlerts,
  initialTransactions,
  vendors,
} from '../data/mockData';
import { deriveDashboardSummary } from '../utils/dashboard';
import { getRiskLevel, RISK_LEVELS } from '../utils/risk';

let nextTxNumber = 10497;
let nextAlertNumber = 7;

const simulationScenarios = [
  {
    amount: 3200,
    failedRule: null,
    ruleScore: 24,
    aiScore: 18,
    riskScore: 22,
    explanation: 'All rule results are marked Passed in this simulated frontend transaction.',
  },
  {
    amount: 14500,
    failedRule: 'approvalLimit',
    ruleScore: 68,
    aiScore: 48,
    riskScore: 60,
    explanation: 'Approval Limit is marked Failed in this simulated Medium Risk transaction.',
  },
  {
    amount: 18750,
    failedRule: 'duplicatePayment',
    ruleScore: 90,
    aiScore: 80,
    riskScore: 86,
    explanation: 'Duplicate Payment is marked Failed and the simulated transaction is High Risk.',
  },
];

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function AppProvider({ children }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [notification, setNotification] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toISOString());
  const [lastSimulatedTransactionId, setLastSimulatedTransactionId] = useState(null);

  const showNotification = useCallback((message, type = 'success') => {
    const key = Date.now();
    setNotification({ message, type, key });
    setTimeout(() => {
      setNotification((current) => (current?.key === key ? null : current));
    }, 3500);
  }, []);

  const markAlertReviewed = useCallback((transactionId) => {
    setAlerts((previous) =>
      previous.map((alert) => (
        alert.transactionId === transactionId ? { ...alert, status: 'Reviewed' } : alert
      ))
    );
    setLastUpdated(new Date().toISOString());
  }, []);

  const simulateNewTransaction = useCallback(() => {
    if (simulating) return;
    setSimulating(true);

    const transactionNumber = nextTxNumber++;
    const scenario = simulationScenarios[(transactionNumber - 10497) % simulationScenarios.length];
    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const id = `TX-${transactionNumber}`;
    const now = new Date();
    const timestamp = now.toISOString();
    const time = formatTime(now);

    const pendingTransaction = {
      id,
      timestamp,
      vendor: vendor.name,
      category: vendor.category,
      amount: scenario.amount,
      date: formatDate(now),
      time,
      ruleStatus: 'Processing',
      ruleScore: null,
      aiScore: null,
      riskScore: null,
      rules: null,
      processing: true,
    };

    setTransactions((previous) => [pendingTransaction, ...previous]);
    setLastSimulatedTransactionId(id);
    setLastUpdated(timestamp);
    showNotification('Adding a simulated frontend transaction...', 'info');

    setTimeout(() => {
      const riskLevel = getRiskLevel(scenario.riskScore);
      const createsAlert = riskLevel === RISK_LEVELS.HIGH;
      const finishedAt = new Date();

      const finishedTransaction = {
        ...pendingTransaction,
        ruleStatus: scenario.failedRule ? 'Review' : 'Passed',
        ruleScore: scenario.ruleScore,
        aiScore: scenario.aiScore,
        riskScore: scenario.riskScore,
        processing: false,
        rules: buildDemoRuleResults(scenario.failedRule),
        aiStatus: scenario.aiScore >= 50 ? 'Elevated Demo Score' : 'Routine Demo Score',
        aiExplanation: 'Simulated AI score for frontend display; no anomaly model was run.',
      };

      setTransactions((previous) => previous.map((transaction) => (
        transaction.id === id ? finishedTransaction : transaction
      )));

      if (createsAlert) {
        const newAlert = {
          id: `AL-${nextAlertNumber++}`,
          transactionId: id,
          timestamp: finishedAt.toISOString(),
          title: 'Duplicate Payment Detected',
          description: 'Possible duplicate payment detected for the same vendor and amount.',
          time: formatTime(finishedAt),
          severity: riskLevel.replace(' Risk', ''),
          riskScore: scenario.riskScore,
          status: 'Active',
          reason: scenario.explanation,
        };
        setAlerts((previous) => [newAlert, ...previous]);
      }

      setSimulating(false);
      setLastUpdated(finishedAt.toISOString());
      showNotification('Demo transaction added.', 'success');
    }, 1000);
  }, [simulating, showNotification]);

  const getTransaction = useCallback(
    (id) => transactions.find((transaction) => transaction.id === id),
    [transactions]
  );

  const getAlertForTransaction = useCallback(
    (transactionId) => alerts.find((alert) => alert.transactionId === transactionId),
    [alerts]
  );

  const { summary, riskCounts, riskOverview } = useMemo(
    () => deriveDashboardSummary(transactions),
    [transactions]
  );

  const value = useMemo(
    () => ({
      transactions,
      alerts,
      summary,
      riskCounts,
      riskOverview,
      notification,
      simulating,
      lastUpdated,
      lastSimulatedTransactionId,
      showNotification,
      markAlertReviewed,
      simulateNewTransaction,
      getTransaction,
      getAlertForTransaction,
    }),
    [
      transactions,
      alerts,
      summary,
      riskCounts,
      riskOverview,
      notification,
      simulating,
      lastUpdated,
      lastSimulatedTransactionId,
      showNotification,
      markAlertReviewed,
      simulateNewTransaction,
      getTransaction,
      getAlertForTransaction,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
