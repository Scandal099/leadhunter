// Проверка сайта: нет сайта / только соцсети / конструктор / мёртвый / слабый / нормальный
const SOCIAL_HOSTS = [
  'vk.com', 'vk.ru', 'm.vk.com', 'instagram.com', 't.me', 'telegram.me', 'wa.me', 'api.whatsapp.com', 'whatsapp.com',
  'ok.ru', 'facebook.com', 'fb.com', 'youtube.com', 'youtu.be', 'dzen.ru', 'zen.yandex.ru', 'tiktok.com',
  'taplink.cc', 'taplink.ws', 'taplink.at', 'linktr.ee', 'hipolink.me', 'hipolink.net', 'mssg.me', 'linkin.bio',
  'avito.ru', 'yandex.ru', 'yandex.com', 'ya.ru', 'yell.ru', 'zoon.ru', 'flamp.ru', '2gis.ru', '2gis.com', 'profi.ru',
  'uslugi.yandex.ru', 'market.yandex.ru', 'ozon.ru', 'wildberries.ru', 'pinterest.com', 'twitter.com', 'x.com', 'max.ru',
];
// Сервисы онлайн-записи и агрегаторы — это тоже «нет своего сайта»
const BOOKING_HOSTS = [
  'yclients.com', 'yclients.ru', 'dikidi.net', 'dikidi.ru', 'dikidi.app', 'easyweek.io', 'easyweek.ru', 'arnica.pro', 'sonline.su',
  'beautybox.ru', 'prodoctorov.ru', 'napopravku.ru', 'docdoc.ru', 'sberhealth.ru', 'restoclub.ru', 'tripadvisor.ru', 'tripadvisor.com',
  'booking.com', 'ostrovok.ru', 'sutochno.ru', 'tvil.ru', 'auto.ru', 'drom.ru', 'cian.ru', 'domclick.ru', 'hh.ru', 'avito.ru',
  'clck.ru', 'bit.ly', 'b2b-center.ru', 'rusprofile.ru', 'list-org.com', 'chocolife.me', 'sberbank.com', 'tbank.ru',
  'beauty.dikidi.net', 'online-zapis.com', 'record.yclients.com', 'medflex.ru', 'vsevrachi.com', 'yell.ru', 'orgpage.ru', 'spr.ru',
];
SOCIAL_HOSTS.push(...BOOKING_HOSTS);
const isBooking = (h) => BOOKING_HOSTS.some((s) => h === s || h.endsWith('.' + s));

// Конструкторы по домену
const BUILDER_HOSTS = [
  [/\.tilda\.ws$|\.tildacdn\./, 'Tilda'],
  [/\.wixsite\.com$|\.wix\.com$/, 'Wix'],
  [/\.ukit\.me$|\.ukit\.com$/, 'uKit'],
  [/\.nethouse\.ru$|\.nethouse\.me$/, 'Nethouse'],
  [/\.flexbe\.(ru|com|site)$|\.flexbe\.online$/, 'Flexbe'],
  [/\.lpmotor\.ru$/, 'LPmotor'],
  [/\.lpgenerator\.ru$/, 'LPgenerator'],
  [/\.(ucoz|narod)\.(ru|net|com|ua)$|\.ucoz\.\w+$|\.at\.ua$|\.3dn\.ru$/, 'uCoz'],
  [/\.okis\.ru$/, 'Okis'],
  [/\.a5\.ru$|\.mya5\.ru$/, 'A5'],
  [/\.setup\.ru$|\.ru\.setup$/, 'Setup.ru'],
  [/\.jimdo(site|free)?\.com$/, 'Jimdo'],
  [/\.squarespace\.com$/, 'Squarespace'],
  [/\.weebly\.com$/, 'Weebly'],
  [/\.webflow\.io$/, 'Webflow'],
  [/\.wordpress\.com$/, 'WordPress.com'],
  [/\.blogspot\.\w+$/, 'Blogger'],
  [/^sites\.google\.com$/, 'Google Sites'],
  [/\.business\.site$/, 'Google Business Site'],
  [/\.craftum\.(io|com)$/, 'Craftum'],
  [/\.tobiz\.(net|ru)$/, 'Tobiz'],
  [/\.turbo\.site$|\.turbo-site\.\w+$/, 'Турбо-сайт Яндекс'],
  [/\.bitrix24\.(site|ru|shop)$|\.b24site\.\w+$/, 'Битрикс24.Сайты'],
  [/\.mozello\.\w+$/, 'Mozello'],
  [/\.readymag\.(com|website)$/, 'Readymag'],
  [/\.(megagroup|mgr)\.ru$/, 'Мегагрупп'],
  [/\.insales\.ru$|\.myinsales\.ru$/, 'InSales'],
  [/\.ecwid\.com$|\.company\.site$/, 'Ecwid'],
  [/\.notion\.site$/, 'Notion'],
  [/\.tb\.ru$|\.tbank\.ru$/, 'Т-Бизнес сайт'],
  [/\.ru\.net$|\.sitecity\.ru$|\.diafan\.ru$/, 'конструктор'],
];

// Конструкторы по содержимому HTML
const BUILDER_SIGNS = [
  [/tildacdn\.com|data-tilda-|tilda-blocks|t-records/i, 'Tilda'],
  [/static\.wixstatic\.com|wix-code|_wixCIDX|X-Wix/i, 'Wix'],
  [/ukit\.(me|com)|ukit-|uKit/, 'uKit'],
  [/nethouse\.ru|nethouse-/i, 'Nethouse'],
  [/flexbe\.(com|ru)|flexbe_/i, 'Flexbe'],
  [/lpgenerator|lpg-/i, 'LPgenerator'],
  [/lpmotor/i, 'LPmotor'],
  [/craftum/i, 'Craftum'],
  [/data-wf-site|webflow\.js/i, 'Webflow'],
  [/static1\.squarespace\.com|squarespace-/i, 'Squarespace'],
  [/jimdo|jimstatic/i, 'Jimdo'],
  [/weebly\.com|editmysite\.com/i, 'Weebly'],
  [/ucoz\.(ru|net)|uCoz|\/\.s\/src\//, 'uCoz'],
  [/readymag/i, 'Readymag'],
  [/b24-widget|bitrix24\.site|bx-landing|landing-block/i, 'Битрикс24.Сайты'],
  [/megagroup\.ru|mgr-/i, 'Мегагрупп'],
  [/setup\.ru/i, 'Setup.ru'],
  [/a5\.ru|a5-site/i, 'A5'],
  [/tobiz/i, 'Tobiz'],
  [/mozello/i, 'Mozello'],
  [/taplink/i, 'Taplink'],
  [/hipolink/i, 'Hipolink'],
  [/okis\.ru/i, 'Okis'],
  [/insales/i, 'InSales'],
  [/ecwid/i, 'Ecwid'],
  [/сайт создан (на|в|с помощью) ([^<"]{2,30})/i, null],
  [/(made|created|powered) (with|by) (tilda|wix|ukit|craftum|flexbe|nethouse)/i, null],
];

const PARKED_SIGNS = /(домен (продается|продаётся|зарегистрирован|припаркован|не делегирован)|this domain (is|may be) for sale|domain is parked|сайт (не опубликован|заблокирован|временно недоступен|в разработке)|account suspended|hosting.*expired|срок (оплаты|действия).*(истек|истёк)|default web page|welcome to nginx|apache2? (ubuntu |debian )?default page|index of \/|it works!|parking|reg\.ru.*парковка|страница хостинга)/i;

function hostOf(url) {
  try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}
function isSocial(url) {
  const h = hostOf(url);
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith('.' + s));
}
function builderByHost(h) {
  for (const [re, name] of BUILDER_HOSTS) if (re.test(h) || re.test('.' + h)) return name;
  return null;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, 'accept-language': 'ru-RU,ru;q=0.9' } });
    const buf = await r.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf.slice(0, 600000));
    if (/charset=["']?windows-1251/i.test(text.slice(0, 3000)) || /1251/.test(r.headers.get('content-type') || '')) {
      try { text = new TextDecoder('windows-1251').decode(buf.slice(0, 600000)); } catch {}
    }
    return { ok: r.ok, status: r.status, url: r.url, headers: r.headers, text };
  } finally { clearTimeout(t); }
}

// Проверка, доступны ли российские сайты из текущей сети (VPN часто ломает это)
let netCache = { t: 0, ok: true, pending: null };
async function networkOk() {
  if (Date.now() - netCache.t < 60000) return netCache.ok;
  if (netCache.pending) return netCache.pending;
  netCache.pending = (async () => {
    const probes = ['https://ya.ru/', 'https://www.rbc.ru/', 'https://mail.ru/'];
    const results = await Promise.all(probes.map((u) => fetchWithTimeout(u, 6000).then(() => true, () => false)));
    netCache = { t: Date.now(), ok: results.some(Boolean), pending: null };
    return netCache.ok;
  })();
  return netCache.pending;
}

/**
 * Возвращает { status, builder, reasons[], httpStatus, title, finalUrl, checkedAt, score }
 * status: none | social | constructor | dead | weak | ok
 * score: 0..100 — насколько компании нужен новый сайт (больше = горячее)
 */
async function checkSite(website, socials = []) {
  const res = { status: 'none', builder: null, reasons: [], httpStatus: null, title: '', finalUrl: '', checkedAt: Date.now(), score: 100 };
  if (!website) {
    if (socials.length) { res.status = 'social'; res.reasons.push('Есть только соцсети/мессенджеры'); res.score = 95; }
    else res.reasons.push('Сайт не указан на картах');
    return res;
  }
  const url = normalizeUrl(website);
  const host = hostOf(url);
  if (isSocial(url)) {
    res.status = 'social'; res.score = 95; res.finalUrl = url;
    res.reasons.push(isBooking(host) ? `Вместо сайта — онлайн-запись/агрегатор (${host})` : `Вместо сайта — соцсеть (${host})`);
    return res;
  }
  const byHost = builderByHost(host);
  let page;
  try {
    page = await fetchWithTimeout(url);
    if (!page.ok && url.startsWith('http://')) {
      // некоторые сайты отдают ошибку по http — пробуем https
      try { const p2 = await fetchWithTimeout(url.replace(/^http:/, 'https:')); if (p2.ok) page = p2; } catch {}
    }
  } catch (e) {
    try { page = await fetchWithTimeout(url.replace(/^http:/, 'https:')); } catch (e2) {
      const code = e2.cause?.code || e.cause?.code || (e.name === 'AbortError' ? 'TIMEOUT' : e.message);
      // Домен не существует — точно мёртвый. Таймаут — может быть проблема нашей сети (VPN), проверяем.
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|SSL/i.test(code) && (await networkOk())) {
        res.status = 'dead'; res.score = 90;
        res.reasons.push(/ENOTFOUND/.test(code) ? 'Домен не существует / не продлён' : 'Сайт не открывается (' + code + ')');
        return res;
      }
      if (!(await networkOk())) {
        res.status = 'unknown'; res.score = 50;
        res.reasons.push('Не удалось проверить: российские сайты недоступны из твоей сети (выключи VPN и перепроверь)');
        return res;
      }
      res.status = 'dead'; res.score = 85;
      res.reasons.push('Сайт не открывается (' + (code === 'TIMEOUT' || /TIMEOUT/.test(code) ? 'таймаут' : code) + ')');
      return res;
    }
  }
  res.httpStatus = page.status;
  res.finalUrl = page.url;
  const html = page.text || '';
  res.title = ((html.match(/<title[^>]*>([^<]{0,200})/i) || [])[1] || '').trim();

  if (isSocial(page.url)) { res.status = 'social'; res.score = 95; res.reasons.push('Сайт перенаправляет в ' + hostOf(page.url)); return res; }
  if (!page.ok) { res.status = 'dead'; res.score = 90; res.reasons.push(`Сайт отвечает ошибкой ${page.status}`); return res; }
  const visibleText = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (PARKED_SIGNS.test(visibleText.slice(0, 5000)) || visibleText.length < 150 && !/<script/i.test(html)) {
    res.status = 'dead'; res.score = 88; res.reasons.push('Заглушка / домен припаркован / пустая страница'); return res;
  }

  let builder = byHost || builderByHost(hostOf(page.url));
  if (!builder) {
    const gen = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
    for (const [re, name] of BUILDER_SIGNS) {
      const m = html.match(re) || gen.match(re);
      if (m) { builder = name || (m[2] || m[3] || 'конструктор').trim(); break; }
    }
  }
  if (builder) {
    res.status = 'constructor'; res.builder = builder; res.score = 75;
    res.reasons.push(`Собран на конструкторе: ${builder}`);
    if (byHost) res.reasons.push('Сайт на поддомене конструктора (нет своего домена)'), (res.score = 82);
  }

  // Признаки слабого/устаревшего сайта
  const weak = [];
  if (!/<meta[^>]+name=["']viewport/i.test(html)) weak.push('Нет адаптива под телефоны');
  if (!page.url.startsWith('https://')) weak.push('Нет HTTPS');
  const years = [...visibleText.matchAll(/(?:©|&copy;|\(c\)|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(20\d\d|19\d\d)/gi)].map((m) => +m[1]);
  const lastYear = years.length ? Math.max(...years) : null;
  if (lastYear && lastYear <= new Date().getFullYear() - 4) weak.push(`Копирайт ${lastYear} г. — сайт давно не обновлялся`);
  if (/<table[^>]+width=|<font |<marquee|<frameset|\.swf/i.test(html)) weak.push('Устаревшая вёрстка (таблицы/font/flash)');
  if (/jquery[.-]1\.\d/i.test(html)) weak.push('Древний jQuery 1.x');
  const gen = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i) || [])[1];
  if (gen && !builder) res.reasons.push('CMS: ' + gen.slice(0, 40));

  res.reasons.push(...weak);
  if (res.status !== 'constructor') {
    if (weak.length >= 2 || weak.includes('Нет адаптива под телефоны')) { res.status = 'weak'; res.score = 55 + weak.length * 5; }
    else { res.status = 'ok'; res.score = 10 + weak.length * 10; res.reasons.unshift('Нормальный собственный сайт'); }
  } else res.score = Math.min(100, res.score + weak.length * 3);
  return res;
}

module.exports = { checkSite, isSocial, hostOf, normalizeUrl, networkOk };
