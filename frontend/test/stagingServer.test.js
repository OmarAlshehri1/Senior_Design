import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { createStagingServer } from '../staging-server.mjs';

test('staging SPA host serves deep links, assets and HEAD without exposing outside files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm004-staging-host-'));
  const root = join(directory, 'dist');
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<html>SPA</html>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("staging")');
  await writeFile(join(directory, 'private.txt'), 'PRIVATE');
  const server = createStagingServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/imports', '/feed-review', '/auth/login']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '<html>SPA</html>');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const asset = await fetch(base + '/assets/app.js');
    assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    assert.equal((await fetch(base + '/imports', { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(base + '/imports', { method: 'POST' })).status, 405);
    assert.notEqual(await (await fetch(base + '/%2e%2e%2fprivate.txt')).text(), 'PRIVATE');
  } finally {
    await new Promise((done) => server.close(done));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
