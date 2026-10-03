import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { APPLICATION_ROUTES } from '../auth/routeAccess.js';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import UserAdministrativeActions from '../components/UserAdministrativeActions.jsx';
import LoginHistory from '../components/LoginHistory.jsx';
import { userManagementService } from '../management/userManagementService.js';

const Field = ({ label, value }) => <div><dt>{label}</dt><dd>{value ?? '—'}</dd></div>;

export default function UserDetail() {
  const { userId } = useParams();
  const [user, setUser] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const [record, historyPage] = await Promise.all([
      userManagementService.getUser(userId),
      userManagementService.listLoginHistory(userId, { query: { page: 1, page_size: 20 } }),
    ]);
    setUser(record);
    setHistory((historyPage?.items ?? []).map((item) => ({ id: item.id, outcome: item.outcome, timestamp: item.created_at })));
    setError('');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    reload().catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'User information is unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  const runAction = async (action, role = null) => {
    const methods = { disable: 'disableUser', enable: 'enableUser' };
    if (action === 'role') await userManagementService.changeUserRole(userId, role);
    else await userManagementService[methods[action]](userId);
    await reload();
  };

  return (
    <div className="management-page user-detail-page">
      <Link className="back-link" to={APPLICATION_ROUTES.USERS}>Back to User Management</Link>
      <div className="page-header"><div><h1>{user?.name || 'User Detail'}</h1><p>Review identity, access, security, and sign-in activity.</p></div></div>
      {loading && <p role="status">Loading user account…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => { setLoading(true); reload().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false)); }}>Retry</button></p>}
      {!loading && !error && !user && <section className="user-detail-unavailable"><ManagementEmptyState title="User information is unavailable." description={`No user record is available for ${userId}.`} /></section>}
      <div className="user-detail-grid">
        <section className="management-detail-card"><h2>Identity</h2><dl className="management-definition-grid"><Field label="Name" value={user?.name} /><Field label="Email" value={user?.email} /><Field label="Role" value={user?.role} /><Field label="Account Status" value={user?.accountStatus} /></dl></section>
        <section className="management-detail-card"><h2>Access</h2><dl className="management-definition-grid"><Field label="Role" value={user?.role} /><Field label="Team" value={user?.teamId} /><Field label="Supervisor" value={user?.supervisorId} /></dl></section>
        <section className="management-detail-card"><h2>Security</h2><dl className="management-definition-grid"><Field label="Last Login" value={user?.lastLoginAt} /><Field label="Failed Sign-In Attempts" value={user?.failedSignInAttempts} /><Field label="Account Status" value={user?.accountStatus} /><Field label="Status Reason" value={user?.lockReason} /></dl></section>
        <section className="management-detail-card"><h2>Sign-In History</h2><LoginHistory records={history} /></section>
        <UserAdministrativeActions user={user} onAction={(action) => runAction(action)} onRoleChange={(role) => runAction('role', role)} />
      </div>
    </div>
  );
}
