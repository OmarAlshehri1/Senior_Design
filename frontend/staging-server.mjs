// Optional Render staging host for the built SPA. No API proxy or secrets.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

export function createStagingServer(directory = root) {
  const base = resolve(directory);
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end(); return; }
    if (pathname === '/healthz') { response.writeHead(200); response.end('ok'); return; }
    let file = resolve(base, '.' + pathname);
    if (pathname.includes('\0') || (file !== base && !file.startsWith(base + sep))) {
      response.writeHead(403); response.end(); return;
    }
    try {
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        if (pathname.startsWith('/assets/') || extname(pathname)) {
          response.writeHead(404); response.end(); return;
        }
        file = resolve(base, 'index.html');
      }
      const infoFile = await stat(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Content-Length': infoFile.size, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(503); response.end(); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createStagingServer();
  server.listen(port, '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
