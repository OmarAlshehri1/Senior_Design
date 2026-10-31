import { EmptyState } from './RequestStateView.jsx';

export default function ManagementEmptyState({ title, description, filtered = false, action = null }) {
  return <EmptyState compact title={title} message={description} filtered={filtered} action={action} />;
}
