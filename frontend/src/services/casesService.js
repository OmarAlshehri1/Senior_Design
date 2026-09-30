import { unavailableOperation } from './unavailableService.js';

const unavailable = unavailableOperation('Case management');
export const casesService = Object.freeze({
  listCases: unavailable, getCase: unavailable, createCase: unavailable, assignCase: unavailable,
  updateCaseStatus: unavailable, addCaseEvidence: unavailable, addCaseComment: unavailable,
  requestCaseClosure: unavailable, approveCaseClosure: unavailable, rejectCaseClosure: unavailable,
  getCaseActivity: unavailable,
});
