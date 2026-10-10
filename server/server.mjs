// Ghost registry: stores the wrecks of fallen pilots so other players can fight them as bosses.
// Zero dependencies. In production it also serves the built client from dist/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGhost, validateDaily, isDateKey, cleanCallsign, utcDateKey, rateLimiter } from './validate.mjs';
import { createBoard, BOARD_TOP } from './daily.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.GHOST_DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'ghosts.json');
const DAILY_FILE = path.join(DATA_DIR, 'daily.json');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8787);
const MAX_GHOSTS = 5000;
const MAX_BODY = 32 * 1024;
const MAX_DAILY_BODY = 2 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
let ghosts = [];
try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (Array.isArray(raw)) ghosts = raw.map(validateGhost).filter(Boolean);
} catch { ghosts = []; }
let daily;
try { daily = createBoard(JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'))); } catch { daily = createBoard(); }
daily.prune(utcDateKey());

/** Debounced atomic write (tmp + rename) of one data file. */
function writer(file, data) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data()));
      fs.renameSync(tmp, file);
    }, 200);
  };
}
const persist = writer(DATA_FILE, () => ghosts);
const persistDaily = writer(DAILY_FILE, () => daily);
// Daily roster: 12 filings an hour per address, 5 s apart (a run ends at most once every few minutes).
const dailyLimit = rateLimiter({ max: Number(process.env.DAILY_RATE_MAX) || 12, windowMs: 60 * 60_000, gapMs: 5_000 });

const lastPost = new Map();
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sample(arr, n) {
  if (arr.length <= n) return arr.slice();
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!p.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('Build the client first: npm run build'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, ghosts: ghosts.length });
  if (url.pathname === '/api/ghosts' && req.method === 'GET') {
    const sector = Number(url.searchParams.get('sector'));
    if (!Number.isInteger(sector) || sector < 1 || sector > 99) return json(res, 400, { error: 'sector must be an integer from 1 to 99' });
    const list = ghosts.filter((g) => g.sector === sector);
    return json(res, 200, { count: list.length, ghosts: sample(list, 40) });
  }
  if (url.pathname === '/api/ghosts' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '?';
    const now = Date.now();
    if (now - (lastPost.get(ip) || 0) < 3000) return json(res, 429, { error: 'Too many wrecks from this address. Try again in a few seconds.' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'Body must be JSON under 32 KB.' }); }
    const g = validateGhost({ ...body, at: now });
    if (!g) return json(res, 400, { error: 'That ship layout is not valid.' });
    lastPost.set(ip, now);
    ghosts.push(g);
    if (ghosts.length > MAX_GHOSTS) ghosts.splice(0, ghosts.length - MAX_GHOSTS);
    persist();
    return json(res, 201, { ok: true, id: g.id, sectorCount: ghosts.filter((x) => x.sector === g.sector).length });
  }
  const dm = url.pathname.match(/^\/api\/daily\/([^/]+)$/);
  if (dm && req.method === 'GET') {
    const date = dm[1];
    if (!isDateKey(date)) return json(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    const n = Math.max(1, Math.min(BOARD_TOP, Number(url.searchParams.get('limit')) || BOARD_TOP));
    return json(res, 200, { today: utcDateKey(), ...daily.top(date, n, cleanCallsign(url.searchParams.get('callsign') ?? '')) });
  }
  if (url.pathname === '/api/daily' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '?';
    const now = Date.now();
    const wait = dailyLimit.hit(ip, now);
    if (wait) { res.setHeader('retry-after', String(Math.ceil(wait / 1000))); return json(res, 429, { error: 'Too many filings from this address. Try again shortly.' }); }
    let body;
    try { body = JSON.parse(await readBody(req, MAX_DAILY_BODY)); } catch { return json(res, 400, { error: 'Body must be JSON under 2 KB.' }); }
    const v = validateDaily(body, now);
    if (v.error) return json(res, 400, { error: v.error });
    const r = daily.submit(v.entry);
    if (r.improved) { daily.prune(utcDateKey(now)); persistDaily(); }
    return json(res, r.improved ? 201 : 200, { ok: true, improved: r.improved, rank: r.rank, count: r.count, entry: r.entry });
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  if (process.env.NODE_ENV === 'production') return serveStatic(req, res);
  res.writeHead(404); res.end('API server. Run the client with npm run dev.');
});

server.listen(PORT, () => console.log(`[ghost-registry] listening on http://localhost:${PORT} (${ghosts.length} ghosts)`));
