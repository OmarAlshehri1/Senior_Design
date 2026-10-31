import DateTime from '../components/DateTime.jsx';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { APPLICATION_ROUTES } from '../auth/routeAccess.js';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import UserAdministrativeActions from '../components/UserAdministrativeActions.jsx';
import LoginHistory from '../components/LoginHistory.jsx';
import { userManagementService } from '../management/userManagementService.js';
import { Panel } from '../components/ui/Layout.jsx';
import { ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { ArrowLeftIcon } from '../components/icons.jsx';
import { titleCase } from '../components/statusUtils.js';
import { shortReference } from '../utils/presentation.js';
import { ROLE_DEFINITIONS } from '../auth/roles.js';

const Field = ({ label, value }) => <div><dt>{label}</dt><dd>{value ?? '—'}</dd></div>;
const ACCOUNT_TONES = Object.freeze({ ACTIVE: 'low', LOCKED: 'medium', DISABLED: 'high' });

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

  const retry = () => { setLoading(true); reload().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false)); };
  return (
    <div className="page user-detail-page">
      <header className="detail-header">
        <Link className="back-link" to={APPLICATION_ROUTES.USERS}><ArrowLeftIcon width={15} height={15} aria-hidden="true" />User Management</Link>
        <div className="detail-header-copy">
          <p className="page-eyebrow">User</p>
          <h1>{user?.name || 'User Detail'}</h1>
          {user && <div className="detail-title-row"><span className="badge badge-info">{ROLE_DEFINITIONS[user.role]?.displayName ?? titleCase(user.role)}</span><span className={`badge badge-${ACCOUNT_TONES[user.accountStatus] ?? 'neutral'}`}>{titleCase(user.accountStatus)}</span><span className="muted">{user.email}</span></div>}
        </div>
      </header>
      {loading && <section className="panel"><LoadingState message="Loading user account…" /></section>}
      {error && <section className="panel"><ErrorState title="User information is unavailable." message={error} onRetry={retry} /></section>}
      {!loading && !error && !user && <section className="panel"><ManagementEmptyState title="User information is unavailable." description={`No user record is available for ${userId}.`} /></section>}
      {!loading && user && <div className="detail-layout">
        <div className="detail-main">
          <Panel id="user-identity-heading" title="Identity and access"><dl className="key-values columns-2"><Field label="Name" value={user.name} /><Field label="Email" value={user.email} /><Field label="Role" value={ROLE_DEFINITIONS[user.role]?.displayName ?? user.role} /><Field label="Account status" value={titleCase(user.accountStatus)} /><Field label="Team" value={user.teamId && <span className="reference-text" title={user.teamId}>{shortReference(user.teamId)}</span>} /><Field label="Supervisor" value={user.supervisorId && <span className="reference-text" title={user.supervisorId}>{shortReference(user.supervisorId)}</span>} /></dl></Panel>
          <Panel id="user-security-heading" title="Security"><dl className="key-values columns-2"><Field label="Last sign-in" value={<DateTime value={user.lastLoginAt} />} /><Field label="Failed sign-in attempts" value={user.failedSignInAttempts} /><Field label="Status reason" value={user.lockReason} /></dl></Panel>
          <Panel id="user-history-heading" title="Sign-in history"><LoginHistory records={history} /></Panel>
        </div>
        <aside className="detail-side"><UserAdministrativeActions user={user} onAction={(action) => runAction(action)} onRoleChange={(role) => runAction('role', role)} /></aside>
      </div>}
    </div>
  );
}
