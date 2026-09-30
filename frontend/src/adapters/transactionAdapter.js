const RULE_KEY_MAP = Object.freeze({
  segregation_of_duties: 'segregationOfDuties',
  approval_limits: 'approvalLimit',
  duplicate_payment: 'duplicatePayment',
  invoice_splitting: 'invoiceSplitting',
  ghost_vendors: 'ghostVendor',
});

const RULE_STATUS_MAP = Object.freeze({
  PASSED: 'Passed',
  REVIEW: 'Review',
  NOT_EVALUATED: 'Not Evaluated',
});

const RESULT_STATUS_MAP = Object.freeze({
  PASSED: 'Passed',
  FAILED: 'Failed',
  NOT_EVALUATED: 'Not Evaluated',
});

const QUALITY_STATUS_MAP = Object.freeze({
  COMPLETE: 'Complete',
  PARTIAL: 'Partially Complete',
  INSUFFICIENT: 'Needs Review',
});

const RISK_LEVEL_MAP = Object.freeze({
  LOW: 'Low Risk',
  MEDIUM: 'Medium Risk',
  HIGH: 'High Risk',
});

function nullableNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function mapRuleResults(ruleResults) {
  if (!Array.isArray(ruleResults)) return null;

  return Object.fromEntries(
    ruleResults
      .filter((result) => result && RULE_KEY_MAP[result.rule_key])
      .map((result) => [
        RULE_KEY_MAP[result.rule_key],
        {
          status: RESULT_STATUS_MAP[result.status] ?? null,
          detail: typeof result.detail === 'string' ? result.detail : null,
          scoreContribution: nullableNumber(result.score_contribution),
          evidence: result.evidence && typeof result.evidence === 'object'
            ? structuredClone(result.evidence)
            : null,
        },
      ])
  );
}

export function adaptTransaction(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  return {
    id: payload.id ?? null,
    timestamp: payload.timestamp ?? null,
    vendorId: payload.vendor_id ?? null,
    vendor: payload.vendor_name ?? null,
    vendorMonitoringStatus: payload.vendor_monitoring_status ?? null,
    category: payload.category ?? null,
    amount: nullableNumber(payload.amount),
    currency: payload.currency ?? null,
    ruleStatus: RULE_STATUS_MAP[payload.rule_status] ?? null,
    ruleScore: nullableNumber(payload.rule_score),
    aiScore: nullableNumber(payload.ai_score),
    riskScore: nullableNumber(payload.risk_score),
    riskLevel: RISK_LEVEL_MAP[payload.risk_level] ?? null,
    dataQuality: {
      status: QUALITY_STATUS_MAP[payload.data_quality_status] ?? null,
      missingFields: null,
    },
    rules: mapRuleResults(payload.rule_results),
    riskExplanation: typeof payload.explanation === 'string'
      ? payload.explanation
      : payload.explanation?.summary ?? null,
  };
}

export function adaptTransactionCollection(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    return { items: [], total: 0, page: null, pageSize: null };
  }

  return {
    items: payload.items.map(adaptTransaction).filter(Boolean),
    total: Number.isFinite(payload.total) ? payload.total : 0,
    page: Number.isFinite(payload.page) ? payload.page : null,
    pageSize: Number.isFinite(payload.page_size) ? payload.page_size : null,
  };
}
