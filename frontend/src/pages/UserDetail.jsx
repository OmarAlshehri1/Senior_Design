import { Link, useParams } from 'react-router-dom';
import { APPLICATION_ROUTES } from '../auth/routeAccess.js';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import UserAdministrativeActions from '../components/UserAdministrativeActions.jsx';

const Field = ({ label }) => <div><dt>{label}</dt><dd>—</dd></div>;

export default function UserDetail() {
  const { userId } = useParams();

  return (
    <div className="management-page user-detail-page">
      <Link className="back-link" to={APPLICATION_ROUTES.USERS}>Back to User Management</Link>
      <div className="page-header"><div><h1>User Detail</h1><p>Review identity, access, security, and account activity.</p></div></div>
      <section className="user-detail-unavailable" aria-labelledby="user-unavailable-heading">
        <ManagementEmptyState title="User information is unavailable." description={`No user record is available for ${userId}.`} />
      </section>
      <div className="user-detail-grid">
        <section className="management-detail-card"><h2>Identity</h2><dl className="management-definition-grid"><Field label="Name" /><Field label="Email" /><Field label="Role" /><Field label="Account Status" /></dl></section>
        <section className="management-detail-card"><h2>Access</h2><dl className="management-definition-grid"><Field label="Role" /><Field label="Team" /><Field label="Supervisor" /></dl></section>
        <section className="management-detail-card"><h2>Security</h2><dl className="management-definition-grid"><Field label="Last Login" /><Field label="Failed Sign-In Attempts" /><Field label="Account Status" /></dl></section>
        <section className="management-detail-card"><h2>Activity</h2><div className="detail-empty-row"><span>Recent Reviews</span><strong>—</strong></div><div className="detail-empty-row"><span>Recent Audit Activity</span><strong>—</strong></div></section>
        <UserAdministrativeActions />
      </div>
    </div>
  );
}
