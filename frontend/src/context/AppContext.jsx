import { useCallback, useEffect, useMemo, useState } from 'react';
import AppContext from './contextStore';
import { currentDataSource } from '../data/dataSource';
import { deriveDashboardSummary } from '../utils/dashboard';
import { getRiskLevel, RISK_LEVELS } from '../utils/risk';
import { findTransactionById } from '../utils/transactions';
import { adaptAlert } from '../adapters/alertAdapter';
import { alertsService } from '../services/alertsService';
import { realtimeService } from '../services/realtimeService';
import { transactionsService } from '../services/transactionsService';

let nextTxNumber = 10497;
let nextAlertNumber = 7;
const TRANSACTIONS_PAGE_SIZE = 10;
const {
  buildRuleResults,
  initialAlerts,
  initialTransactions,
  vendors,
} = currentDataSource;

const simulationScenarios = [
  {
    amount: 3200,
    failedRule: null,
    ruleScore: 24,
    aiScore: 18,
    riskScore: 22,
    explanation: 'All recorded rule results are marked Passed for this test transaction.',
    riskExplanation: 'No failed audit rules are recorded, and the transaction remains within the recorded low-risk range.',
  },
  {
    amount: 14500,
    failedRule: 'approvalLimit',
    ruleScore: 68,
    aiScore: 48,
    riskScore: 60,
    explanation: 'Approval Limit is marked Failed for this test transaction.',
    riskExplanation: 'The recorded risk score reflects an approval-limit exception that requires auditor review.',
  },
  {
    amount: 18750,
    failedRule: 'duplicatePayment',
    ruleScore: 90,
    aiScore: 80,
    riskScore: 86,
    explanation: 'Duplicate Payment is marked Failed and the test transaction is High Risk.',
    riskExplanation: 'The recorded risk score is supported by a possible duplicate payment and elevated transaction signals.',
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
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState(null);
  const [transactionsTotal, setTransactionsTotal] = useState(0);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [transactionsSearch, setTransactionsSearch] = useState('');
  const [transactionsSortBy, setTransactionsSortBy] = useState('newest');
  const [alerts, setAlerts] = useState(initialAlerts);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState(null);
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

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadTransactions() {
      setTransactionsLoading(true);
      setTransactionsError(null);

      try {
        const result = await transactionsService.list({
          query: {
            page: transactionsPage,
            page_size: TRANSACTIONS_PAGE_SIZE,
            search: transactionsSearch || undefined,
            sort_by: transactionsSortBy,
          },
          signal: controller.signal,
        });

        if (!active) return;

        setTransactions(result.items);
        setTransactionsTotal(result.total);
        setLastUpdated(new Date().toISOString());
      } catch (error) {
        if (!active || controller.signal.aborted) return;

        setTransactions([]);
        setTransactionsTotal(0);
        setTransactionsError(
          error instanceof Error
            ? error.message
            : 'Transactions could not be loaded.'
        );
      } finally {
        if (active) {
          setTransactionsLoading(false);
        }
      }
    }

    loadTransactions();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    transactionsPage,
    transactionsSearch,
    transactionsSortBy,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadAlerts() {
      setAlertsLoading(true);
      setAlertsError(null);

      try {
        const result = await alertsService.list({
          query: {
            page: 1,
            page_size: 100,
          },
          signal: controller.signal,
        });

        if (!active) return;

        setAlerts((previous) => {
          const alertsById = new Map(
            result.items
              .filter((alert) => alert?.id)
              .map((alert) => [alert.id, alert])
          );

          previous.forEach((alert) => {
            if (alert?.id && !alertsById.has(alert.id)) {
              alertsById.set(alert.id, alert);
            }
          });

          return [...alertsById.values()];
        });
        setLastUpdated(new Date().toISOString());
      } catch (error) {
        if (!active || controller.signal.aborted) return;

        setAlertsError(
          error instanceof Error
            ? error.message
            : 'Alerts could not be loaded.'
        );
      } finally {
        if (active) {
          setAlertsLoading(false);
        }
      }
    }

    loadAlerts();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = realtimeService.onMessage((event) => {
      const alert = adaptAlert(event.data);

      if (!alert?.id) return;

      setAlerts((previous) => [
        alert,
        ...previous.filter((item) => item.id !== alert.id),
      ]);
      setLastUpdated(new Date().toISOString());
    });

    realtimeService.connect();

    return () => {
      unsubscribe();
      realtimeService.disconnect();
    };
  }, []);
  const markAlertReviewed = useCallback(async (transactionId, status = 'REVIEWED', note = null) => {
    const alert = alerts.find(
      (item) => item.transactionId === transactionId
    );

    if (!alert?.id) {
      throw new Error('The alert could not be found.');
    }

    const reviewedAlert = status === 'REVIEWED'
      ? await alertsService.markReviewed(alert.id)
      : await alertsService.updateReview(alert.id, status, note);

    if (!reviewedAlert?.id) {
      throw new Error('The alert could not be reviewed.');
    }

    setAlerts((previous) => previous.map((item) => (
      item.id === reviewedAlert.id
        ? reviewedAlert
        : item
    )));
    setLastUpdated(new Date().toISOString());

    return reviewedAlert;
  }, [alerts]);

  const setAlertAssignment = useCallback((alertId, assignment) => {
    setAlerts((previous) => previous.map((alert) => alert.id === alertId ? { ...alert, assignment: assignment ? {
      assigneeId: assignment.assignee_id ?? assignment.assigneeId ?? null,
      assigneeName: assignment.assignee_name ?? assignment.assigneeName ?? null,
      status: assignment.status ?? null,
    } : null } : alert));
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
      currency: 'SAR',
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
    showNotification('Adding a test transaction...', 'info');

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
        rules: buildRuleResults(scenario.failedRule),
        aiStatus: scenario.aiScore >= 50 ? 'Elevated Anomaly Score' : 'Routine Anomaly Score',
        aiExplanation: scenario.aiScore >= 50
          ? 'The transaction shows elevated anomaly indicators compared with the current activity baseline.'
          : 'The transaction is broadly consistent with the current activity baseline.',
        riskExplanation: scenario.riskExplanation,
        dataQuality: { status: 'Complete', missingFields: [] },
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
      showNotification('Test transaction added.', 'success');
    }, 1000);
  }, [simulating, showNotification]);

  const getTransaction = useCallback(
    (id) => findTransactionById(transactions, id),
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
      transactionsLoading,
      transactionsError,
      transactionsTotal,
      transactionsPage,
      transactionsPageSize: TRANSACTIONS_PAGE_SIZE,
      setTransactionsPage,
      transactionsSearch,
      setTransactionsSearch,
      transactionsSortBy,
      setTransactionsSortBy,
      alerts,
      alertsLoading,
      alertsError,
      summary,
      riskCounts,
      riskOverview,
      notification,
      simulating,
      lastUpdated,
      lastSimulatedTransactionId,
      showNotification,
      markAlertReviewed,
      setAlertAssignment,
      simulateNewTransaction,
      getTransaction,
      getAlertForTransaction,
    }),
    [
      transactions,
      transactionsLoading,
      transactionsError,
      transactionsTotal,
      transactionsPage,
      transactionsSearch,
      transactionsSortBy,
      alerts,
      alertsLoading,
      alertsError,
      summary,
      riskCounts,
      riskOverview,
      notification,
      simulating,
      lastUpdated,
      lastSimulatedTransactionId,
      showNotification,
      markAlertReviewed,
      setAlertAssignment,
      simulateNewTransaction,
      getTransaction,
      getAlertForTransaction,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
