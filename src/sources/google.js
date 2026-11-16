// Google Карты: собираем ссылки из ленты результатов, затем открываем каждую организацию
// по прямой ссылке (в списке Google часто не показывает сайт и телефон — например, у салонов
// вместо них кнопка «Забронировать»), и берём сайт/телефон/адрес из карточки.
const { isSocial } = require('../siteCheck');

async function handleConsent(page, log) {
  if (!/consent\.google/.test(page.url())) return;
  log('Google просит согласие на cookies — отклоняю необязательные');
  await page.locator('button:has-text("Отклонить все"), button:has-text("Reject all")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

const PARALLEL = 2;

async function run({ page, niche, city, limit, log, onItem, shouldStop, delayMs }) {
  const q = [niche, city].filter(Boolean).join(' ');
  log(`Google: открываю «${q}»`);
  await page.goto('https://www.google.com/maps/search/' + encodeURIComponent(q) + '?hl=ru', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await handleConsent(page, log);
  await page.waitForSelector('div[role=feed], div[role=main] h1', { timeout: 20000 }).catch(() => {});

  // 1. Собираем список организаций
  const cards = new Map();
  if (!(await page.$('div[role=feed]'))) {
    // Google сразу открыл одну организацию
    const name = await page.$eval('div[role=main] h1', (h) => h.textContent.trim()).catch(() => '');
    if (name) cards.set(page.url(), { name, href: page.url(), text: '' });
  }
  let idle = 0;
  while (!shouldStop() && cards.size < limit && idle < 5 && (await page.$('div[role=feed]'))) {
    const batch = await page.evaluate(() => [...document.querySelectorAll('div[role=feed] a.hfpxzc')].map((a) => ({
      name: a.getAttribute('aria-label') || '', href: a.href, text: a.parentElement?.innerText || '',
    })));
    const before = cards.size;
    for (const c of batch) if (!cards.has(c.href) && cards.size < limit) cards.set(c.href, c);
    idle = cards.size > before ? 0 : idle + 1;
    if (cards.size >= limit) break;
    const end = await page.evaluate(() => {
      const f = document.querySelector('div[role=feed]');
      f.scrollBy(0, 5000);
      return /Больше результатов нет|reached the end of the list/i.test(f.innerText.slice(-500));
    });
    if (end && cards.size === before) break;
    await page.waitForTimeout(delayMs);
  }
  log(`Google: в списке ${cards.size} организаций, открываю карточки…`);

  // 2. Открываем каждую организацию и забираем контакты
  const ctx = page.context();
  const workers = [];
  const queue = [...cards.values()];
  let done = 0;
  for (let w = 0; w < PARALLEL; w++) {
    workers.push((async () => {
      const dp = await ctx.newPage();
      // не грузим картинки и тайлы карты — так в разы быстрее
      await dp.route('**/*', (r) => {
        const t = r.request().resourceType();
        return ['image', 'font', 'media'].includes(t) || /\/maps\/vt|\/kh\/v=|streetview|\/vt\?/.test(r.request().url()) ? r.abort() : r.continue();
      });
      try {
        while (queue.length && !shouldStop()) {
          const c = queue.shift();
          let det = {};
          try { det = await readPlace(dp, c.href); } catch (e) { log(`Google: не открылась карточка «${c.name}»`); }
          onItem(buildLead(c, det, { niche, city }));
          if (++done % 10 === 0) log(`Google: обработано ${done}/${cards.size}`);
        }
      } finally { await Promise.race([dp.close().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]); }
    })());
  }
  await Promise.all(workers);
  log(`Google: собрано ${done}`);
}

async function readPlace(dp, href) {
  await dp.goto(href + (href.includes('?') ? '&' : '?') + 'hl=ru', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dp.waitForSelector('div[role=main] h1', { timeout: 15000 });
  await dp.waitForSelector('[data-item-id="address"], [data-item-id^="phone"], [data-item-id="authority"]', { timeout: 5000 }).catch(() => {});
  return dp.evaluate(() => {
    const m = document.querySelector('div[role=main]');
    const lbl = (sel) => (m.querySelector(sel)?.getAttribute('aria-label') || '').replace(/^[^:]+:\s*/, '').trim();
    const ratingEl = m.querySelector('div.F7nice');
    return {
      name: m.querySelector('h1')?.textContent.trim(),
      website: m.querySelector('a[data-item-id="authority"]')?.href || '',
      phones: [...m.querySelectorAll('[data-item-id^="phone:tel:"]')].map((x) => x.getAttribute('data-item-id').replace('phone:tel:', '')),
      address: lbl('[data-item-id="address"]'),
      category: m.querySelector('button[jsaction*="category"]')?.textContent.trim() || '',
      ratingText: ratingEl ? ratingEl.innerText : '',
      booking: [...m.querySelectorAll('a[data-item-id^="action:"]')].map((a) => a.href),
    };
  });
}

function cleanUrl(u) {
  if (!u) return '';
  try {
    const x = new URL(u);
    if (x.hostname.includes('google.') && x.searchParams.get('q')) return cleanUrl(x.searchParams.get('q'));
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^yclid|^gclid/.test(k)) x.searchParams.delete(k);
    return x.toString().replace(/\?$/, '');
  } catch { return u; }
}

function buildLead(c, det, { niche, city }) {
  const lines = (c.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  let rating = null, reviews = null, category = det.category || '', address = det.address || '';
  const rt = (det.ratingText || '') + '\n' + lines.join('\n');
  const m = rt.match(/(\d[,.]\d)\s*\n?\s*\(([\d\s ]+)\)/);
  if (m) { rating = parseFloat(m[1].replace(',', '.')); reviews = parseInt(m[2].replace(/\D/g, ''), 10); }
  if (!category || !address) {
    const catLine = lines.find((ln) => ln.includes('·') && !/Открыто|Закрыто|Закроется|Откроется|Круглосуточно/i.test(ln));
    if (catLine) {
      const parts = catLine.split('·').map((s) => s.trim()).filter(Boolean);
      category = category || parts[0] || '';
      address = address || parts.slice(1).join(', ');
    }
  }
  const phones = det.phones?.length ? det.phones : (c.text.match(/\+?[78][\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g) || []);
  const website = cleanUrl(det.website);
  const socials = [];
  if (website && isSocial(website)) socials.push(website);
  for (const b of det.booking || []) if (isSocial(b)) socials.push(cleanUrl(b));
  const coord = c.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return {
    name: det.name || c.name, category, address: address.replace(/, Россия.*$/, '').replace(/,\s*(Респ\.|Республика|[А-ЯЁа-яё-]+ (обл\.|область|край|АО)).*$/, '').replace(/,\s*\d{6}\s*$/, ''), city, niche, phones, website, socials,
    rating, reviews, lat: coord ? +coord[1] : null, lon: coord ? +coord[2] : null,
    sources: [{ src: 'google', url: c.href }],
  };
}

module.exports = { run };
