// Запуск браузера (Edge или Chrome, установленные в системе) с постоянным профилем,
// чтобы куки сохранялись между запусками и карты реже показывали капчу.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { DATA_DIR } = require('./db');

let ctx = null;
let ctxHeadless = null;

function detectChannel() {
  const pf = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean);
  const has = (rel) => pf.some((p) => fs.existsSync(path.join(p, rel)));
  if (has('Google/Chrome/Application/chrome.exe')) return 'chrome';
  if (has('Microsoft/Edge/Application/msedge.exe')) return 'msedge';
  if (process.platform === 'darwin') return 'chrome';
  return 'msedge';
}

async function getContext(headless) {
  if (ctx && ctxHeadless === headless) return ctx;
  if (ctx) await ctx.close().catch(() => {});
  const channel = detectChannel();
  ctx = await chromium.launchPersistentContext(path.join(DATA_DIR, 'browser-profile'), {
    channel,
    headless,
    locale: 'ru-RU',
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  ctxHeadless = headless;
  ctx.on('close', () => { ctx = null; });
  return ctx;
}

async function closeBrowser() {
  if (ctx) await ctx.close().catch(() => {});
  ctx = null;
}

module.exports = { getContext, closeBrowser };
