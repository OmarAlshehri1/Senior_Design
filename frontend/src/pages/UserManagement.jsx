import DateTime from '../components/DateTime.jsx';
import { DISPLAY_TIME_ZONE_LABEL } from '../utils/dateTime.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_DEFINITIONS } from '../auth/roles.js';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import AccessRequestDetails from '../components/AccessRequestDetails.jsx';
import { deriveUserSummary } from '../management/userModel.js';
import { userManagementService } from '../management/userManagementService.js';

export const USER_MANAGEMENT_TABS = Object.freeze([
  Object.freeze({ key: 'users', label: 'Users' }),
  Object.freeze({ key: 'requests', label: 'Access Requests' }),
  Object.freeze({ key: 'unlockRequests', label: 'Unlock Requests' }),
  Object.freeze({ key: 'locked', label: 'Locked Accounts (users page)' }),
  Object.freeze({ key: 'disabled', label: 'Disabled Accounts (users page)' }),
]);

export function UserManagementTabs({ activeTab, counts, onSelect }) {
  const handleKeyDown = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % USER_MANAGEMENT_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + USER_MANAGEMENT_TABS.length) % USER_MANAGEMENT_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = USER_MANAGEMENT_TABS.length - 1;
    else return; // Native button Enter/Space activation remains intact.
    event.preventDefault();
    onSelect(USER_MANAGEMENT_TABS[next].key);
    event.currentTarget.parentElement?.querySelector(`#management-tab-${USER_MANAGEMENT_TABS[next].key}`)?.focus();
  };
  return <div className="management-tabs" role="tablist" aria-label="User management views" aria-orientation="horizontal">
    {USER_MANAGEMENT_TABS.map((tab, index) => <button key={tab.key} id={`management-tab-${tab.key}`} type="button" role="tab"
      aria-selected={activeTab === tab.key} aria-controls={`management-panel-${tab.key}`} tabIndex={activeTab === tab.key ? 0 : -1}
      onKeyDown={(event) => handleKeyDown(event, index)} onClick={() => onSelect(tab.key)}>
      {tab.label}<span>{counts[tab.key] ?? '—'}</span>
    </button>)}
  </div>;
}

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

export function UsersView({ users }) {
  return (
    <>
      <p className="integration-note">Global user search, role/status filters and sorting are not supported by the user service. Browse server pages below.</p>
      <ManagementTable columns={['Name', 'Email', 'Role', 'Status', `Last Login (${DISPLAY_TIME_ZONE_LABEL})`, 'Actions']} rows={users} renderRow={(user) => <tr key={user.id}><td data-label="Name">{displayValue(user.name)}</td><td data-label="Email">{displayValue(user.email)}</td><td data-label="Role">{displayValue(ROLE_DEFINITIONS[user.role]?.displayName)}</td><td data-label="Status">{displayValue(user.accountStatus)}</td><td data-label={`Last Login (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={user.lastLoginAt} compact showZone={false} /></td><td data-label="Actions"><Link className="management-row-action" to={`/users/${user.id}`}>View User</Link></td></tr>} title="No user data is available yet." description="There are no user accounts in this view." />
    </>
  );
}

function RequestsView({ requests, onSelect }) {
  return <ManagementTable columns={['Full Name', 'Work Email', 'Department', 'Employee ID', `Requested At (${DISPLAY_TIME_ZONE_LABEL})`, 'Status', 'Actions']} rows={requests} renderRow={(request) => <tr key={request.id}><td data-label="Full Name">{displayValue(request.fullName)}</td><td data-label="Work Email">{displayValue(request.email)}</td><td data-label="Department">{displayValue(request.department)}</td><td data-label="Employee ID">{displayValue(request.employeeId)}</td><td data-label={`Requested At (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={request.requestedAt} compact showZone={false} /></td><td data-label="Status">{displayValue(request.status)}</td><td data-label="Actions"><button type="button" className="management-row-action" onClick={() => onSelect(request)}>View Request</button></td></tr>} title="No access requests are available yet." description="Submitted requests will remain available here for review and historical reference." />;
}

function UnlockRequestsView({ requests, onDecision }) {
  return <ManagementTable columns={['Account Email', `Requested At (${DISPLAY_TIME_ZONE_LABEL})`, 'Status', 'Actions']} rows={requests} renderRow={(request) => <tr key={request.id}><td data-label="Account Email">{displayValue(request.email)}</td><td data-label={`Requested At (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={request.requested_at} compact showZone={false} /></td><td data-label="Status">{displayValue(request.status)}</td><td data-label="Actions">{request.status === 'PENDING' && <><button type="button" className="management-row-action" onClick={() => onDecision(request.id, true)}>Approve Unlock</button><button type="button" className="management-row-action" onClick={() => onDecision(request.id, false)}>Reject</button></>}</td></tr>} title="No account unlock requests are available." description="Locked account owners can request an unlock; an administrator reviews requests here." />;
}

function LockedView({ users }) {
  return <ManagementTable columns={['User', 'Role', `Locked At (${DISPLAY_TIME_ZONE_LABEL})`, 'Reason', 'Failed Attempts', 'Actions']} rows={users} renderRow={(user) => <tr key={user.id}><td data-label="User">{displayValue(user.name)}</td><td data-label="Role">{displayValue(ROLE_DEFINITIONS[user.role]?.displayName)}</td><td data-label={`Locked At (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={user.lockedAt} compact showZone={false} /></td><td data-label="Reason">{displayValue(user.lockReason)}</td><td data-label="Failed Attempts">{displayValue(user.failedSignInAttempts)}</td><td data-label="Actions"><Link className="management-row-action" to={`/users/${user.id}`}>Review Account</Link></td></tr>} title="No locked accounts on this users page." description="Browse other users pages to inspect additional accounts." />;
}

function DisabledView({ users }) {
  return <ManagementTable columns={['User', 'Role', `Disabled At (${DISPLAY_TIME_ZONE_LABEL})`, 'Reason', 'Actions']} rows={users} renderRow={(user) => <tr key={user.id}><td data-label="User">{displayValue(user.name)}</td><td data-label="Role">{displayValue(ROLE_DEFINITIONS[user.role]?.displayName)}</td><td data-label={`Disabled At (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={user.disabledAt} compact showZone={false} /></td><td data-label="Reason">{displayValue(user.disabledReason)}</td><td data-label="Actions"><Link className="management-row-action" to={`/users/${user.id}`}>Review Account</Link></td></tr>} title="No disabled accounts on this users page." description="Browse other users pages to inspect additional accounts." />;
}

export default function UserManagement() {
  const [activeTab, setActiveTab] = useState('users');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const userPage = usePagedResource(userManagementService.listUsers);
  const requestPage = usePagedResource(userManagementService.listAccessRequests);
  const unlockPage = usePagedResource(userManagementService.listUnlockRequests);
  const [actionError, setActionError] = useState('');
  const users = userPage.items;
  const requests = requestPage.items;
  const unlockRequests = unlockPage.items;
  const current = activeTab === 'requests' ? requestPage : activeTab === 'unlockRequests' ? unlockPage : userPage;
  const loading = current.status === 'loading';
  const error = current.error || actionError;
  const lockedUsers = users.filter((user) => user.accountStatus === 'LOCKED');
  const disabledUsers = users.filter((user) => user.accountStatus === 'DISABLED');
  const summary = deriveUserSummary(userPage.status === 'success' ? users : null);
  const values = [
    ['Total Users', userPage.total], ['Active on users page', summary.active],
    ['Locked on users page', summary.locked], ['Disabled on users page', summary.disabled],
  ];
  const counts = {
    users: userPage.total, requests: requestPage.total, unlockRequests: unlockPage.total,
    locked: userPage.status === 'success' ? lockedUsers.length : null,
    disabled: userPage.status === 'success' ? disabledUsers.length : null,
  };

  const decideRequest = async (decision) => {
    if (!selectedRequest) return;
    await userManagementService.decideAccessRequest(selectedRequest.id, decision);
    setSelectedRequest(null);
    requestPage.resource.load();
    userPage.resource.load();
  };

  const decideUnlock = async (requestId, approve) => {
    try {
      await userManagementService.decideUnlockRequest(requestId, { approve });
      unlockPage.resource.load();
      userPage.resource.load();
      setActionError('');
    } catch (decisionError) {
      setActionError(decisionError instanceof Error ? decisionError.message : 'The unlock request decision could not be saved.');
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
        {error && <p role="alert">{error} <button type="button" onClick={() => { setActionError(''); current.resource.load(); }}>Retry</button></p>}
        {loading && <p role="status">Loading identity records…</p>}
        <UserManagementTabs activeTab={activeTab} counts={counts} onSelect={(key) => { setActiveTab(key); setActionError(''); }} />
        {USER_MANAGEMENT_TABS.map((tab) => <div key={tab.key} id={`management-panel-${tab.key}`} role="tabpanel" hidden={tab.key !== activeTab} tabIndex={0} aria-labelledby={`management-tab-${tab.key}`} className="management-tab-panel">
          {tab.key === activeTab && <>
          {current.status === 'success' && current.items.length === 0 && current.total > 0 && <p>No records on this page. Retry or browse another server page.</p>}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'users' && <UsersView users={users} />}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'requests' && <RequestsView requests={requests} onSelect={setSelectedRequest} />}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'unlockRequests' && <UnlockRequestsView requests={unlockRequests} onDecision={decideUnlock} />}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'locked' && <LockedView users={lockedUsers} />}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'disabled' && <DisabledView users={disabledUsers} />}
          </>}
        </div>)}
        {['locked', 'disabled'].includes(activeTab) && <p className="integration-note">Status subsets apply only to users page {userPage.query.page}. Pagination below browses all users; global status filtering is unavailable.</p>}
        <CollectionPagination collection={current} itemLabel={activeTab === 'requests' ? 'access requests' : activeTab === 'unlockRequests' ? 'unlock requests' : 'users'} />
      </section>
      <AccessRequestDetails request={selectedRequest} onClose={() => setSelectedRequest(null)} onDecision={decideRequest} />
    </div>
  );
}
