import { Link } from 'react-router-dom';
import { DASHBOARD_RISK_LINKS } from '../utils/dashboard';

export default function DonutChart({ counts, percentages, total }) {
  const lowDeg = (percentages.low / 100) * 360;
  const mediumDeg = (percentages.medium / 100) * 360;

  const background = total === 0 ? '#e5e8ee' : `conic-gradient(
    #16a34a 0deg ${lowDeg}deg,
    #ea8c1e ${lowDeg}deg ${lowDeg + mediumDeg}deg,
    #dc2626 ${lowDeg + mediumDeg}deg 360deg
  )`;

  return (
    <div className="donut-wrap">
      <div
        className="donut-chart"
        role="img"
        aria-label={`${counts.low} low risk transactions, ${counts.medium} medium risk transactions, and ${counts.high} high risk transactions`}
        style={{ background }}
      >
        <div className="donut-center">
          <strong>{total.toLocaleString('en-US')}</strong>
          <span>Evaluated</span>
        </div>
      </div>
      <div className="donut-legend">
        {['low', 'medium', 'high'].map((level) => (
          <Link
            key={level}
            className="legend-row"
            to={DASHBOARD_RISK_LINKS[level]}
            aria-label={`View ${level} risk transactions: ${counts[level]}, ${percentages[level]} percent`}
          >
            <span className="legend-label">
              <span className={`legend-dot dot-${level}`} />
              {`${level[0].toUpperCase()}${level.slice(1)} Risk`}
            </span>
            <strong>{counts[level]} <span aria-hidden="true">·</span> {percentages[level]}%</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
