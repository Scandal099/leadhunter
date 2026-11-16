// Яндекс Карты: перехватываем ответы /maps/api/search и начальное состояние страницы
// (script.state-view), рекурсивно вытаскиваем оттуда организации, прокручиваем список.
const { isSocial } = require('../siteCheck');

function looksLikeBusiness(o) {
  return o && typeof o === 'object' && typeof o.title === 'string' &&
    (typeof o.address === 'string' || typeof o.fullAddress === 'string') &&
    (Array.isArray(o.phones) || Array.isArray(o.urls) || Array.isArray(o.categories) || o.type === 'business');
}

function walk(obj, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 14) return;
  if (looksLikeBusiness(obj)) { out.push(obj); return; }
  if (Array.isArray(obj)) for (const x of obj) walk(x, out, depth + 1);
  else for (const k in obj) walk(obj[k], out, depth + 1);
}

function parseItem(o, { niche, city, domain }) {
  const urls = (o.urls || []).map((u) => (typeof u === 'string' ? u : u?.value || u?.url || '')).filter(Boolean);
  const socials = (o.socialLinks || []).map((s) => s.href || s.url || s.readableHref).filter(Boolean);
  let website = '';
  for (const u of urls) { if (isSocial(u)) socials.push(u); else if (!website) website = u; }
  const coords = o.coordinates || o.displayCoordinates;
  const id = o.id || o.oid || o.businessId || '';
  const seo = o.seoname || '';
  return {
    name: o.title,
    category: (o.categories || []).map((c) => c.name || c).filter((x) => typeof x === 'string').slice(0, 2).join(', '),
    address: o.address || o.fullAddress || '',
    city, niche,
    phones: (o.phones || []).map((p) => p.number || p.value || p.formatted || p).filter((x) => typeof x === 'string'),
    website, socials,
    emails: (o.emails || []).filter((x) => typeof x === 'string'),
    rating: o.ratingData?.ratingValue || o.rating?.score || null,
    reviews: o.ratingData?.reviewCount || o.ratingData?.ratingCount || null,
    lat: Array.isArray(coords) ? coords[1] : null, lon: Array.isArray(coords) ? coords[0] : null,
    sources: [{ src: 'yandex', url: id ? `https://${domain}/maps/org/${seo ? seo + '/' : ''}${id}/` : '' }],
  };
}

async function waitCaptcha(page, log, headless) {
  if (!/showcaptcha|captcha/.test(page.url())) return true;
  if (headless) {
    log('Яндекс показал капчу. Выключи «фоновый режим» в настройках парсинга, чтобы пройти её вручную в окне браузера.');
    return false;
  }
  log('Яндекс показал капчу — пройди её в открывшемся окне браузера (жду до 3 минут)…');
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(2000);
    if (!/showcaptcha|captcha/.test(page.url())) { log('Капча пройдена, продолжаю'); return true; }
  }
  return false;
}

async function run({ page, niche, city, limit, log, onItem, shouldStop, delayMs, settings }) {
  const domain = settings.yandexDomain || 'yandex.ru';
  const q = [niche, city].filter(Boolean).join(' ');
  const seen = new Set();
  const pending = [];
  const push = (items) => { for (const it of items) pending.push(it); };

  const onResp = async (r) => {
    if (!/\/maps\/api\/search/.test(r.url())) return;
    try { const out = []; walk(await r.json(), out); push(out); } catch {}
  };
  page.on('response', onResp);
  try {
    log(`Яндекс: открываю «${q}»`);
    await page.goto(`https://${domain}/maps/?text=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!(await waitCaptcha(page, log, settings.headless))) return;
    await page.waitForSelector('.search-list-view, .search-snippet-view, .business-card-view', { timeout: 20000 }).catch(() => {});

    // начальные результаты лежат в state-view
    const state = await page.evaluate(() => {
      const s = document.querySelector('script.state-view, script[class*="state-view"]');
      return s ? s.textContent : null;
    });
    if (state) { try { const out = []; walk(JSON.parse(state), out); push(out); } catch {} }

    let idle = 0;
    while (!shouldStop() && seen.size < limit && idle < 6) {
      let added = 0;
      while (pending.length && seen.size < limit) {
        const it = pending.shift();
        const key = String(it.id || it.oid || it.title + '|' + it.address);
        if (seen.has(key)) continue;
        seen.add(key); added++;
        onItem(parseItem(it, { niche, city, domain }));
      }
      idle = added ? 0 : idle + 1;
      if (seen.size >= limit) break;
      // прокрутка списка, чтобы подгрузились следующие результаты
      await page.evaluate(() => {
        const sc = document.querySelector('.search-list-view .scroll__container, .scroll__container');
        if (sc) sc.scrollBy(0, 5000);
        const last = [...document.querySelectorAll('.search-snippet-view')].pop();
        if (last) last.scrollIntoView();
      }).catch(() => {});
      await page.waitForTimeout(delayMs + 400);
      if (!(await waitCaptcha(page, log, settings.headless))) break;
    }
    if (!seen.size) log('Яндекс: ничего не нашёл (возможно, капча или сменилась вёрстка — попробуй без фонового режима)');
  } finally {
    page.off('response', onResp);
  }
  log(`Яндекс: собрано ${seen.size}`);
}

module.exports = { run, parseItem, walk };
