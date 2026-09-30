import { Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import TransactionDetail from './pages/TransactionDetail';
import Alerts from './pages/Alerts';
import AuditRules from './pages/AuditRules';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';
import Login from './pages/Login';
import RequestAccess from './pages/RequestAccess';
import ForgotPassword from './pages/ForgotPassword';
import { AccessPending, AccountLocked, AccountDisabled } from './pages/AccessStates';
import Support from './pages/Support';
import PrivacySecurity from './pages/PrivacySecurity';
import { AUTH_ROUTES } from './auth/authRoutes';
import AuthorizationProvider from './auth/AuthorizationProvider';
import RequirePermission from './auth/RequirePermission';
import { APPLICATION_ROUTES, getRoutePermission } from './auth/routeAccess';
import Forbidden from './pages/Forbidden';
import Profile from './pages/Profile';
import AuditLog from './pages/AuditLog';
import UserManagement from './pages/UserManagement';
import UserDetail from './pages/UserDetail';
import TeamActivity from './pages/TeamActivity';

function protectedPage(path, page) {
  return (
    <RequirePermission permission={getRoutePermission(path)}>
      {page}
    </RequirePermission>
  );
}

function ApplicationRoutes() {
  return (
    <Routes>
      <Route path={APPLICATION_ROUTES.DASHBOARD} element={protectedPage(APPLICATION_ROUTES.DASHBOARD, <Dashboard />)} />
      <Route path={APPLICATION_ROUTES.DASHBOARD_ALIAS} element={protectedPage(APPLICATION_ROUTES.DASHBOARD_ALIAS, <Dashboard />)} />
      <Route path={APPLICATION_ROUTES.TRANSACTIONS} element={protectedPage(APPLICATION_ROUTES.TRANSACTIONS, <Transactions />)} />
      <Route path={APPLICATION_ROUTES.TRANSACTION_DETAIL} element={protectedPage(APPLICATION_ROUTES.TRANSACTION_DETAIL, <TransactionDetail />)} />
      <Route path={APPLICATION_ROUTES.ALERTS} element={protectedPage(APPLICATION_ROUTES.ALERTS, <Alerts />)} />
      <Route path={APPLICATION_ROUTES.AUDIT_RULES} element={protectedPage(APPLICATION_ROUTES.AUDIT_RULES, <AuditRules />)} />
      <Route path={APPLICATION_ROUTES.REPORTS} element={protectedPage(APPLICATION_ROUTES.REPORTS, <Reports />)} />
      <Route path={APPLICATION_ROUTES.SETTINGS} element={protectedPage(APPLICATION_ROUTES.SETTINGS, <Settings />)} />
      <Route path={APPLICATION_ROUTES.PROFILE} element={protectedPage(APPLICATION_ROUTES.PROFILE, <Profile />)} />
      <Route path={APPLICATION_ROUTES.AUDIT_LOG} element={protectedPage(APPLICATION_ROUTES.AUDIT_LOG, <AuditLog />)} />
      <Route path={APPLICATION_ROUTES.TEAM_ACTIVITY} element={protectedPage(APPLICATION_ROUTES.TEAM_ACTIVITY, <TeamActivity />)} />
      <Route path={APPLICATION_ROUTES.USERS} element={protectedPage(APPLICATION_ROUTES.USERS, <UserManagement />)} />
      <Route path={APPLICATION_ROUTES.USER_DETAIL} element={protectedPage(APPLICATION_ROUTES.USER_DETAIL, <UserDetail />)} />
      <Route path={APPLICATION_ROUTES.FORBIDDEN} element={<Forbidden />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path={AUTH_ROUTES.LOGIN} element={<Login />} />
      <Route path={AUTH_ROUTES.REQUEST_ACCESS} element={<RequestAccess />} />
      <Route path={AUTH_ROUTES.FORGOT_PASSWORD} element={<ForgotPassword />} />
      <Route path={AUTH_ROUTES.ACCESS_PENDING} element={<AccessPending />} />
      <Route path={AUTH_ROUTES.ACCOUNT_LOCKED} element={<AccountLocked />} />
      <Route path={AUTH_ROUTES.ACCOUNT_DISABLED} element={<AccountDisabled />} />
      <Route path={AUTH_ROUTES.SUPPORT} element={<Support />} />
      <Route path={AUTH_ROUTES.PRIVACY_SECURITY} element={<PrivacySecurity />} />
      <Route
        path="*"
        element={(
          <AuthorizationProvider previewEnabled={import.meta.env.DEV}>
            <AppProvider>
              <Layout>
                <ApplicationRoutes />
              </Layout>
            </AppProvider>
          </AuthorizationProvider>
        )}
      />
    </Routes>
  );
}
