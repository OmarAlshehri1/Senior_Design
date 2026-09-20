import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import {
  initialTransactions,
  initialAlerts,
  dashboardSummary,
  vendors,
} from '../data/mockData';

const AppContext = createContext(null);

let nextTxNumber = 10497;
let nextAlertNumber = 6;

function pad(n) {
  return n.toString().padStart(2, '0');
}

function nowTimeString() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowTimeStringWithSeconds() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function AppProvider({ children }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [summary, setSummary] = useState(dashboardSummary);
  const [notification, setNotification] = useState(null);
  const [simulating, setSimulating] = useState(false);

  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type, key: Date.now() });
    setTimeout(() => {
      setNotification((current) => (current && current.message === message ? null : current));
    }, 3500);
  }, []);

  const markAlertReviewed = useCallback((transactionId) => {
    setAlerts((prev) =>
      prev.map((a) => (a.transactionId === transactionId ? { ...a, status: 'Reviewed' } : a))
    );
    setTransactions((prev) =>
      prev.map((t) => (t.id === transactionId ? { ...t, alertStatus: 'Reviewed' } : t))
    );
  }, []);

  const simulateNewTransaction = useCallback(() => {
    if (simulating) return;
    setSimulating(true);

    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const id = `TX-${nextTxNumber++}`;
    const amount = Math.floor(Math.random() * 15000) + 5000;
    const time = nowTimeString();

    const pendingTransaction = {
      id,
      vendor: vendor.name,
      category: vendor.category,
      amount,
      date: 'August 30, 2026',
      time,
      ruleStatus: 'Processing',
      aiScore: null,
      riskScore: null,
      status: 'Processing',
      rules: null,
      processing: true,
    };

    setTransactions((prev) => [pendingTransaction, ...prev]);
    setSummary((prev) => ({
      ...prev,
      totalTransactionsToday: prev.totalTransactionsToday + 1,
    }));
    showNotification('Processing transaction...', 'info');

    setTimeout(() => {
      const aiScore = Math.floor(Math.random() * 16) + 70; // 70-85
      const riskScore = Math.floor(Math.random() * 16) + 76; // 76-91

      const finishedTransaction = {
        ...pendingTransaction,
        ruleStatus: 'Review',
        aiScore,
        riskScore,
        status: 'High Risk',
        processing: false,
        rules: {
          duplicatePayment: { status: 'FAILED', detail: 'Possible duplicate payment detected' },
          approvalLimit: { status: 'PASSED', detail: 'Within approved transaction limit' },
          invoiceSplitting: { status: 'PASSED', detail: 'No invoice splitting pattern detected' },
          ghostVendor: { status: 'PASSED', detail: 'Vendor verified and recognized' },
          segregationOfDuties: { status: 'PASSED', detail: 'Requester and approver differ' },
        },
        ruleBasedRisk: Math.min(100, riskScore + 4),
        aiAnomalyRisk: aiScore,
        aiStatus: 'Unusual Transaction',
        aiReason: "Transaction amount and payment pattern are unusual compared with this vendor's normal activity.",
        alertStatus: 'Active',
        alertGenerated: nowTimeStringWithSeconds(),
        flagReason: 'Duplicate payment rule violation combined with unusual transaction behavior.',
      };

      setTransactions((prev) => prev.map((t) => (t.id === id ? finishedTransaction : t)));

      setSummary((prev) => ({
        ...prev,
        transactionsEvaluated: prev.transactionsEvaluated + 1,
        highRiskTransactions: prev.highRiskTransactions + 1,
      }));

      const newAlert = {
        id: `AL-${nextAlertNumber++}`,
        transactionId: id,
        title: 'Duplicate Payment Detected',
        description: 'Payment made to the same vendor within 7 days.',
        time,
        severity: 'High',
        riskScore,
        status: 'Active',
        reason: 'Duplicate payment rule violation combined with unusual transaction behavior.',
      };
      setAlerts((prev) => [newAlert, ...prev]);

      setSimulating(false);
      showNotification(`New high-risk transaction flagged: ${id}`, 'alert');
    }, 1000);
  }, [simulating, showNotification]);

  const getTransaction = useCallback(
    (id) => transactions.find((t) => t.id === id),
    [transactions]
  );

  const value = useMemo(
    () => ({
      transactions,
      alerts,
      summary,
      notification,
      simulating,
      showNotification,
      markAlertReviewed,
      simulateNewTransaction,
      getTransaction,
    }),
    [transactions, alerts, summary, notification, simulating, showNotification, markAlertReviewed, simulateNewTransaction, getTransaction]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}
