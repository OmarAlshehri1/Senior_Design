export default function ManagementEmptyState({ title, description }) {
  return (
    <div className="management-empty-state" role="status">
      <span aria-hidden="true">—</span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  );
}

