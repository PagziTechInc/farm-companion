import http from 'node:http';
import { readFile } from 'node:fs/promises';
const base = new URL('../dist/', import.meta.url);
const files = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/plan-worker.js', ['plan-worker.js', 'text/javascript']], ['/yield-farm-companion.user.js', ['yield-farm-companion.user.js', 'text/javascript']], ['/farm-companion-chrome.zip', ['farm-companion-chrome.zip', 'application/zip']], ['/INSTALL-CHROME.txt', ['INSTALL-CHROME.txt', 'text/plain']], ['/build.json', ['build.json', 'application/json']]]);
const port = Number(process.env.FARM_PORT || 4173);
const server = http.createServer(async (req, res) => {
  const host = req.headers.host ?? '';
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) { res.writeHead(403); res.end('Invalid host'); return; }
  const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname, file = files.get(path);
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const data = await readFile(new URL(file[0], base));
    res.writeHead(200, { 'Content-Type': file[1] === 'application/zip' ? file[1] : `${file[1]}; charset=utf-8`, ...(file[1] === 'application/zip' ? { 'Content-Disposition': 'attachment; filename="farm-companion-chrome.zip"' } : {}), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.rh.farm; frame-src https://api.rh.farm; worker-src 'self' blob:; font-src 'self' data:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://robinhood-rpc.publicnode.com https://api.rh.farm https://api.coinbase.com https://farm.pagzi.tech; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(503); res.end('Build the dashboard with npm run build.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Yield Farm Companion: http://127.0.0.1:${port}`));
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
