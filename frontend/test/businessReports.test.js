import test from 'node:test';
import assert from 'node:assert/strict';
import { businessReportRequest, createBusinessReportsService } from '../src/services/businessReportsService.js';

test('business reports choose latest scope day or an exact UTC day without timezone drift', () => {
  assert.deepEqual(businessReportRequest(), { data_context: 'UNVERIFIED' });
  assert.deepEqual(businessReportRequest({ day: '2026-10-03', recipient: ' Management ', dataContext: 'DEMONSTRATION' }), {
    data_context: 'DEMONSTRATION', recipient: 'Management',
    period_start: '2026-10-03T00:00:00.000Z', period_end: '2026-10-04T00:00:00.000Z',
  });
  assert.throws(() => businessReportRequest({ day: '2026-02-30' }), /valid UTC day/);
  assert.equal(businessReportRequest({ useGemini: false }).use_gemini, false);
  assert.equal(businessReportRequest({ useGemini: true }).use_gemini, true);
});

test('business report creation, scoped pagination, preview and both downloads use authenticated transport', async () => {
  const calls = [];
  const source = { id:'report-1',document:{ approval_status:'DRAFT',metrics:{total_transactions:9} } };
  const service = createBusinessReportsService({
    get: async (...args) => { calls.push(['GET',...args]); return source; },
    post: async (...args) => { calls.push(['POST',...args]); return source; },
    getFile: async (...args) => { calls.push(['FILE',...args]); return new Blob(['saved snapshot']); },
  });
  const generated = await service.create({ dataContext:'DEMONSTRATION' });
  assert.equal(generated,source);
  await service.list({query:{page:2,page_size:10}});
  assert.equal(await service.get('report-1'),source);
  assert.equal(await (await service.download('report-1','html')).text(),'saved snapshot');
  await service.download('report-1','xlsx');
  assert.deepEqual(calls.map(([method,path])=>[method,path]),[
    ['POST','/reports/business'],['GET','/reports/business'],['GET','/reports/business/report-1'],
    ['FILE','/reports/business/report-1/download'],['FILE','/reports/business/report-1/download'],
  ]);
  assert.deepEqual(calls[3][2].query,{format:'html'});
  assert.deepEqual(calls[4][2].query,{format:'xlsx'});
  assert.throws(()=>service.download('report-1','pdf'),/Unsupported/);
  assert.throws(()=>service.get(''),/Select/);
});
