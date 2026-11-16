// 2ГИС: открываем поиск на сайте и перехватываем JSON-ответы catalog.api.2gis.* —
// в них уже есть контакты (телефоны, сайт, соцсети), рубрики и рейтинг.
const { isSocial } = require('../siteCheck');
const { citySlug } = require('../cities');

const SOCIAL_TYPES = new Set(['vkontakte', 'instagram', 'telegram', 'whatsapp', 'viber', 'facebook', 'odnoklassniki', 'youtube', 'twitter', 'linkedin', 'tiktok', 'max']);

function realUrl(c) {
  // 2ГИС прячет ссылки за редиректом link.2gis.ru — берём человекочитаемый text
  let u = c.url || c.value || '';
  if (/link\.2gis\.|\/\/link\./i.test(u) || !u) u = c.text || c.print_text || u;
  if (u && !/^https?:\/\//i.test(u) && !/^[+\d]/.test(u)) u = 'http://' + u;
  return u;
}

function parseItem(it, { niche, city, domain }) {
  const phones = [], socials = [], emails = [];
  let website = '';
  for (const g of it.contact_groups || []) {
    for (const c of g.contacts || []) {
      if (c.type === 'phone') phones.push(c.text || c.value);
      else if (c.type === 'email') emails.push(c.value);
      else if (c.type === 'website') { const u = realUrl(c); if (isSocial(u)) socials.push(u); else if (!website) website = u; }
      else if (SOCIAL_TYPES.has(c.type)) socials.push(realUrl(c));
    }
  }
  const id = String(it.id || '').split('_')[0];
  return {
    name: it.name || it.name_ex?.primary || '',
    category: (it.rubrics || []).map((r) => r.name).slice(0, 2).join(', '),
    address: it.address_name || it.full_address_name || it.address?.name || '',
    city, niche, phones, website, socials, emails,
    rating: it.reviews?.general_rating ? +it.reviews.general_rating : null,
    reviews: it.reviews?.general_review_count || it.reviews?.org_review_count || null,
    lat: it.point?.lat || null, lon: it.point?.lon || null,
    sources: [{ src: '2gis', url: id ? `https://${domain}/firm/${id}` : '' }],
  };
}

async function run({ page, niche, city, limit, log, onItem, shouldStop, delayMs, settings }) {
  const domain = settings.twogisDomain || '2gis.ru';
  const slug = citySlug(city);
  const seen = new Set();
  const pending = [];

  const onResp = async (r) => {
    const u = r.url();
    if (!/catalog\.api\.2gis\.[a-z]+\/[\d.]+\/items/.test(u)) return;
    try {
      const j = await r.json();
      for (const it of j?.result?.items || []) {
        if (it.type && it.type !== 'branch') continue;
        pending.push(it);
      }
    } catch {}
  };
  page.on('response', onResp);
  try {
    const q = slug ? niche : `${niche} ${city}`.trim();
    for (let p = 1; p <= 60 && !shouldStop() && seen.size < limit; p++) {
      const url = `https://${domain}/${slug ? slug + '/' : ''}search/${encodeURIComponent(q)}${p > 1 ? '/page/' + p : ''}`;
      log(`2ГИС: страница ${p} — ${url}`);
      const before = seen.size;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(delayMs + 1500);
      // если по прямой ссылке ничего не пришло — пробуем прокрутить список
      if (!pending.length) {
        await page.mouse.wheel(0, 1500).catch(() => {});
        await page.waitForTimeout(1500);
      }
      while (pending.length && seen.size < limit) {
        const it = pending.shift();
        const key = String(it.id || it.name);
        if (seen.has(key)) continue;
        seen.add(key);
        onItem(parseItem(it, { niche, city, domain }));
      }
      if (seen.size === before) {
        if (p === 1) {
          const captcha = await page.$('text=/подтвердите, что вы не робот|captcha/i');
          log(captcha ? '2ГИС показал проверку «я не робот» — пройди её в окне браузера и запусти снова'
            : '2ГИС: не удалось получить данные (проверь домен в настройках и доступ к сайту)');
        }
        break;
      }
    }
  } finally {
    page.off('response', onResp);
  }
  log(`2ГИС: собрано ${seen.size}`);
}

module.exports = { run, parseItem };
