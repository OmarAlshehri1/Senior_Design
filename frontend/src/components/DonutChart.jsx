const LEVELS = Object.freeze([
  ['high', 'High risk'],
  ['medium', 'Medium risk'],
  ['low', 'Low risk'],
]);
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function DonutChart({ counts, percentages, total }) {
  let offset = 0;
  const segments = total === 0 ? [] : ['low', 'medium', 'high'].map((level) => {
    const length = (counts[level] / total) * CIRCUMFERENCE;
    const segment = { level, length, offset };
    offset += length;
    return segment;
  }).filter((segment) => segment.length > 0);

  return (
    <div className="risk-distribution">
      <div className="risk-donut" role="img"
        aria-label={`${counts.low} low risk transactions, ${counts.medium} medium risk transactions, and ${counts.high} high risk transactions`}>
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <circle className="risk-donut-track" cx="64" cy="64" r={RADIUS} />
          {segments.map(({ level, length, offset: start }) => <circle key={level} className={`risk-donut-segment is-${level}`} cx="64" cy="64" r={RADIUS}
            strokeDasharray={`${length} ${CIRCUMFERENCE - length}`} strokeDashoffset={-start} />)}
        </svg>
        <div className="risk-donut-center">
          <strong>{total.toLocaleString('en-US')}</strong>
          <span>Evaluated</span>
        </div>
      </div>
      <ul className="risk-legend">
        {LEVELS.map(([level, label]) => (
          <li key={level} className={`risk-legend-row is-${level}`}
            aria-label={`${label} transactions: ${counts[level]}, ${percentages[level]} percent`}>
            <span className="risk-legend-label"><span className="risk-legend-dot" aria-hidden="true" />{label}</span>
            <span className="risk-legend-count">{counts[level].toLocaleString('en-US')}</span>
            <span className="risk-legend-percent">{percentages[level]}%</span>
            <span className="risk-legend-bar" aria-hidden="true"><span style={{ width: `${percentages[level]}%` }} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
