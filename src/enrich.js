// Глубокий допарсинг (Deep Enrich) выбранных лидов для нейросети:
// выкачивает товары и услуги с картинкой и ценой, фото, отзывы, часы работы, текст сайта и аудит.
const db = require('./db');
const { getContext } = require('./browser');
const { siteStatus } = require('./leadUtil');

const listeners = new Set();
const emit = (type, data) => { for (const fn of listeners) fn(type, data); };

let state = {
  running: false,
  stopRequested: false,
  total: 0,
  done: 0,
  current: '',
  errors: 0,
};

function getState() {
  return { ...state };
}

function stop() {
  if (state.running) state.stopRequested = true;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSiteSummary(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || '').trim();
    const ogImg = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)?.[1] || '').trim();
    const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
      .map((m) => stripHtml(m[1]))
      .filter((t) => t.length > 2 && t.length < 140)
      .slice(0, 8);
    const text = stripHtml(html).slice(0, 2200);
    return { title, description: desc, ogImage: ogImg, headings, text };
  } catch (e) {
    return { error: e.message };
  }
}

function mergeServices(target, incoming) {
  for (const item of incoming) {
    const name = String(item?.name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2 || name.length > 140) continue;
    const price = String(item?.price || '').replace(/\s+/g, ' ').trim();
    const description = String(item?.description || '').replace(/\s+/g, ' ').trim();
    const image = /^https?:\/\//i.test(item?.image || '') ? item.image : '';
    const existing = target.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!existing.price && price) existing.price = price;
      if (!existing.description && description) existing.description = description;
      if (!existing.image && image) existing.image = image;
    } else {
      target.push({ name, price, description, image });
    }
  }
}

// Извлечение карточек товаров/услуг (название, цена, картинка) прямо из DOM текущей страницы
async function extractServicesFromDom(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const priceRe = /(?:от\s*)?\d[\d\s\u00a0]{0,7}\s*(?:₽|руб\.?|р\b)/i;

    // Ищем все элементы, содержащие цену
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const priceNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || '').trim();
      if (t && t.length < 40 && priceRe.test(t)) {
        const el = node.parentElement;
        if (el && el.offsetParent !== null) priceNodes.push({ el, text: t });
      }
    }

    for (const pn of priceNodes) {
      // Поднимаемся вверх на 2-5 уровней до карточки товара/услуги
      let card = pn.el;
      let bestCard = null;
      for (let depth = 0; depth < 6 && card && card !== document.body; depth++) {
        card = card.parentElement;
        if (!card) break;
        const rect = card.getBoundingClientRect();
        if (rect.height >= 40 && rect.height <= 420 && rect.width >= 150 && rect.width <= 900) {
          const textLen = (card.innerText || '').trim().length;
          if (textLen > 6 && textLen < 450) {
            bestCard = card;
            if (card.querySelector('img')) break;
          }
        }
      }
      if (!bestCard) continue;

      const lines = (bestCard.innerText || '')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && s.length > 1);
      const priceMatch = pn.text.match(priceRe);
      const price = priceMatch ? priceMatch[0].replace(/\u00a0/g, ' ').trim() : pn.text;

      // Название — самая первая содержательная строка без цены и служебных кнопок
      const name = lines.find((l) =>
        l !== pn.text &&
        !priceRe.test(l) &&
        !/^(записаться|подробнее|в корзину|заказать|показать|скрыть|\d+\s*мин|\d+\s*ч)$/i.test(l) &&
        l.length >= 2 &&
        l.length <= 120
      );
      if (!name) continue;

      // Ищем картинку внутри карточки
      let image = '';
      const img = bestCard.querySelector('img');
      if (img) {
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
        if (/^https?:\/\//i.test(src) && !/icon|logo|sprite|svg/i.test(src)) image = src;
      }
      if (!image) {
        // Иногда картинка задана через background-image
        const bgEl = [...bestCard.querySelectorAll('[style*="background-image"]')][0];
        const bg = bgEl?.style?.backgroundImage || '';
        const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
        if (m) image = m[1];
      }

      const key = `${name.toLowerCase()}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, price, image });
      if (out.length >= 40) break;
    }
    return out;
  }).catch(() => []);
}

async function enrichFrom2Gis(page, firmUrl) {
  const result = {
    hours: '',
    description: '',
    photos: [],
    services: [],
    reviews: [],
  };
  if (!firmUrl) return result;
  const cleanUrl = firmUrl.replace(/\/tab\/.*$/i, '').replace(/\/+$/, '');

  const photoUrls = new Set();
  const reviewsList = [];
  const servicesList = [];
  let apiItem = null;

  const onResp = async (r) => {
    const u = r.url();
    try {
      if (/catalog\.api\.2gis\.[a-z]+\/[\d.]+\/items\/byid/i.test(u)) {
        const j = await r.json();
        const it = j?.result?.items?.[0];
        if (it) apiItem = it;
      } else if (/public-api\.reviews\.2gis\.[a-z]+/i.test(u)) {
        const j = await r.json();
        for (const rev of j?.reviews || []) {
          if (rev?.text && reviewsList.length < 6) {
            reviewsList.push({
              author: rev.user?.name || 'Клиент',
              rating: rev.rating || 5,
              text: String(rev.text).replace(/\s+/g, ' ').trim().slice(0, 350),
            });
          }
        }
      } else if (/api\.photo\.2gis\.[a-z]+/i.test(u)) {
        const j = await r.json();
        for (const ph of j?.items || []) {
          const best = ph?.urls?.['1280x'] || ph?.urls?.['800x'] || ph?.urls?.original || ph?.url;
          if (best && photoUrls.size < 12) photoUrls.add(best);
        }
      } else if (/2gis\.[a-z]+.*(price|market|goods|service|product)/i.test(u) && r.headers()['content-type']?.includes('json')) {
        const j = await r.json();
        const items = j?.result?.items || j?.items || j?.data?.items || [];
        if (Array.isArray(items)) {
          const mapped = items.map((it) => ({
            name: it.name || it.title || '',
            price: it.price?.value ? `${it.price.value} ₽` : (it.price_text || it.price || ''),
            image: it.image?.url || it.photo?.url || it.photos?.[0]?.url || '',
          }));
          mergeServices(servicesList, mapped);
        }
      }
    } catch {}
  };

  page.on('response', onResp);
  try {
    // 1. Основная карточка
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Прямой переход на вкладку "Цены / Товары и услуги"
    await page.goto(`${cleanUrl}/tab/prices`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2200);
    // Скроллим вниз, чтобы подгрузились ленивые картинки товаров/услуг
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(800);
    const priceDom = await extractServicesFromDom(page);
    mergeServices(servicesList, priceDom);

    // 3. Прямой переход на вкладку "Отзывы" (если ещё не собрались)
    if (!reviewsList.length) {
      await page.goto(`${cleanUrl}/tab/reviews`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1600);
    }

    // 4. Прямой переход на вкладку "Фото" (если мало фото)
    if (photoUrls.size < 4) {
      await page.goto(`${cleanUrl}/tab/gallery`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1600);
    }

    if (apiItem) {
      if (apiItem.schedule?.comment) result.hours = apiItem.schedule.comment;
      else if (apiItem.schedule?.working_hours) {
        result.hours = Object.entries(apiItem.schedule.working_hours)
          .slice(0, 2)
          .map(([d, v]) => `${d}: ${v?.from || ''}–${v?.to || ''}`)
          .join(', ');
      }
      if (apiItem.ads?.text) result.description = apiItem.ads.text;
    }

    // Собираем фото из DOM
    const domImgs = await page.evaluate(() => {
      return [...document.querySelectorAll('img')]
        .map((img) => img.currentSrc || img.src || img.getAttribute('data-src') || '')
        .filter((s) => /^https?:\/\//i.test(s) && /2gis|photo|avatars|cdn/i.test(s) && !/logo|icon|sprite|avatar|static/i.test(s))
        .slice(0, 12);
    }).catch(() => []);

    for (const img of domImgs) {
      if (photoUrls.size < 10) photoUrls.add(img);
    }
  } finally {
    page.off('response', onResp);
  }

  result.photos = [...photoUrls].slice(0, 8);
  result.services = servicesList.slice(0, 30);
  result.reviews = reviewsList.slice(0, 5);
  return result;
}

async function enrichFromYandex(page, yandexUrl) {
  const result = { hours: '', description: '', photos: [], services: [], reviews: [] };
  if (!yandexUrl) return result;
  const cleanUrl = yandexUrl.replace(/\/(prices|reviews|gallery|photos)\/?$/i, '').replace(/\/+$/, '');
  try {
    // 1. Товары и услуги (/prices/)
    await page.goto(`${cleanUrl}/prices/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2600);
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(900);

    const yaServices = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.related-item-list-view, .related-item-photo-view, .business-full-items-grouped-view__item');
      for (const card of cards) {
        const titleEl = card.querySelector('[class*="__title"], [class*="__name"]');
        const priceEl = card.querySelector('[class*="__price"]');
        const descEl = card.querySelector('[class*="__subtitle"], [class*="__description"]');
        const imgEl = card.querySelector('img');
        const name = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim();
        const price = (priceEl?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const desc = (descEl?.textContent || '').replace(/\s+/g, ' ').trim();
        const img = imgEl ? (imgEl.currentSrc || imgEl.src || imgEl.getAttribute('data-src') || '') : '';
        if (!name || name.length < 2) continue;
        const key = `${name.toLowerCase()}|${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          name,
          price,
          description: desc,
          image: /^https?:\/\//i.test(img) && !/icon|logo|sprite|svg/i.test(img) ? img : '',
        });
        if (out.length >= 40) break;
      }
      return out;
    }).catch(() => []);

    if (yaServices.length) {
      mergeServices(result.services, yaServices);
    } else {
      const domServices = await extractServicesFromDom(page);
      mergeServices(result.services, domServices);
    }

    // 2. Фотографии (/gallery/)
    await page.goto(`${cleanUrl}/gallery/`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1600);
    const domImgs = await page.evaluate(() => {
      return [...document.querySelectorAll('img')]
        .map((img) => img.currentSrc || img.src || '')
        .filter((s) => /^https?:\/\//i.test(s) && /avatars\.mds\.yandex|get-altay/i.test(s) && !/islands-34|islands-50/i.test(s))
        .slice(0, 10);
    }).catch(() => []);
    result.photos = [...new Set(domImgs)].slice(0, 8);

    // 3. Отзывы (/reviews/)
    await page.goto(`${cleanUrl}/reviews/`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1600);
    result.reviews = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.business-review-view')) {
        const author = (el.querySelector('.business-review-view__author-name, [itemprop="author"]')?.textContent || 'Клиент').trim();
        const text = (el.querySelector('.business-review-view__body-text, [itemprop="reviewBody"]')?.textContent || '').replace(/\s+/g, ' ').trim();
        const stars = el.querySelectorAll('.business-rating-badge-view__star._full, [class*="star"][class*="full"]').length || 5;
        if (text && out.length < 5) out.push({ author, rating: stars, text: text.slice(0, 350) });
      }
      return out;
    }).catch(() => []);
  } catch (e) {
    console.error('[enrich ya]', e.message);
  }
  return result;
}

function buildAudit(lead, enriched) {
  const audit = [];
  const st = siteStatus(lead);
  if (st === 'none') audit.push('Нет собственного сайта (клиенты не находят в поиске)');
  else if (st === 'social') audit.push('Только соцсети вместо сайта');
  else if (st === 'constructor') audit.push(`Сайт на конструкторе${lead.site?.builder ? ` (${lead.site.builder})` : ''}`);
  else if (st === 'dead') audit.push('Текущий сайт не открывается');
  else if (st === 'weak') audit.push('Устаревший сайт / слабый мобильный UX');

  if (!enriched.services?.length) audit.push('Нет открытого прайс-листа (клиент вынужден звонить/писать)');
  if (!enriched.photos?.length) audit.push('Мало или нет реальных фото в карточке');
  if (!lead.emails?.length && !lead.socials?.length) audit.push('Нет онлайн-записи / мессенджеров на видном месте');
  return audit;
}

async function enrichOne(lead, page) {
  const gisSrc = (lead.sources || []).find((s) => s.src === '2gis' && s.url);
  const yaSrc = (lead.sources || []).find((s) => s.src === 'yandex' && s.url);

  let mapData = { hours: '', description: '', photos: [], services: [], reviews: [] };
  if (gisSrc && page) {
    mapData = await enrichFrom2Gis(page, gisSrc.url);
  } else if (yaSrc && page) {
    mapData = await enrichFromYandex(page, yaSrc.url);
  }

  const siteData = lead.website ? await fetchSiteSummary(lead.website) : null;
  if (siteData?.ogImage && !mapData.photos.includes(siteData.ogImage)) {
    mapData.photos.unshift(siteData.ogImage);
  }

  const enriched = {
    enrichedAt: Date.now(),
    hours: mapData.hours || '',
    description: mapData.description || siteData?.description || '',
    photos: mapData.photos.slice(0, 8),
    services: mapData.services,
    reviews: mapData.reviews,
    siteSummary: siteData && !siteData.error ? siteData : null,
  };
  enriched.audit = buildAudit(lead, enriched);
  console.log(`[enrich] ${lead.name}: фото=${enriched.photos.length}, услуг=${enriched.services.length}, отзывов=${enriched.reviews.length}`);

  return db.updateLead(lead.id, { enriched });
}

async function start(ids, opts = {}) {
  if (state.running) throw new Error('Допарсинг уже идёт');
  const targetList = (ids || []).map((id) => db.getLead(id)).filter(Boolean);
  if (!targetList.length) throw new Error('Не выбрано ни одного лида');

  if (opts.targetStatus) {
    for (const l of targetList) {
      if (l.status === 'new') {
        const updated = db.updateLead(l.id, { status: opts.targetStatus });
        if (updated) emit('lead', updated);
      }
    }
  }

  state = {
    running: true,
    stopRequested: false,
    total: targetList.length,
    done: 0,
    current: '',
    errors: 0,
  };
  emit('enrich', getState());

  (async () => {
    let page = null;
    try {
      const needBrowser = targetList.some((l) => (l.sources || []).some((s) => (s.src === '2gis' || s.src === 'yandex') && s.url));
      if (needBrowser) {
        const headless = typeof opts.headless === 'boolean' ? opts.headless : !!db.getSettings().headless;
        const ctx = await getContext(headless);
        page = await ctx.newPage();
      }
      for (const lead of targetList) {
        if (state.stopRequested) break;
        state.current = lead.name;
        emit('enrich', getState());
        try {
          const updated = await enrichOne(lead, page);
          if (updated) emit('lead', updated);
        } catch (e) {
          state.errors++;
          console.error('[enrich]', lead.name, e.message);
        }
        state.done++;
        emit('enrich', getState());
      }
    } catch (e) {
      console.error('[enrich fatal]', e.message);
    } finally {
      if (page) await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      db.saveNow();
      state.running = false;
      state.current = '';
      emit('enrich', getState());
    }
  })();

  return getState();
}

module.exports = {
  start,
  stop,
  getState,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
