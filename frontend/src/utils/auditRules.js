export function toggleExpandedRuleIds(expandedRuleIds, ruleId) {
  const nextExpandedRuleIds = new Set(expandedRuleIds);

  if (nextExpandedRuleIds.has(ruleId)) nextExpandedRuleIds.delete(ruleId);
  else nextExpandedRuleIds.add(ruleId);

  return nextExpandedRuleIds;
}
