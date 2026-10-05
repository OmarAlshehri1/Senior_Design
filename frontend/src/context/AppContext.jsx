import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppContext from './contextStore';
import { currentDataSource } from '../data/dataSource';
import { deriveDashboardSummary } from '../utils/dashboard';
import { getRiskLevel, RISK_LEVELS } from '../utils/risk';
import { findTransactionById } from '../utils/transactions';
import { alertsService } from '../services/alertsService';
import { realtimeService } from '../services/realtimeService';
import { transactionsService } from '../services/transactionsService';
import { notificationService } from '../notifications/notificationService.js';
import { onAuthSessionChange, readAuthSession } from '../auth/authSession.js';

let nextTxNumber = 10497;
let nextAlertNumber = 7;
const DEFAULT_TRANSACTIONS_PAGE_SIZE = 10;
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
  const [transactionsPageSize, setTransactionsPageSize] = useState(DEFAULT_TRANSACTIONS_PAGE_SIZE);
  const [transactionsSearch, setTransactionsSearch] = useState('');
  const [transactionsSortBy, setTransactionsSortBy] = useState('newest');
  const [transactionsRiskLevel, setTransactionsRiskLevel] = useState(null);
  const [transactionsRuleStatus, setTransactionsRuleStatus] = useState(null);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState(null);
  const [notification, setNotification] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState(null);
  const notificationsGeneration = useRef(0);
  const notificationsLoadSequence = useRef(0);
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

  const refreshNotifications = useCallback(async () => {
    if (!readAuthSession()?.access_token) {
      notificationsGeneration.current += 1;
      notificationsLoadSequence.current += 1;
      setNotifications([]);
      setUnreadNotificationCount(0);
      setNotificationsError(null);
      setNotificationsLoading(false);
      return;
    }
    const generation = notificationsGeneration.current;
    const loadSequence = ++notificationsLoadSequence.current;
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const result = await notificationService.listNotifications({
        query: { page: 1, page_size: 100 },
      });
      if (generation === notificationsGeneration.current && loadSequence === notificationsLoadSequence.current) {
        setNotifications(result.items);
        setUnreadNotificationCount(result.unreadCount);
      }
    } catch (error) {
      if (generation === notificationsGeneration.current && loadSequence === notificationsLoadSequence.current) {
        setNotificationsError(error instanceof Error ? error.message : 'Notifications could not be loaded.');
      }
    } finally {
      if (generation === notificationsGeneration.current && loadSequence === notificationsLoadSequence.current) setNotificationsLoading(false);
    }
  }, []);

  const markNotificationRead = useCallback(async (notificationId) => {
    const generation = notificationsGeneration.current;
    try {
      const result = await notificationService.markNotificationRead(notificationId);
      if (generation === notificationsGeneration.current) {
        setNotifications((current) => current.map((item) => item.id === notificationId
          ? { ...item, readAt: result?.readAt ?? new Date().toISOString() } : item));
        setUnreadNotificationCount((current) => Math.max(0, current - 1));
        setNotificationsError(null);
      }
    } catch (error) {
      if (generation === notificationsGeneration.current) {
        setNotificationsError(error instanceof Error ? error.message : 'Notification could not be updated.');
      }
    }
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    const generation = notificationsGeneration.current;
    try {
      await notificationService.markAllNotificationsRead();
      if (generation === notificationsGeneration.current) {
        const readAt = new Date().toISOString();
        setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt }));
        setUnreadNotificationCount(0);
        setNotificationsError(null);
      }
    } catch (error) {
      if (generation === notificationsGeneration.current) {
        setNotificationsError(error instanceof Error ? error.message : 'Notifications could not be updated.');
      }
    }
  }, []);

  useEffect(() => {
    let subjectId = readAuthSession()?.user?.id ?? null;
    const clearNotifications = () => {
      notificationsGeneration.current += 1;
      notificationsLoadSequence.current += 1;
      setNotifications([]);
      setUnreadNotificationCount(0);
      setNotificationsError(null);
      setNotificationsLoading(false);
    };
    const syncNotifications = (session) => {
      const nextSubjectId = session?.user?.id ?? null;
      if (nextSubjectId === subjectId) return;
      subjectId = nextSubjectId;
      notificationsGeneration.current += 1;
      if (nextSubjectId) refreshNotifications();
      else clearNotifications();
    };
    const unsubscribe = onAuthSessionChange(syncNotifications);
    if (subjectId) refreshNotifications();
    return () => {
      notificationsGeneration.current += 1;
      notificationsLoadSequence.current += 1;
      unsubscribe();
    };
  }, [refreshNotifications]);

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
            page_size: transactionsPageSize,
            search: transactionsSearch || undefined,
            risk_level: transactionsRiskLevel || undefined,
            rule_status: transactionsRuleStatus || undefined,
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
    transactionsPageSize,
    transactionsSearch,
    transactionsSortBy,
    transactionsRiskLevel,
    transactionsRuleStatus,
  ]);

  useEffect(() => {
    let active = true;
    let controller = null;
    let loading = false;
    let rerun = false;

    async function reconcileAlerts() {
      if (loading) {
        rerun = true;
        return;
      }
      loading = true;
      do {
        rerun = false;
        controller = new AbortController();
        setAlertsLoading(true);
        setAlertsError(null);
        try {
          const result = await alertsService.list({
            signal: controller.signal,
            query: { page: 1, page_size: 100 },
          });
          if (!active) return;
          // Replace the snapshot: this also removes alerts that are no longer
          // visible after a role, team, or assignment change.
          setAlerts(result.items);
          setLastUpdated(new Date().toISOString());
        } catch (error) {
          if (!active || controller.signal.aborted) return;
          setAlertsError(error instanceof Error ? error.message : 'Alerts could not be loaded.');
        } finally {
          if (active) setAlertsLoading(false);
        }
      } while (active && rerun);
      loading = false;
    }

    const unsubscribe = realtimeService.onMessage((event) => {
      if (event.type === 'alerts.changed' || event.type === 'alerts.catch_up') {
        reconcileAlerts();
        refreshNotifications();
      }
    });
    realtimeService.connect();
    reconcileAlerts();

    return () => {
      active = false;
      controller?.abort();
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
      transactionsPageSize,
      setTransactionsPageSize,
      setTransactionsPage,
      transactionsSearch,
      setTransactionsSearch,
      transactionsSortBy,
      setTransactionsSortBy,
      transactionsRiskLevel,
      setTransactionsRiskLevel,
      transactionsRuleStatus,
      setTransactionsRuleStatus,
      alerts,
      alertsLoading,
      alertsError,
      summary,
      riskCounts,
      riskOverview,
      notification,
      notifications,
      unreadNotificationCount,
      notificationsLoading,
      notificationsError,
      simulating,
      lastUpdated,
      lastSimulatedTransactionId,
      showNotification,
      refreshNotifications,
      markNotificationRead,
      markAllNotificationsRead,
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
      transactionsPageSize,
      transactionsSearch,
      transactionsSortBy,
      transactionsRiskLevel,
      transactionsRuleStatus,
      alerts,
      alertsLoading,
      alertsError,
      summary,
      riskCounts,
      riskOverview,
      notification,
      notifications,
      unreadNotificationCount,
      notificationsLoading,
      notificationsError,
      simulating,
      lastUpdated,
      lastSimulatedTransactionId,
      showNotification,
      refreshNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      markAlertReviewed,
      setAlertAssignment,
      simulateNewTransaction,
      getTransaction,
      getAlertForTransaction,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
