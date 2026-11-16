import test from 'node:test';
import assert from 'node:assert/strict';
import { createCasesService } from '../src/services/casesService.js';

test('scan retry uses the scoped authenticated API without exposing an object URL', async () => {
  const calls = [];
  const service = createCasesService({post:async (...args)=>{calls.push(args);return {scan_status:'ERROR'};}});
  assert.equal((await service.rescanCaseEvidence('case /1','evidence /2')).scan_status,'ERROR');
  assert.equal(calls[0][0],'/cases/case%20%2F1/evidence/evidence%20%2F2/scan');
  assert.deepEqual(calls[0][1],{});
});
