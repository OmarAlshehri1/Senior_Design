function timestampValue(item) {
  const value = Date.parse(item.timestamp);
  return Number.isNaN(value) ? 0 : value;
}

export function sortNewestFirst(items) {
  return [...items].sort((a, b) => timestampValue(b) - timestampValue(a));
}
