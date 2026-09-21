export default function DonutChart({ low, medium, high, total }) {
  const lowDeg = (low / 100) * 360;
  const medDeg = (medium / 100) * 360;

  const background = total === 0 ? '#e5e8ee' : `conic-gradient(
    #16a34a 0deg ${lowDeg}deg,
    #ea8c1e ${lowDeg}deg ${lowDeg + medDeg}deg,
    #dc2626 ${lowDeg + medDeg}deg 360deg
  )`;

  return (
    <div className="donut-wrap">
      <div
        role="img"
        aria-label={`${low}% low risk, ${medium}% medium risk, and ${high}% high risk`}
        style={{
          width: 150,
          height: 150,
          borderRadius: '50%',
          background,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 100,
            height: 100,
            borderRadius: '50%',
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700 }}>{total.toLocaleString('en-US')}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Evaluated</div>
        </div>
      </div>
      <div className="donut-legend">
        <div className="legend-row">
          <span className="legend-dot dot-low" />
          Low Risk
          <strong>{low}%</strong>
        </div>
        <div className="legend-row">
          <span className="legend-dot dot-medium" />
          Medium Risk
          <strong>{medium}%</strong>
        </div>
        <div className="legend-row">
          <span className="legend-dot dot-high" />
          High Risk
          <strong>{high}%</strong>
        </div>
      </div>
    </div>
  );
}
