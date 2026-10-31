import DateTime from '../components/DateTime.jsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_DEFINITIONS } from '../auth/roles.js';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import AccessRequestDetails from '../components/AccessRequestDetails.jsx';
import { userManagementService } from '../management/userManagementService.js';
import { PageHeader } from '../components/ui/Layout.jsx';
import { ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { titleCase } from '../components/statusUtils.js';

const ACCOUNT_TONES = Object.freeze({ ACTIVE: 'low', LOCKED: 'medium', DISABLED: 'high', PENDING: 'info', APPROVED: 'low', REJECTED: 'neutral' });
const StatusBadge = ({ value }) => (value ? <span className={`badge badge-${ACCOUNT_TONES[value] ?? 'neutral'}`}>{titleCase(value)}</span> : '—');

export const USER_MANAGEMENT_TABS = Object.freeze([
  Object.freeze({ key: 'users', label: 'Users' }),
  Object.freeze({ key: 'requests', label: 'Access Requests' }),
  Object.freeze({ key: 'unlockRequests', label: 'Unlock Requests' }),
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
    <div className="table-wrap">
      {rows.length === 0 ? <ManagementEmptyState title={title} description={description} /> : <table className="data-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>}
    </div>
  );
}

export function UsersView({ users }) {
  return (
    <ManagementTable columns={['User', 'Role', 'Status', 'Last sign-in', 'Action']} rows={users} renderRow={(user) => <tr key={user.id}>
      <td data-label="User"><span className="cell-primary">{displayValue(user.name)}</span><span className="secondary-metadata">{displayValue(user.email)}</span></td>
      <td data-label="Role">{displayValue(ROLE_DEFINITIONS[user.role]?.displayName)}</td>
      <td data-label="Status"><StatusBadge value={user.accountStatus} /></td>
      <td data-label="Last sign-in"><DateTime value={user.lastLoginAt} compact showZone={false} /></td>
      <td data-label="Action" className="cell-actions"><Link className="btn btn-secondary btn-sm" to={`/users/${user.id}`}>View User</Link></td>
    </tr>} title="No users yet." description="User accounts appear here once access is approved." />
  );
}

function RequestsView({ requests, onSelect }) {
  return <ManagementTable columns={['Requester', 'Department', 'Employee ID', 'Requested', 'Status', 'Action']} rows={requests} renderRow={(request) => <tr key={request.id}>
    <td data-label="Requester"><span className="cell-primary">{displayValue(request.fullName)}</span><span className="secondary-metadata">{displayValue(request.email)}</span></td>
    <td data-label="Department">{displayValue(request.department)}</td>
    <td data-label="Employee ID">{displayValue(request.employeeId)}</td>
    <td data-label="Requested"><DateTime value={request.requestedAt} compact showZone={false} /></td>
    <td data-label="Status"><StatusBadge value={request.status} /></td>
    <td data-label="Action" className="cell-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => onSelect(request)}>Review request</button></td>
  </tr>} title="No access requests." description="New requests appear here for review and stay available for reference." />;
}

function UnlockRequestsView({ requests, onDecision }) {
  return <ManagementTable columns={['Account', 'Requested', 'Status', 'Action']} rows={requests} renderRow={(request) => <tr key={request.id}>
    <td data-label="Account"><span className="cell-primary">{displayValue(request.email)}</span></td>
    <td data-label="Requested"><DateTime value={request.requested_at} compact showZone={false} /></td>
    <td data-label="Status"><StatusBadge value={request.status} /></td>
    <td data-label="Action" className="cell-actions">{request.status === 'PENDING' ? <div className="row-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => onDecision(request.id, true)}>Approve unlock</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => onDecision(request.id, false)}>Reject</button></div> : '—'}</td>
  </tr>} title="No unlock requests." description="Locked users can request an unlock; requests appear here for review." />;
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
  const counts = { users: userPage.total, requests: requestPage.total, unlockRequests: unlockPage.total };

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
    <div className="page user-management-page">
      <PageHeader title="User Management" description="Manage who can access the system and what they can do." />
      <section className="panel panel-table">
        <UserManagementTabs activeTab={activeTab} counts={counts} onSelect={(key) => { setActiveTab(key); setActionError(''); }} />
        {actionError && <p role="alert" className="inline-alert panel-alert">{actionError}</p>}
        {USER_MANAGEMENT_TABS.map((tab) => <div key={tab.key} id={`management-panel-${tab.key}`} role="tabpanel" hidden={tab.key !== activeTab} tabIndex={0} aria-labelledby={`management-tab-${tab.key}`} className="tab-panel">
          {tab.key === activeTab && <>
          {loading && <LoadingState message="Loading records…" />}
          {current.status === 'error' && <ErrorState title="Records could not be loaded." message={current.error} onRetry={() => current.resource.load()} />}
          {current.status === 'success' && current.items.length === 0 && current.total > 0 && <p className="inline-status panel-alert">No records on this page. Go back a page or refresh.</p>}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'users' && <UsersView users={users} />}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'requests' && <RequestsView requests={requests} onSelect={setSelectedRequest} />}
          {current.status === 'success' && !(current.items.length === 0 && current.total > 0) && activeTab === 'unlockRequests' && <UnlockRequestsView requests={unlockRequests} onDecision={decideUnlock} />}
          </>}
        </div>)}
        <CollectionPagination collection={current} itemLabel={activeTab === 'requests' ? 'access requests' : activeTab === 'unlockRequests' ? 'unlock requests' : 'users'} />
      </section>
      <AccessRequestDetails request={selectedRequest} onClose={() => setSelectedRequest(null)} onDecision={decideRequest} />
    </div>
  );
}
