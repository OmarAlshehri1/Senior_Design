import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_DEFINITIONS, ROLE_KEYS } from '../auth/roles.js';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import AccessRequestDetails from '../components/AccessRequestDetails.jsx';
import { deriveUserSummary } from '../management/userModel.js';
import { userManagementService } from '../management/userManagementService.js';

export const USER_MANAGEMENT_TABS = Object.freeze([
  Object.freeze({ key: 'users', label: 'Users' }),
  Object.freeze({ key: 'requests', label: 'Access Requests' }),
  Object.freeze({ key: 'unlockRequests', label: 'Unlock Requests' }),
  Object.freeze({ key: 'locked', label: 'Locked Accounts' }),
  Object.freeze({ key: 'disabled', label: 'Disabled Accounts' }),
]);

const displayValue = (value) => value ?? '—';

function ManagementTable({ columns, rows, renderRow, title, description }) {
  return (
    <div className="management-table-wrap">
      <table className="management-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
      {rows.length === 0 && <ManagementEmptyState title={title} description={description} />}
    </div>
  );
}

function UsersView({ users }) {
  return (
    <>
      <div className="management-filters" aria-label="User filters">
        <label><span>Search</span><input type="search" placeholder="Search name or email" /></label>
        <label><span>Role</span><select defaultValue=""><option value="">All roles</option>{Object.values(ROLE_KEYS).map((role) => <option value={role} key={role}>{ROLE_DEFINITIONS[role].displayName}</option>)}</select></label>
        <label><span>Status</span><select defaultValue=""><option value="">All statuses</option><option>Active</option><option>Locked</option><option>Disabled</option></select></label>
        <label><span>Sort</span><select defaultValue="name"><option value="name">Name</option><option value="lastLogin">Last Login</option></select></label>
      </div>
      <ManagementTable columns={['Name', 'Email', 'Role', 'Status', 'Last Login', 'Actions']} rows={users} renderRow={(user) => <tr key={user.id}><td data-label="Name">{displayValue(user.name)}</td><td data-label="Email">{displayValue(user.email)}</td><td data-label="Role">{displayValue(ROLE_DEFINITIONS[user.role]?.displayName)}</td><td data-label="Status">{displayValue(user.accountStatus)}</td><td data-label="Last Login">{displayValue(user.lastLoginAt)}</td><td data-label="Actions"><Link className="management-row-action" to={`/users/${user.id}`}>View User</Link></td></tr>} title="No user data is available yet." description="User accounts will appear here when identity administration is connected." />
    </>
  );
}

function RequestsView({ requests, onSelect }) {
  return <ManagementTable columns={['Full Name', 'Work Email', 'Department', 'Employee ID', 'Requested At', 'Status', 'Actions']} rows={requests} renderRow={(request) => <tr key={request.id}><td data-label="Full Name">{displayValue(request.fullName)}</td><td data-label="Work Email">{displayValue(request.email)}</td><td data-label="Department">{displayValue(request.department)}</td><td data-label="Employee ID">{displayValue(request.employeeId)}</td><td data-label="Requested At">{displayValue(request.requestedAt)}</td><td data-label="Status">{displayValue(request.status)}</td><td data-label="Actions"><button type="button" className="management-row-action" onClick={() => onSelect(request)}>View Request</button></td></tr>} title="No access requests are available yet." description="Submitted requests will remain available here for review and historical reference." />;
}

function UnlockRequestsView({ requests, onDecision }) {
  return <ManagementTable columns={['Account Email', 'Requested At', 'Status', 'Actions']} rows={requests} renderRow={(request) => <tr key={request.id}><td data-label="Account Email">{displayValue(request.email)}</td><td data-label="Requested At">{displayValue(request.requested_at)}</td><td data-label="Status">{displayValue(request.status)}</td><td data-label="Actions">{request.status === 'PENDING' && <><button type="button" className="management-row-action" onClick={() => onDecision(request.id, true)}>Approve Unlock</button><button type="button" className="management-row-action" onClick={() => onDecision(request.id, false)}>Reject</button></>}</td></tr>} title="No account unlock requests are available." description="Locked account owners can request an unlock; an administrator reviews requests here." />;
}

function LockedView({ users }) {
  return <ManagementTable columns={['User', 'Role', 'Locked At', 'Reason', 'Failed Attempts', 'Actions']} rows={users} renderRow={(user) => <tr key={user.id}><td data-label="User">{displayValue(user.name)}</td><td data-label="Role">{displayValue(ROLE_DEFINITIONS[user.role]?.displayName)}</td><td data-label="Locked At">{displayValue(user.lockedAt)}</td><td data-label="Reason">{displayValue(user.lockReason)}</td><td data-label="Failed Attempts">{displayValue(user.failedSignInAttempts)}</td><td data-label="Actions"><Link className="management-row-action" to={`/users/${user.id}`}>Review Account</Link></td></tr>} title="No locked accounts are available." description="Accounts requiring an unlock decision will appear here." />;
}

function DisabledView({ users }) {
  return <ManagementTable columns={['User', 'Role', 'Disabled At', 'Reason', 'Actions']} rows={users} renderRow={(user) => <tr key={user.id}><td data-label="User">{displayValue(user.name)}</td><td data-label="Role">{displayValue(ROLE_DEFINITIONS[user.role]?.displayName)}</td><td data-label="Disabled At">{displayValue(user.disabledAt)}</td><td data-label="Reason">{displayValue(user.disabledReason)}</td><td data-label="Actions"><Link className="management-row-action" to={`/users/${user.id}`}>Review Account</Link></td></tr>} title="No disabled accounts are available." description="Disabled accounts will remain visible for future enablement decisions." />;
}

export default function UserManagement() {
  const [activeTab, setActiveTab] = useState('users');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [unlockRequests, setUnlockRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      userManagementService.listUsers({ query: { page: 1, page_size: 100 } }),
      userManagementService.listAccessRequests({ query: { page: 1, page_size: 100 } }),
      userManagementService.listUnlockRequests({ query: { page: 1, page_size: 100 } }),
    ]).then(([userPage, requestPage, unlockRequestPage]) => {
      if (!active) return;
      setUsers(userPage.items);
      setRequests(requestPage.items);
      setUnlockRequests(unlockRequestPage.items ?? []);
      setError('');
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'User records could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  const lockedUsers = users.filter((user) => user.accountStatus === 'LOCKED');
  const disabledUsers = users.filter((user) => user.accountStatus === 'DISABLED');
  const summary = loading && users.length === 0 ? deriveUserSummary(null) : deriveUserSummary(users);
  const values = [
    ['Total Users', summary.total], ['Active', summary.active],
    ['Locked', summary.locked], ['Disabled', summary.disabled],
  ];
  const collections = { users: users, requests, unlockRequests, locked: lockedUsers, disabled: disabledUsers };

  const decideRequest = async (decision) => {
    if (!selectedRequest) return;
    await userManagementService.decideAccessRequest(selectedRequest.id, decision);
    setSelectedRequest(null);
    setReloadKey((value) => value + 1);
  };

  const decideUnlock = async (requestId, approve) => {
    try {
      await userManagementService.decideUnlockRequest(requestId, { approve });
      setReloadKey((value) => value + 1);
      setError('');
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'The unlock request decision could not be saved.');
    }
  };

  return (
    <div className="management-page user-management-page">
      <div className="page-header">
        <div><h1>User Management</h1><p>Manage system access, roles, and account status.</p></div>
      </div>
      <section className="management-summary" aria-label="User account summary">
        {values.map(([label, value]) => <article key={label}><span>{label}</span><strong aria-label={value === null ? 'Unavailable' : undefined}>{value ?? '—'}</strong></article>)}
      </section>
      <section className="management-surface">
        {error && <p role="alert">{error} <button type="button" onClick={() => { setLoading(true); setReloadKey((value) => value + 1); }}>Retry</button></p>}
        {loading && <p role="status">Loading identity records…</p>}
        <div className="management-tabs" role="tablist" aria-label="User management views">
          {USER_MANAGEMENT_TABS.map((tab) => (
            <button key={tab.key} id={`management-tab-${tab.key}`} type="button" role="tab" aria-selected={activeTab === tab.key} aria-controls={`management-panel-${tab.key}`} tabIndex={activeTab === tab.key ? 0 : -1} onClick={() => setActiveTab(tab.key)}>
              {tab.label}<span>{collections[tab.key].length}</span>
            </button>
          ))}
        </div>
        <div id={`management-panel-${activeTab}`} role="tabpanel" aria-labelledby={`management-tab-${activeTab}`} className="management-tab-panel">
          {activeTab === 'users' && <UsersView users={users} />}
          {activeTab === 'requests' && <RequestsView requests={requests} onSelect={setSelectedRequest} />}
          {activeTab === 'unlockRequests' && <UnlockRequestsView requests={unlockRequests} onDecision={decideUnlock} />}
          {activeTab === 'locked' && <LockedView users={lockedUsers} />}
          {activeTab === 'disabled' && <DisabledView users={disabledUsers} />}
        </div>
      </section>
      <AccessRequestDetails request={selectedRequest} onClose={() => setSelectedRequest(null)} onDecision={decideRequest} />
    </div>
  );
}
