import { auditService } from '../audit/auditService.js';
import { userManagementService } from './userManagementService.js';

const USER_PAGE_SIZE = 100;
const AUDIT_PAGE_SIZE = 8;

async function listAllUsers(service) {
  const firstPage = await service.listUsers({
    query: { page: 1, page_size: USER_PAGE_SIZE },
  });
  const pages = Math.ceil((firstPage.total ?? firstPage.items.length) / USER_PAGE_SIZE);
  if (pages <= 1) return firstPage.items;

  const remaining = await Promise.all(Array.from(
    { length: pages - 1 },
    (_, index) => service.listUsers({
      query: { page: index + 2, page_size: USER_PAGE_SIZE },
    }),
  ));
  return [firstPage, ...remaining].flatMap((page) => page.items);
}

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

function errorMessage(result, fallback) {
  return result.status === 'rejected' ? fallback : null;
}

export async function loadAdminWorkspaceData({
  usersService = userManagementService,
  eventsService = auditService,
  now = new Date(),
} = {}) {
  const [usersResult, loginResult, securityResult, auditResult] = await Promise.allSettled([
    listAllUsers(usersService),
    eventsService.getAuditEvents({
      page: 1,
      page_size: 1,
      action: 'LOGIN_FAILED',
      date: utcDate(now),
    }),
    eventsService.getAuditEvents({
      page: 1,
      page_size: AUDIT_PAGE_SIZE,
      resource_type: 'ACCOUNT',
    }),
    eventsService.getAuditEvents({
      page: 1,
      page_size: AUDIT_PAGE_SIZE,
    }),
  ]);

  const users = usersResult.status === 'fulfilled' ? usersResult.value : null;
  const activeUsers = users?.filter((user) => user.accountStatus === 'ACTIVE').length ?? null;
  const lockedAccounts = users?.filter((user) => user.accountStatus === 'LOCKED').length ?? null;

  return Object.freeze({
    activeUsers,
    lockedAccounts,
    failedLoginsToday: loginResult.status === 'fulfilled'
      ? (loginResult.value.total ?? loginResult.value.items.length)
      : null,
    systemActivity: securityResult.status === 'fulfilled' ? securityResult.value.items : null,
    recentAuditLog: auditResult.status === 'fulfilled' ? auditResult.value.items : null,
    errors: Object.freeze({
      users: errorMessage(usersResult, 'User metrics could not be loaded.'),
      failedLogins: errorMessage(loginResult, 'Sign-in activity could not be loaded.'),
      systemActivity: errorMessage(securityResult, 'Security activity could not be loaded.'),
      recentAuditLog: errorMessage(auditResult, 'Audit log activity could not be loaded.'),
    }),
  });
}
