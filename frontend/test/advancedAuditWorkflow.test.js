import test from 'node:test';
import assert from 'node:assert/strict';

import { CASE_PRIORITIES, CASE_STATUSES, CASE_STATUS_META, normalizeCase, normalizeCases } from '../src/cases/caseModel.js';
import { EVIDENCE_CATEGORIES, normalizeComment, normalizeComments, normalizeEvidence, normalizeEvidenceCollection } from '../src/cases/caseArtifacts.js';
import { REVIEW_RESOLUTIONS, SLA_STATUSES, getSlaPresentation, normalizeResolution } from '../src/cases/caseWorkflow.js';
import { VENDOR_STATUSES, VENDOR_STATUS_META, WATCHLIST_REQUEST_STATUSES, normalizeVendor, normalizeVendorRequest, normalizeVendors } from '../src/vendors/vendorModel.js';
import { AUDIT_COVERAGE_RULES, ANALYTICS_PERIODS, createAuditCoverage, createTrendModel } from '../src/analytics/analyticsModels.js';
import { casesService } from '../src/services/casesService.js';
import { vendorsService } from '../src/services/vendorsService.js';
import { analyticsService } from '../src/services/analyticsService.js';
import { APPLICATION_ROUTES, ROUTE_ACCESS_RESULTS, resolvePreviewRouteAccess } from '../src/auth/routeAccess.js';
import { PERMISSIONS, ROLE_KEYS, hasPermission } from '../src/auth/roles.js';
import { getNavigationState } from '../src/auth/navigationConfig.js';

test('case statuses and priorities are centralized and presentation metadata is complete', () => {
  assert.deepEqual(Object.values(CASE_STATUSES), ['OPEN', 'INVESTIGATING', 'ESCALATED', 'RESOLUTION_REQUESTED', 'RESOLVED', 'CLOSED']);
  assert.deepEqual(Object.values(CASE_PRIORITIES), ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  assert.deepEqual(Object.keys(CASE_STATUS_META), Object.values(CASE_STATUSES));
});

test('case model is null-safe, immutable, and accepts empty collections', () => {
  const input = { id: 'C-1', status: CASE_STATUSES.OPEN, priority: CASE_PRIORITIES.HIGH };
  const snapshot = structuredClone(input);
  const result = normalizeCase(input);
  assert.equal(result.vendorId, null);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(input, snapshot);
  assert.deepEqual(normalizeCases(), []);
  assert.equal(normalizeCase({ status: 'UNKNOWN', priority: 'HIGH' }), null);
});

test('resolution and SLA vocabularies are exact and unavailable SLA remains truthful', () => {
  assert.deepEqual(Object.values(REVIEW_RESOLUTIONS), ['NO_ISSUE_FOUND', 'ISSUE_CONFIRMED', 'FALSE_POSITIVE', 'NEEDS_INVESTIGATION']);
  assert.deepEqual(Object.values(SLA_STATUSES), ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'COMPLETED']);
  assert.equal(getSlaPresentation().label, '—');
  assert.equal(normalizeResolution({ outcome: REVIEW_RESOLUTIONS.FALSE_POSITIVE }).note, null);
});

test('evidence and comment contracts preserve metadata without fake records', () => {
  assert.deepEqual(EVIDENCE_CATEGORIES, ['DOCUMENT', 'SCREENSHOT', 'INVOICE', 'APPROVAL_RECORD', 'OTHER']);
  assert.equal(normalizeEvidence({ category: 'DOCUMENT', fileName: 'record.pdf' }).fileName, 'record.pdf');
  assert.equal(normalizeEvidence({ category: 'EXECUTABLE' }), null);
  assert.equal(normalizeComment({ message: 'Review context' }).createdAt, null);
  assert.deepEqual(normalizeEvidenceCollection(), []);
  assert.deepEqual(normalizeComments(), []);
});

test('case permissions separate investigation work from final closure approval', () => {
  assert.equal(hasPermission(ROLE_KEYS.AUDITOR, PERMISSIONS.REQUEST_CASE_CLOSURE), true);
  assert.equal(hasPermission(ROLE_KEYS.AUDITOR, PERMISSIONS.APPROVE_CASE_CLOSURE), false);
  assert.equal(hasPermission(ROLE_KEYS.SUPERVISOR, PERMISSIONS.APPROVE_CASE_CLOSURE), true);
  assert.equal(hasPermission(ROLE_KEYS.ADMIN, PERMISSIONS.APPROVE_CASE_CLOSURE), true);
});

test('case and vendor routes are available to all roles and navigation is centralized', () => {
  for (const role of Object.values(ROLE_KEYS)) {
    assert.equal(resolvePreviewRouteAccess('/cases', role), ROUTE_ACCESS_RESULTS.ALLOWED);
    assert.equal(resolvePreviewRouteAccess('/cases/C-1', role), ROUTE_ACCESS_RESULTS.ALLOWED);
    assert.equal(resolvePreviewRouteAccess('/vendors', role), ROUTE_ACCESS_RESULTS.ALLOWED);
    assert.equal(resolvePreviewRouteAccess('/vendors/V-1', role), ROUTE_ACCESS_RESULTS.ALLOWED);
  }
  const groups = getNavigationState(ROLE_KEYS.AUDITOR);
  assert.ok(groups.find((group) => group.label === 'Monitoring').links.some((link) => link.to === APPLICATION_ROUTES.VENDORS));
  assert.equal(groups.find((group) => group.label === 'Management').links[0].to, APPLICATION_ROUTES.CASES);
});

test('vendor models use monitoring-safe vocabulary and null-safe profiles', () => {
  assert.deepEqual(Object.values(VENDOR_STATUSES), ['NORMAL', 'WATCHLISTED', 'BLOCKED']);
  assert.equal(VENDOR_STATUS_META.BLOCKED.transactionLabel, 'Blocked in Audit Monitoring');
  const vendor = normalizeVendor({ id: 'V-1', monitoringStatus: VENDOR_STATUSES.NORMAL });
  assert.equal(vendor.averageRiskScore, null);
  assert.deepEqual(normalizeVendors(), []);
  assert.equal(normalizeVendorRequest({ status: WATCHLIST_REQUEST_STATUSES.PENDING }).reviewedAt, null);
});

test('audit coverage and trend models stay empty without authoritative analytics', () => {
  assert.equal(AUDIT_COVERAGE_RULES.length, 5);
  assert.deepEqual(ANALYTICS_PERIODS, ['7_DAYS', '30_DAYS', '90_DAYS']);
  const coverage = createAuditCoverage();
  assert.equal(coverage.coveragePercentage, null);
  assert.deepEqual(coverage.byRule, []);
  assert.deepEqual(createTrendModel().series, []);
});

test('new service boundaries reject every operation without fabricating success', async () => {
  const operations = [...Object.values(casesService), ...Object.values(vendorsService), ...Object.values(analyticsService)];
  const results = await Promise.allSettled(operations.map((operation) => operation()));
  assert.ok(results.every((result) => result.status === 'rejected'));
});
