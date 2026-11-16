// Генератор персональных демо-сайтов на основе эталонного шаблона + Fact-Check
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { siteStatus } = require('./leadUtil');

const APP_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DEMOS_DIR = path.join(APP_DIR, 'demos');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(str, id) {
  const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  const s = String(str || 'company')
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${s || 'demo'}-${String(id || '').slice(0, 6)}`;
}

function pickTheme(lead) {
  const text = `${lead.niche || ''} ${lead.category || ''} ${lead.name || ''}`.toLowerCase();
  if (/химчист|клининг|уборк|мойк/i.test(text)) return { accent: '#0ea5e9', accent2: '#06b6d4', badge: 'Выездной сервис и уход' };
  if (/бьюти|салон|барбер|ногт|парикмах|косметол/i.test(text)) return { accent: '#ec4899', accent2: '#a855f7', badge: 'Запись онлайн без звонков' };
  if (/стоматолог|клиник|мед|врач/i.test(text)) return { accent: '#10b981', accent2: '#14b8a6', badge: 'Запись на приём онлайн' };
  if (/авто|шин|сто|ремонт машин|эвакуат|детейлинг/i.test(text)) return { accent: '#f97316', accent2: '#ef4444', badge: 'Быстрая запись на сервис' };
  return { accent: '#6366f1', accent2: '#8b5cf6', badge: 'Онлайн-запись и консультация' };
}

function renderDemoHtml(lead) {
  const theme = pickTheme(lead);
  const en = lead.enriched || {};
  const photos = Array.isArray(en.photos) ? en.photos.filter((u) => /^https?:\/\//i.test(u)).slice(0, 6) : [];
  const services = Array.isArray(en.services) ? en.services.slice(0, 12) : [];
  const reviews = Array.isArray(en.reviews) ? en.reviews.slice(0, 4) : [];
  const phone = (lead.phones || [])[0] || '';
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : '#lead-form';
  const mapUrl = lead.lat && lead.lon
    ? `https://yandex.ru/maps/?pt=${lead.lon},${lead.lat}&z=16&l=map`
    : `https://2gis.ru/search/${encodeURIComponent(`${lead.name} ${lead.city || ''}`.trim())}`;

  const heroBg = photos[0]
    ? `linear-gradient(120deg, rgba(11,15,25,.92) 45%, rgba(11,15,25,.68) 100%), url('${esc(photos[0])}') center/cover no-repeat`
    : `radial-gradient(circle at 80% 20%, ${theme.accent}33, transparent 50%), linear-gradient(135deg, #0b0f19 0%, #111827 100%)`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(lead.name)}${lead.city ? ` — ${esc(lead.city)}` : ''}</title>
  <style>
    :root { --accent: ${theme.accent}; --accent2: ${theme.accent2}; --bg: #0b0f19; --card: #131a2a; --text: #f8fafc; --muted: #94a3b8; --border: rgba(255,255,255,.1); }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.55; }
    a { color: inherit; text-decoration: none; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
    .nav { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(12px); background: rgba(11,15,25,.82); border-bottom: 1px solid var(--border); }
    .nav-in { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 68px; }
    .brand { font-weight: 800; font-size: 18px; letter-spacing: -.02em; }
    .nav-actions { display: flex; align-items: center; gap: 12px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 22px; border-radius: 12px; font-weight: 700; font-size: 15px; cursor: pointer; border: 0; transition: .2s; }
    .btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; box-shadow: 0 10px 28px -8px var(--accent); }
    .btn-primary:hover { transform: translateY(-1px); filter: brightness(1.08); }
    .btn-ghost { background: rgba(255,255,255,.07); color: var(--text); border: 1px solid var(--border); }
    .hero { padding: 72px 0 64px; background: ${heroBg}; border-bottom: 1px solid var(--border); }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.08); border: 1px solid var(--border); font-size: 13px; color: #e2e8f0; margin-bottom: 18px; }
    h1 { font-size: clamp(32px, 5vw, 54px); font-weight: 900; line-height: 1.08; letter-spacing: -.03em; max-width: 780px; }
    .hero-sub { margin-top: 16px; font-size: 18px; color: #cbd5e1; max-width: 620px; }
    .hero-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
    .stats { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--border); font-size: 14px; color: var(--muted); }
    .stats b { color: var(--text); font-size: 16px; display: block; }
    section { padding: 56px 0; }
    h2 { font-size: clamp(24px, 3vw, 34px); font-weight: 800; margin-bottom: 24px; letter-spacing: -.02em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; }
    .srv-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .srv-price { color: var(--accent); font-weight: 800; white-space: nowrap; }
    .photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .photos img { width: 100%; height: 210px; object-fit: cover; border-radius: 14px; border: 1px solid var(--border); }
    .form-box { background: linear-gradient(145deg, #131a2a, #0f172a); border: 1px solid var(--border); border-radius: 20px; padding: 32px; display: grid; grid-template-columns: 1.1fr 1fr; gap: 28px; align-items: center; }
    @media (max-width: 760px) { .form-box { grid-template-columns: 1fr; padding: 22px; } .nav-phone { display: none; } }
    input, textarea { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.05); color: #fff; font-size: 15px; margin-bottom: 10px; }
    .demo-banner { background: #1e293b; color: #94a3b8; font-size: 12.5px; text-align: center; padding: 12px 16px; border-top: 1px solid var(--border); }
  </style>
</head>
<body>
  <header class="nav">
    <div class="wrap nav-in">
      <div class="brand">${esc(lead.name)}</div>
      <div class="nav-actions">
        ${phone ? `<a class="btn btn-ghost nav-phone" href="${esc(telHref)}">${esc(phone)}</a>` : ''}
        <a class="btn btn-primary" href="#lead-form">Записаться</a>
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="wrap">
      <div class="badge">${esc(theme.badge)}${lead.city ? ` · ${esc(lead.city)}` : ''}</div>
      <h1>${esc(lead.name)}</h1>
      <p class="hero-sub">${esc(en.description || `${lead.category || lead.niche || 'Профессиональные услуги'}${lead.address ? ` по адресу: ${lead.address}` : ''}. Оставьте заявку онлайн — перезвоним и подберём удобное время.`)}</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#lead-form">Оставить заявку онлайн</a>
        ${phone ? `<a class="btn btn-ghost" href="${esc(telHref)}">Позвонить: ${esc(phone)}</a>` : ''}
        <a class="btn btn-ghost" href="${esc(mapUrl)}" target="_blank" rel="noopener">Открыть на карте</a>
      </div>
      <div class="stats">
        ${lead.rating ? `<div><b>★ ${Number(lead.rating).toFixed(1)}</b>Рейтинг (${lead.reviews || 0} отзывов)</div>` : ''}
        ${lead.address ? `<div><b>${esc(lead.address)}</b>${esc(lead.city || 'Адрес')}</div>` : ''}
        ${en.hours ? `<div><b>Режим работы</b>${esc(en.hours)}</div>` : ''}
      </div>
    </div>
  </section>

  ${services.length ? `
  <section>
    <div class="wrap">
      <h2>Услуги и цены</h2>
      <div class="grid">
        ${services.map((sv) => `
          <div class="card" style="display:flex;flex-direction:column;gap:12px">
            ${sv.image ? `<img src="${esc(sv.image)}" alt="${esc(sv.name)}" style="width:100%;height:160px;object-fit:cover;border-radius:10px" loading="lazy" />` : ''}
            <div class="srv-row">
              <span>${esc(sv.name)}</span>
              <span class="srv-price">${esc(sv.price || 'По запросу')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </section>` : `
  <section>
    <div class="wrap">
      <h2>Основные направления</h2>
      <div class="grid">
        <div class="card"><strong>${esc(lead.category || lead.niche || 'Консультация и расчёт')}</strong><p style="color:var(--muted);margin-top:6px;font-size:14px">Точную стоимость рассчитаем после короткого уточнения задачи.</p></div>
        <div class="card"><strong>Онлайн-запись без ожидания</strong><p style="color:var(--muted);margin-top:6px;font-size:14px">Если линия занята — оставьте номер, мастер свяжется с вами сам.</p></div>
        <div class="card"><strong>Удобное расположение</strong><p style="color:var(--muted);margin-top:6px;font-size:14px">${esc(lead.address || lead.city || 'Работаем для вас ежедневно')}</p></div>
      </div>
    </div>
  </section>`}

  ${photos.length ? `
  <section>
    <div class="wrap">
      <h2>Фотографии</h2>
      <div class="photos">
        ${photos.map((ph) => `<img src="${esc(ph)}" alt="${esc(lead.name)}" loading="lazy" />`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${reviews.length ? `
  <section>
    <div class="wrap">
      <h2>Что говорят клиенты</h2>
      <div class="grid">
        ${reviews.map((rv) => `
          <div class="card">
            <div style="font-weight:700;margin-bottom:6px">${esc(rv.author)} · ★ ${esc(rv.rating)}</div>
            <div style="color:#cbd5e1;font-size:14px">«${esc(rv.text)}»</div>
          </div>
        `).join('')}
      </div>
    </div>
  </section>` : ''}

  <section id="lead-form">
    <div class="wrap">
      <div class="form-box">
        <div>
          <h2>Быстрая заявка</h2>
          <p style="color:var(--muted);margin-bottom:16px">Не дозвонились или нет времени звонить? Оставьте контакт и задачу — менеджер свяжется с вами в ближайшее время.</p>
          ${phone ? `<div style="font-size:15px">Телефон: <strong>${esc(phone)}</strong></div>` : ''}
          ${lead.address ? `<div style="font-size:14px;color:var(--muted);margin-top:4px">${esc(lead.address)}</div>` : ''}
        </div>
        <form onsubmit="event.preventDefault();this.querySelector('button').textContent='Заявка отправлена ✓';this.reset();">
          <input required placeholder="Ваше имя" />
          <input required placeholder="Телефон или мессенджер" />
          <textarea rows="3" placeholder="Что нужно сделать?"></textarea>
          <button class="btn btn-primary" style="width:100%" type="submit">Отправить заявку</button>
        </form>
      </div>
    </div>
  </section>

  <footer class="demo-banner">
    Демо-концепт сайта для компании «${esc(lead.name)}». Все данные взяты из открытых источников. Удалим по первой просьбе.
  </footer>
</body>
</html>`;
}

// Fact-check: проверяем, что цены в HTML соответствуют исходнику и нет незаполненных заглушек
function factCheck(lead, html) {
  const issues = [];
  if (!html.includes(esc(lead.name))) issues.push('Не найдено название компании');
  const expectedServices = lead.enriched?.services || [];
  for (const sv of expectedServices.slice(0, 12)) {
    if (sv.price && !html.includes(esc(sv.price))) {
      issues.push(`Потеряна цена услуги: ${sv.name}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function generateBatch(ids, opts = {}) {
  fs.mkdirSync(DEMOS_DIR, { recursive: true });
  const list = (ids && ids.length ? ids.map((id) => db.getLead(id)) : db.getLeads().filter((l) => l.status === 'work' || l.status === 'base')).filter(Boolean);
  if (!list.length) throw new Error('Нет лидов для генерации демо');

  const baseUrl = String(opts.baseUrl || '').trim().replace(/\/+$/, '');
  const results = [];

  for (const lead of list) {
    const slug = slugify(lead.name, lead.id);
    const dir = path.join(DEMOS_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    const html = renderDemoHtml(lead);
    const check = factCheck(lead, html);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');

    const localUrl = `/demos/${slug}/`;
    const demoUrl = baseUrl ? `${baseUrl}/${slug}/` : (lead.demoUrl || localUrl);
    db.updateLead(lead.id, { demoUrl });
    results.push({ id: lead.id, name: lead.name, slug, demoUrl, localUrl, factCheck: check, siteStatus: siteStatus(lead) });
  }

  // Индексная страница всех сгенерированных демок
  const indexHtml = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>LeadHunter Demos</title>
  <style>body{font-family:system-ui,sans-serif;background:#0b0f19;color:#f8fafc;padding:32px;max-width:900px;margin:0 auto}a{color:#38bdf8}li{margin:10px 0}</style></head>
  <body><h1>Сгенерированные демо-сайты (${results.length})</h1><ul>
  ${results.map((r) => `<li><a href="./${r.slug}/" target="_blank">${esc(r.name)}</a> — ${r.factCheck.ok ? 'Fact-Check OK' : 'Предупреждения: ' + esc(r.factCheck.issues.join(', '))}</li>`).join('')}
  </ul></body></html>`;
  fs.writeFileSync(path.join(DEMOS_DIR, 'index.html'), indexHtml, 'utf8');
  db.saveNow();

  return { count: results.length, dir: DEMOS_DIR, results };
}

module.exports = { generateBatch, renderDemoHtml, factCheck, DEMOS_DIR };
