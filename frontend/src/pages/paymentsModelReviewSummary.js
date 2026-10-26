// Summarize only the signed-in user's current case snapshots, not event history.
export function summarizeModelReviews(items) {
  const groups = [true, false].map((nominated) => ({
    nominated, total: 0, reviewed: 0, yes: 0, no: 0, insufficient: 0, pending: 0,
  }));
  for (const item of items) {
    const group = groups[item.model_nominated ? 0 : 1];
    group.total += 1;
    const outcome = item.review?.version > 0 ? item.review.outcome : null;
    if (outcome === 'YES') group.yes += 1;
    else if (outcome === 'NO') group.no += 1;
    else if (outcome === 'INSUFFICIENT_INFORMATION') group.insufficient += 1;
    else { group.pending += 1; continue; }
    group.reviewed += 1;
  }
  return { groups, reviewed: groups.reduce((n, g) => n + g.reviewed, 0), total: items.length };
}

// Database summaries cover the authorized dataset, including cases on other pages.
export function modelReviewSummary(data) {
  if (!data.summary) return summarizeModelReviews(data.items);
  return {
    groups: data.summary,
    reviewed: data.summary.reduce((n, group) => n + group.reviewed, 0),
    total: data.summary.reduce((n, group) => n + group.total, 0),
  };
}
