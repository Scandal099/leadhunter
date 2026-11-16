// LeadHunter — локальный сервер: API + веб-интерфейс + Telegram-бот (в одном процессе, общая база)
if (process.pkg) {
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'node:inspector' || request === 'inspector') return { url: () => undefined, open: () => {}, close: () => {} };
    return origLoad.apply(this, arguments);
  };
}
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
try { process.loadEnvFile(path.join(APP_DIR, '.env')); } catch {} // TELEGRAM_BOT_TOKEN и пр.
const db = require('./src/db');
const jobs = require('./src/jobs');
const enrich = require('./src/enrich');
const demos = require('./src/demos');
const { closeBrowser } = require('./src/browser');

const PORT = +process.env.PORT || 3777;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const clients = new Set();
const broadcastSSE = (type, data) => {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
};
jobs.subscribe(broadcastSSE);
db.subscribe(broadcastSSE);
enrich.subscribe(broadcastSSE);

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const { toCsv, toMarkdown, toAiJson, HOT, siteStatus } = require('./src/leadUtil');
const bot = require('./src/telegram');
const tunnel = require('./src/tunnel');

// Запросы с этого ПК (localhost) — как раньше, без пароля.
// Всё, что пришло через туннель (Telegram Mini App), пускаем только с подписью Telegram от владельца бота.
function isLocalReq(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '[::1]'].includes(host) && !req.headers['cf-connecting-ip'] && !req.headers['cf-ray'];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    const local = isLocalReq(req);
    const tgUser = bot.checkInitData(req.headers['x-tg-init-data'] || url.searchParams.get('tg'));
    if (!local) {
      if (p.startsWith('/api/')) { if (!tgUser) return send(res, 401, { error: 'Нет доступа: открой приложение из Telegram-бота' }); }
      else if (p !== '/tg/' && !p.startsWith('/tg/')) { res.writeHead(302, { Location: '/tg/' }); return res.end(); }
    }
    if (p === '/tg') { res.writeHead(302, { Location: '/tg/' }); return res.end(); }

    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: job\ndata: ${JSON.stringify(jobs.getJob())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (p === '/api/leads' && req.method === 'GET') return send(res, 200, db.getLeads());
    if (p === '/api/leads/delete' && req.method === 'POST') {
      const b = await readBody(req); db.deleteLeads(b.ids || []);
      jobs.notify('deleted', { ids: b.ids || [] });
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/leads/') && req.method === 'PATCH') {
      const l = db.updateLead(p.split('/').pop(), await readBody(req));
      if (l) jobs.notifyLead(l); // чтобы изменение сразу увидели и ПК, и Telegram
      return l ? send(res, 200, l) : send(res, 404, { error: 'not found' });
    }
    if (p === '/api/parse' && req.method === 'POST') {
      try { return send(res, 200, await jobs.start(await readBody(req))); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p === '/api/stop' && req.method === 'POST') { jobs.stop(); return send(res, 200, { ok: true }); }
    if (p === '/api/recheck' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, { queued: jobs.recheck(b.ids) }); }
    if (p === '/api/enrich' && req.method === 'POST') {
      try {
        const b = await readBody(req);
        return send(res, 200, await enrich.start(b.ids || [], { targetStatus: b.targetStatus || 'base', headless: typeof b.headless === 'boolean' ? b.headless : undefined }));
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p === '/api/enrich/stop' && req.method === 'POST') { enrich.stop(); return send(res, 200, { ok: true }); }
    if (p === '/api/demos/generate' && req.method === 'POST') {
      try {
        const b = await readBody(req);
        const r = demos.generateBatch(b.ids, { baseUrl: b.baseUrl });
        for (const item of r.results) jobs.notifyLead(db.getLead(item.id));
        return send(res, 200, r);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p === '/api/job') return send(res, 200, { job: jobs.getJob(), logs: jobs.getLogs(), checks: jobs.checkStats(), enrich: enrich.getState() });
    if (p === '/api/settings') {
      if (req.method === 'POST') return send(res, 200, db.setSettings(await readBody(req)));
      return send(res, 200, db.getSettings());
    }
    if (p === '/api/cloud/status' && req.method === 'GET') return send(res, 200, db.getCloudStatus());
    if (p === '/api/cloud/sync' && req.method === 'POST') return send(res, 200, await db.syncCloud());
    if (p === '/api/export.csv') {
      const ids = url.searchParams.get('ids');
      let list = db.getLeads();
      if (ids) { const s = new Set(ids.split(',')); list = list.filter((l) => s.has(l.id)); }
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end(toCsv(list, db.getSettings()));
    }
    if (p === '/api/export.ai.json') {
      const ids = url.searchParams.get('ids');
      let list = db.getLeads();
      if (ids) { const s = new Set(ids.split(',')); list = list.filter((l) => s.has(l.id)); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-ai-${new Date().toISOString().slice(0, 10)}.json"` });
      return res.end(JSON.stringify(toAiJson(list, db.getSettings()), null, 2));
    }
    if (p === '/api/export.ai.md') {
      const ids = url.searchParams.get('ids');
      let list = db.getLeads();
      if (ids) { const s = new Set(ids.split(',')); list = list.filter((l) => s.has(l.id)); }
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-ai-${new Date().toISOString().slice(0, 10)}.md"` });
      return res.end(toMarkdown(list, db.getSettings(), 'AI-пакет лидов'));
    }
    // Mini App: файл CSV приходит в чат с ботом (скачивание внутри Telegram работает ненадёжно)
    if (p === '/api/tg/export' && req.method === 'POST') {
      const b = await readBody(req);
      let list = db.getLeads();
      if (Array.isArray(b.ids)) { const s = new Set(b.ids); list = list.filter((l) => s.has(l.id)); }
      else if (b.which === 'hot') list = list.filter((l) => HOT.has(siteStatus(l)) && l.status === 'new');
      if (!list.length) return send(res, 400, { error: 'Нечего выгружать' });
      try { await bot.sendCsv(tgUser?.id, list, b.title || 'Выгрузка'); return send(res, 200, { ok: true, count: list.length }); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    // локальные демо-сайты (/demos/...)
    if (p === '/demos' || p.startsWith('/demos/')) {
      const rel = p.replace(/^\/demos\/?/, '');
      let df = path.normalize(path.join(demos.DEMOS_DIR, rel === '' ? 'index.html' : rel.endsWith('/') ? rel + 'index.html' : rel));
      if (!df.startsWith(demos.DEMOS_DIR) || !fs.existsSync(df)) return send(res, 404, { error: 'demo not found' });
      if (fs.statSync(df).isDirectory()) df = path.join(df, 'index.html');
      if (!fs.existsSync(df)) return send(res, 404, { error: 'demo not found' });
      return send(res, 200, fs.readFileSync(df), MIME[path.extname(df)] || 'text/html; charset=utf-8');
    }
    // статика
    const isTg = p.startsWith('/tg/');
    let f = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, isTg ? 'tg/index.html' : 'index.html');
    send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  LeadHunter запущен →  http://localhost:${PORT}`);
  console.log(`  Мини-апп на ПК     →  http://localhost:${PORT}/tg/\n`);
  db.startCloudSync();
  bot.start();
  tunnel.start(PORT, (base) => bot.setAppUrl(base.replace(/\/+$/, '') + '/tg/'));
  if (process.pkg || process.env.AUTO_OPEN === '1') {
    const url = `http://localhost:${PORT}`;
    if (process.platform === 'win32') exec(`start "" "${url}"`);
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { bot.stop(); tunnel.stop(); db.stopCloudSync(); await db.flushCloud().catch(() => {}); db.saveNow(); await closeBrowser(); process.exit(0); });
process.on('exit', () => tunnel.stop());
