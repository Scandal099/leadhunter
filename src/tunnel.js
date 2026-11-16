// HTTPS-адрес для Telegram Mini App. Telegram открывает мини-приложения только по https,
// поэтому поднимаем бесплатный туннель Cloudflare (cloudflared, без регистрации).
// Адрес меняется при каждом запуске — бот сам обновляет кнопку меню.
// Свой постоянный адрес можно задать в .env: MINIAPP_URL=https://... ; отключить туннель: TUNNEL=off
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let child = null;
let stopped = false;

function findBin() {
  const exeDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
  const cands = [
    process.env.CLOUDFLARED,
    path.join(exeDir, 'cloudflared.exe'),
    path.join(exeDir, 'bin', 'cloudflared.exe'),
    path.join(__dirname, '..', 'bin', 'cloudflared.exe'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ].filter(Boolean);
  return cands.find((c) => fs.existsSync(c)) || 'cloudflared';
}

function start(port, onUrl) {
  if (process.env.MINIAPP_URL) { onUrl(process.env.MINIAPP_URL); return; }
  if (/^(0|off|false|no)$/i.test(process.env.TUNNEL || '')) { console.log('  Туннель выключен (TUNNEL=off) — мини-апп доступен только на ПК'); return; }
  const bin = findBin();
  let fails = 0;
  const run = () => {
    if (stopped) return;
    let url = '', ready = false, missing = false;
    // --protocol http2: у многих провайдеров UDP/QUIC режется, и туннель так и не подключается (Error 1033)
    child = spawn(bin, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], { windowsHide: true });
    let buf = '';
    const markReady = () => {
      if (ready || !url) return;
      ready = true; fails = 0;
      console.log(`  Туннель для мини-аппа →  ${url}`);
      onUrl(url);
    };
    const onData = (d) => {
      // строки cloudflared могут приходить кусками — ищем по накопленному тексту
      buf = (buf + String(d)).slice(-20000);
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !url) { url = m[0]; probe(); }
      // адрес отдаём боту только когда туннель реально подключился, иначе в Telegram будет Error 1033
      if (/Registered tunnel connection/i.test(buf)) markReady();
    };
    // запасной путь: сами проверяем, что адрес открывается
    const probe = async () => {
      for (let i = 0; i < 30 && !ready && !stopped && child; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try { const r = await fetch(url + '/tg/', { signal: AbortSignal.timeout(8000) }); if (r.ok) return markReady(); } catch {}
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => {
      missing = true;
      console.error(`  Мини-апп недоступен из Telegram: не найден cloudflared (${e.message}). Установи его или задай MINIAPP_URL в .env`);
    });
    child.on('exit', () => {
      child = null;
      if (stopped || missing) return;
      fails++;
      const wait = Math.min(60000, 5000 * fails);
      console.error(`  Туннель отключился, перезапуск через ${wait / 1000} с`);
      setTimeout(run, wait);
    });
  };
  run();
}

function stop() {
  stopped = true;
  if (child) { try { child.kill(); } catch {} child = null; }
}

module.exports = { start, stop };
