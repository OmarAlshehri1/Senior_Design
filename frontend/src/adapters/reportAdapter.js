function nullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countValue(value) {
  return nullableNumber(value) ?? 0;
}

function percentage(count, total) {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

export function adaptReport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const summary = payload.summary && typeof payload.summary === 'object'
    ? payload.summary
    : {};
  const daily = summary.daily_summary && typeof summary.daily_summary === 'object'
    ? summary.daily_summary
    : {};
  const risks = summary.risk_distribution
    && typeof summary.risk_distribution === 'object'
    ? summary.risk_distribution
    : {};
  const alertSummary = summary.alert_summary
    && typeof summary.alert_summary === 'object'
    ? summary.alert_summary
    : {};

  const totalTransactions = countValue(daily.total_transactions);
  const lowCount = countValue(risks.low ?? risks.LOW);
  const mediumCount = countValue(risks.medium ?? risks.MEDIUM);
  const highCount = countValue(risks.high ?? risks.HIGH);

  return {
    id: payload.id ?? null,
    type: payload.type ?? null,
    status: payload.status ?? null,
    periodStart: payload.period_start ?? null,
    periodEnd: payload.period_end ?? null,
    createdAt: payload.created_at ?? null,
    completedAt: payload.completed_at ?? null,
    failureReason: payload.failure_reason ?? null,
    downloadPath: payload.download_url ?? null,
    reportVersion: summary.report_version ?? null,
    dailySummary: {
      totalTransactions,
      transactionsEvaluated: countValue(
        daily.transactions_evaluated
      ),
      highRiskTransactions: countValue(
        daily.high_risk_transactions
      ),
      averageRiskScore: nullableNumber(
        daily.average_risk_score
      ),
      activeAlerts: countValue(daily.active_alerts),
      reviewedAlerts: countValue(daily.reviewed_alerts),
    },
    riskDistribution: [
      {
        key: 'low',
        label: 'Low Risk',
        count: lowCount,
        percentage: percentage(lowCount, totalTransactions),
      },
      {
        key: 'medium',
        label: 'Medium Risk',
        count: mediumCount,
        percentage: percentage(mediumCount, totalTransactions),
      },
      {
        key: 'high',
        label: 'High Risk',
        count: highCount,
        percentage: percentage(highCount, totalTransactions),
      },
    ],
    alertSummary: {
      total: countValue(alertSummary.total),
      active: countValue(alertSummary.active),
      reviewed: countValue(alertSummary.reviewed),
      high: countValue(alertSummary.high),
      medium: countValue(alertSummary.medium),
    },
    ruleSummary: Array.isArray(summary.rule_summary)
      ? summary.rule_summary.map((rule) => ({
        id: rule?.rule_key ?? null,
        name: rule?.rule_name ?? null,
        violationCount: countValue(rule?.violation_count),
      }))
      : [],
    highRiskTransactions: Array.isArray(
      summary.high_risk_transactions
    )
      ? summary.high_risk_transactions.map((transaction) => ({
        id: transaction?.id ?? null,
        timestamp: transaction?.timestamp ?? null,
        vendor: transaction?.vendor_name ?? null,
        amount: nullableNumber(transaction?.amount),
        currency: transaction?.currency ?? null,
        riskScore: nullableNumber(transaction?.risk_score),
        riskLevel: transaction?.risk_level ?? null,
      }))
      : [],
  };
}

export function adaptReportCollection(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    return {
      items: [],
      total: 0,
      page: null,
      pageSize: null,
    };
  }

  return {
    items: payload.items.map(adaptReport).filter(Boolean),
    total: countValue(payload.total),
    page: nullableNumber(payload.page),
    pageSize: nullableNumber(payload.page_size),
  };
}

export function selectPersistedReport(reports, reportId, fallback = null) {
  if (!Array.isArray(reports)) return fallback;
  return reports.find((report) => report?.id === reportId) ?? fallback;
}
