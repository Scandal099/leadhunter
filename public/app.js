// ---------- Состояние ----------
const S = {
  leads: [],
  byId: new Map(),
  filter: 'hot',
  selected: new Set(),
  shown: 120,
  settings: {},
  job: null,
  openId: null,
};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CLOUD_DEFAULTS = {
  twogisDomain: '2gis.ru',
  yandexDomain: 'yandex.ru',
  delayMs: 1200,
  siteCheckConcurrency: 6,
  supabaseUrl: 'https://mahpmhesnbgdmqvcddul.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1haHBtaGVzbmJnZG1xdmNkZHVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MzMwMzUsImV4cCI6MjExMDQwOTAzNX0.tzSJ58FPrQ_HEK_3y4AW4jwmR_ENpS7dKN7lJ91FhxU',
  messageTemplate: 'Здравствуйте! Нашёл вашу компанию «{name}» на картах. {problem} Я делаю современные сайты под ключ — быстро, с адаптивом под телефоны и формой заявки. Могу показать пару примеров и прислать бесплатный макет главной страницы. Интересно?',
};

let CLOUD_ONLY = false;
let cloudLastTs = 0;
let cloudLastSyncAt = 0;
let cloudLastErr = null;

function getCloudSettings() {
  try { return { ...CLOUD_DEFAULTS, ...JSON.parse(localStorage.getItem('lh-cloud-settings') || '{}') }; }
  catch { return { ...CLOUD_DEFAULTS }; }
}

async function sbFetch(path, options = {}) {
  const cfg = getCloudSettings();
  const base = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(cfg.supabaseKey || '').trim();
  if (!base || !key) throw new Error('Не указаны Supabase URL или Key в Настройках');
  const r = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(j?.message || j?.error || text || r.statusText);
  return j;
}

async function cloudFetchRows(sinceTs = 0) {
  const all = [];
  let offset = 0;
  const filter = sinceTs > 0 ? `updated_at=gt.${sinceTs}` : 'deleted=eq.false';
  while (true) {
    const rows = await sbFetch(`leads?select=id,data,updated_at,deleted&${filter}&order=updated_at.asc`, {
      headers: { Range: `${offset}-${offset + 999}` },
    });
    if (!Array.isArray(rows) || !rows.length) break;
    all.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function cloudApi(url, opts = {}) {
  const body = opts.body || {};
  if (url === '/api/settings') {
    if (opts.method === 'POST') {
      const next = { ...getCloudSettings(), ...body };
      localStorage.setItem('lh-cloud-settings', JSON.stringify(next));
      return next;
    }
    return getCloudSettings();
  }
  if (url === '/api/leads') {
    const rows = await cloudFetchRows(0);
    cloudLastTs = rows.reduce((m, r) => Math.max(m, r.updated_at || 0), 0) || Date.now();
    cloudLastSyncAt = Date.now();
    cloudLastErr = null;
    return rows.filter((r) => !r.deleted && r.data?.id).map((r) => r.data);
  }
  if (url.startsWith('/api/leads/') && opts.method === 'PATCH') {
    const id = url.split('/').pop();
    const l = S.byId.get(id);
    if (!l) throw new Error('Лид не найден');
    const updated = { ...l, ...body, updatedAt: Date.now() };
    await sbFetch('leads?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ id: updated.id, data: updated, updated_at: updated.updatedAt, deleted: false }]),
    });
    return updated;
  }
  if (url === '/api/leads/delete' && opts.method === 'POST') {
    const ids = body.ids || [];
    const now = Date.now();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200).map((id) => ({ id, data: {}, updated_at: now, deleted: true }));
      await sbFetch('leads?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
    }
    return { ok: true };
  }
  if (url === '/api/cloud/status' || url === '/api/cloud/sync') {
    if (url === '/api/cloud/sync') {
      const rows = await cloudFetchRows(0);
      cloudLastTs = rows.reduce((m, r) => Math.max(m, r.updated_at || 0), 0) || Date.now();
      cloudLastSyncAt = Date.now();
      cloudLastErr = null;
      setLeads(rows.filter((r) => !r.deleted && r.data?.id).map((r) => r.data));
    }
    return { enabled: true, connected: !cloudLastErr, lastSyncAt: cloudLastSyncAt, error: cloudLastErr, totalLeads: S.leads.length };
  }
  if (url === '/api/parse' || url === '/api/recheck' || url === '/api/stop') {
    throw new Error('Запуск парсера доступен только в LeadHunter.exe на ПК');
  }
  return {};
}

const api = async (url, opts = {}) => {
  if (CLOUD_ONLY) return cloudApi(url, opts);
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); }

const SITE = {
  none: { t: 'Без сайта', short: 'Без сайта' },
  social: { t: 'Только соцсети', short: 'Соцсети' },
  constructor: { t: 'Конструктор', short: 'Конструктор' },
  dead: { t: 'Сайт не работает', short: 'Не работает' },
  weak: { t: 'Слабый сайт', short: 'Слабый' },
  ok: { t: 'Нормальный сайт', short: 'Есть сайт' },
  unknown: { t: 'Не удалось проверить', short: 'Не проверен' },
};
const STATUS = { new: 'Новый', base: 'В базе', noanswer: 'Недозвон', work: 'В работе', client: 'Клиент', reject: 'Отказ' };
const SRC = { '2gis': ['2Г', 's-2gis', '2ГИС'], yandex: ['Я', 's-yandex', 'Яндекс'], google: ['G', 's-google', 'Google'] };
const HOT = new Set(['none', 'social', 'constructor', 'dead', 'weak']);
const NICHES = ['автосервис', 'шиномонтаж', 'барбершоп', 'салон красоты', 'стоматология', 'клининг', 'ремонт квартир', 'натяжные потолки', 'фитнес', 'юрист', 'бухгалтерские услуги', 'груминг', 'автомойка', 'кафе', 'пекарня', 'цветы', 'ветклиника', 'массаж', 'тату-салон', 'изготовление мебели'];

const I = {
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  wa: '<svg viewBox="0 0 24 24"><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/></svg>',
  tg: '<svg viewBox="0 0 24 24"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l8-6"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z"/></svg>',
  vk: '<svg viewBox="0 0 24 24"><path d="M3 7h3.5c.5 4 2.5 6 4 6.5V7H14v3.5c1.5-.2 3-2 3.5-3.5H21c-.5 2.5-2.5 4.5-4 5.3 1.5.7 3.5 2.6 4 4.7h-3.7c-.6-1.6-2-3-3.3-3.2V17h-1C7 17 3.5 13 3 7z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
};

// ---------- Навигация ----------
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if ($('#view-' + v)) go(v); });
function go(view) {
  closeDrawer();
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'clients') renderKanban();
  if (view === 'stats') renderStats();
  if (view === 'settings') fillSettings();
  history.replaceState(null, '', '#' + view);
}
window.go = go;
$$('.nav-btn').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));

// ---------- Данные ----------
function setLeads(list) {
  S.leads = list;
  S.byId = new Map(list.map((l) => [l.id, l]));
  if (CLOUD_ONLY) {
    try { localStorage.setItem('lh-cloud-cache', JSON.stringify(list)); } catch {}
  }
}
function upsertLocal(l) {
  const isNew = !S.byId.has(l.id);
  if (isNew) S.leads.push(l); else Object.assign(S.byId.get(l.id), l);
  S.byId.set(l.id, isNew ? l : S.byId.get(l.id));
  return isNew;
}
const siteStatus = (l) => l.site?.status || (l.website ? 'pending' : (l.socials?.length ? 'social' : 'none'));
const score = (l) => l.site?.score ?? (l.website ? 50 : 100);

function problemText(l) {
  const s = siteStatus(l);
  if (s === 'none') return 'Заметил, что у вас нет сайта — клиенты из поиска уходят к конкурентам.';
  if (s === 'social') return 'Вижу, что вместо сайта у вас только соцсети — из поиска Яндекса и Google вас почти не найти.';
  if (s === 'constructor') return `Ваш сайт собран на конструкторе${l.site?.builder ? ' (' + l.site.builder + ')' : ''} — такие сайты плохо продвигаются и выглядят шаблонно.`;
  if (s === 'dead') return 'Ваш сайт сейчас не открывается — клиенты видят ошибку.';
  if (s === 'weak') return 'Ваш сайт выглядит устаревшим и плохо открывается с телефона.';
  return 'Посмотрел ваш сайт — есть что улучшить по заявкам и скорости.';
}

// ---------- Фильтры ----------
function applyFilters() {
  const q = $('#q').value.trim().toLowerCase();
  const city = $('#f-city').value, niche = $('#f-niche').value, src = $('#f-src').value;
  const hideTaken = $('#f-hide-taken').checked;
  let list = S.leads.filter((l) => {
    const s = siteStatus(l);
    if (S.filter === 'hot' && !(HOT.has(s) || s === 'pending')) return false;
    if (!['hot', 'all'].includes(S.filter) && s !== S.filter) return false;
    if (city && l.city !== city) return false;
    if (niche && l.niche !== niche) return false;
    if (src && !l.sources.some((x) => x.src === src)) return false;
    if (hideTaken && l.status !== 'new') return false;
    if (q && !(l.name + ' ' + l.address + ' ' + l.category + ' ' + l.phones.join(' ') + ' ' + l.website + ' ' + l.note).toLowerCase().includes(q)) return false;
    return true;
  });
  const sort = $('#f-sort').value;
  const cmp = {
    score: (a, b) => score(b) - score(a) || (b.reviews || 0) - (a.reviews || 0),
    new: (a, b) => b.createdAt - a.createdAt,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    reviews: (a, b) => (b.reviews || 0) - (a.reviews || 0),
    name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  }[sort];
  return list.sort(cmp);
}

function counts() {
  const c = { all: S.leads.length, hot: 0, none: 0, social: 0, constructor: 0, dead: 0, weak: 0, ok: 0, clients: 0 };
  for (const l of S.leads) {
    const s = siteStatus(l);
    if (c[s] !== undefined) c[s]++;
    if (HOT.has(s) || s === 'pending') c.hot++;
    if (l.status === 'client') c.clients++;
  }
  return c;
}

function fillSelect(sel, values, label) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

// ---------- Карточки ----------
function cardHtml(l, flash) {
  const s = siteStatus(l);
  const chip = s === 'pending' ? '<span class="chip pending"><i></i>Проверяю…</span>' : `<span class="chip ${s}"><i></i>${SITE[s].short}</span>`;
  const phone = l.phones[0];
  const digits = phone ? phone.replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1') : '';
  const tg = l.socials.find((x) => /t\.me|telegram/.test(x));
  const reason = l.site?.reasons?.[0] || (s === 'pending' ? 'Проверяем сайт ' + l.website : '');
  const mainMap = mainMapLink(l, S.settings);
  const taken = l.status !== 'new';
  return `<div class="card ${HOT.has(s) ? 'hot' : ''} ${S.selected.has(l.id) ? 'selected' : ''} ${l.status === 'reject' ? 'taken' : ''} ${flash ? 'flash' : ''}" data-id="${l.id}">
    <div class="c-top">
      <span class="cb" data-act="sel"></span>${chip}
      ${l.status !== 'new' ? `<span class="chip st">${STATUS[l.status]}</span>` : ''}
      ${l.sources.map((x) => `<a class="src" href="${esc(x.url || mapLinks(l, S.settings).find((m) => m.src === x.src).url)}" target="_blank" title="Открыть в ${SRC[x.src]?.[2]}"><b class="src-dot ${SRC[x.src]?.[1]}" style="margin:0;width:7px;height:7px"></b></a>`).join('')}
      ${l.rating ? `<span class="rating">${I.star}${Number(l.rating).toFixed(1)}${l.reviews ? `<small>(${l.reviews})</small>` : ''}</span>` : ''}
    </div>
    <h3 class="c-name">${esc(l.name)}</h3>
    <div class="c-meta">${I.pin}<span>${esc([l.city, l.category].filter(Boolean).join(' · ') || '—')}</span></div>
    <div class="c-meta" style="margin-top:3px"><span>${esc(l.address || '')}</span></div>
    ${phone ? `<div class="c-meta c-phone" style="margin-top:3px">${I.phone}<span>${esc(phone)}${l.phones.length > 1 ? ` <small>+${l.phones.length - 1}</small>` : ''}</span></div>` : ''}
    ${reason ? `<div class="c-reason" title="${esc((l.site?.reasons || []).join('\n'))}">${esc(reason)}</div>` : ''}
    <div class="c-bottom">
      <a class="ib ${phone ? '' : 'off'}" href="tel:+${digits}" title="${esc(phone || 'Нет телефона')}" data-act="copyphone">${I.phone}</a>
      <a class="ib ${digits ? '' : 'off'}" href="https://wa.me/${digits}" target="_blank" title="WhatsApp">${I.wa}</a>
      <a class="ib ${tg ? '' : 'off'}" href="${esc(tg || '#')}" target="_blank" title="Telegram">${I.tg}</a>
      <a class="ib ${l.website ? '' : 'off'}" href="${esc(l.website || '#')}" target="_blank" title="${esc(l.website || 'Нет сайта')}">${I.globe}</a>
      <a class="ib" href="${esc(mainMap.url)}" target="_blank" title="${mainMap.direct ? 'Открыть страницу в ' + mainMap.name : 'Найти в ' + mainMap.name}">${I.map}</a>
      <button class="take ${taken ? 'done' : ''}" data-act="take">${taken ? '✓ ' + STATUS[l.status] : '+ В базу'}</button>
    </div>
  </div>`;
}

let renderQueued = false;
function scheduleRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); } }
const flashIds = new Set();

function render() {
  const c = counts();
  for (const k of ['hot', 'all', 'none', 'social', 'constructor', 'dead', 'weak']) $('#c-' + k).textContent = c[k];
  fillSelect($('#f-city'), [...new Set(S.leads.map((l) => l.city).filter(Boolean))].sort(), 'Все города');
  fillSelect($('#f-niche'), [...new Set(S.leads.map((l) => l.niche).filter(Boolean))].sort(), 'Все ниши');
  const list = applyFilters();
  $('#st-shown').textContent = `Показано ${Math.min(list.length, S.shown)} из ${list.length} (в базе ${c.all})`;
  $('#st-none').textContent = `${c.none} без сайта`;
  $('#st-constructor').textContent = `${c.constructor} на конструкторе`;
  $('#st-social').textContent = `${c.social} только соцсети`;
  $('#st-clients').textContent = `${c.clients} клиентов`;
  $('#grid').innerHTML = list.slice(0, S.shown).map((l) => cardHtml(l, flashIds.has(l.id))).join('');
  flashIds.clear();
  $('#btn-more').classList.toggle('hidden', list.length <= S.shown);
  $('#empty').classList.toggle('hidden', S.leads.length > 0);
  $('#bulkbar').classList.toggle('hidden', S.selected.size === 0);
  $('#bulk-count').textContent = `${S.selected.size} выбрано`;
  if (S.openId) renderDrawer();
  if ($('#view-clients').classList.contains('active')) renderKanban();
}

$('#grid').addEventListener('click', async (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  const id = card.dataset.id; const l = S.byId.get(id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'sel') { e.preventDefault(); e.stopPropagation(); S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); return render(); }
  if (act === 'take') { e.stopPropagation(); await patch(id, { status: l.status === 'new' ? 'base' : 'new' }); return; }
  if (act === 'copyphone') { navigator.clipboard?.writeText(l.phones.join(', ')); toast('Телефон скопирован'); }
  if (e.target.closest('a')) return;
  openDrawer(id);
});

async function patch(id, body) {
  const l = await api('/api/leads/' + id, { method: 'PATCH', body });
  upsertLocal(l); scheduleRender();
  return l;
}

// ---------- Drawer ----------
function openDrawer(id) { S.openId = id; renderDrawer(); $('#drawer').classList.add('open'); }
function closeDrawer() { S.openId = null; $('#drawer').classList.remove('open'); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

function renderDrawer() {
  const l = S.byId.get(S.openId); if (!l) return closeDrawer();
  const s = siteStatus(l);
  const body = $('#drawer-body');
  if (body.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) return; // не мешаем вводу
  const msg = (S.settings.messageTemplate || '').replace('{name}', l.name).replace('{problem}', problemText(l));
  const ratingCompliment = l.rating ? `у вас высокий рейтинг ${Number(l.rating).toFixed(1)} и хорошие отзывы` : 'хорошие цены и услуги';
  const mainPain = (l.enriched?.audit?.[0] || problemText(l)).replace(/\.$/, '').toLowerCase();
  const callScript = `Здравствуйте! Я программист. Посмотрел вашу компанию «${l.name}» на картах — ${ratingCompliment}. Заметил, что ${mainPain}. Я уже собрал для вас бесплатную демо-версию сайта с вашими данными и фото. Давайте скину ссылку в мессенджер — посмотрите, если понравится, обсудим детали.`;
  const digits = (l.phones[0] || '').replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');
  const qName = encodeURIComponent(`${l.name} ${l.city}`);
  body.innerHTML = `
    <div class="d-head"><h2>${esc(l.name)}</h2><button class="x" onclick="closeDrawer()">✕</button></div>
    <div class="c-meta" style="margin-top:8px">${I.pin}<span>${esc([l.city, l.category].filter(Boolean).join(' · '))}</span></div>
    <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(l.address)}</div>
    <div class="chips" style="margin-top:12px">
      ${s === 'pending' ? '<span class="chip pending"><i></i>Проверяю…</span>' : `<span class="chip ${s}"><i></i>${SITE[s].t}</span>`}
      ${l.rating ? `<span class="chip">★ ${Number(l.rating).toFixed(1)} · ${l.reviews || 0} отзывов</span>` : ''}
      ${l.site?.score != null ? `<span class="chip">Потребность в сайте: ${l.site.score}%</span>` : ''}
    </div>

    <div class="d-sec"><h4>Страница на картах</h4><div class="maps">
      ${mapLinks(l, S.settings).map((m) => `<a class="map-btn ${m.direct ? 'direct' : ''}" href="${esc(m.url)}" target="_blank">
        <b class="src-dot ${SRC[m.src][1]}"></b><span><strong>${m.name}</strong><small>${m.direct ? 'Открыть страницу' : 'Найти на карте'}</small></span>${I.map}</a>`).join('')}
    </div></div>

    <div class="d-sec"><h4>Статус</h4><div class="chips">
      ${Object.entries(STATUS).map(([k, v]) => `<button class="st-btn ${l.status === k ? 'on' : ''}" data-status="${k}">${v}</button>`).join('')}
    </div></div>

    <div class="d-sec"><h4>Сайт</h4>
      ${l.website ? `<div class="kv">${I.globe}<a href="${esc(l.website)}" target="_blank">${esc(l.website)}</a></div>` : '<div class="muted">Сайт на картах не указан</div>'}
      ${l.site?.title ? `<div class="muted" style="font-size:12.5px">Заголовок: ${esc(l.site.title)}</div>` : ''}
      ${l.site?.reasons?.length ? `<ul style="margin-top:8px">${l.site.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <button class="pill" style="margin-top:10px" data-d="recheck">Перепроверить сайт</button>
    </div>

    <div class="d-sec"><h4>Контакты</h4>
      ${l.phones.map((p) => `<div class="kv">${I.phone}<a href="tel:${esc(p)}">${esc(p)}</a><button class="pill copy" data-copy="${esc(p)}">Копировать</button></div>`).join('') || '<div class="muted">Телефонов нет</div>'}
      ${(l.emails || []).map((m) => `<div class="kv">✉<a href="mailto:${esc(m)}">${esc(m)}</a></div>`).join('')}
      ${l.socials.map((x) => `<div class="kv">${I.globe}<a href="${esc(x)}" target="_blank">${esc(x)}</a></div>`).join('')}
    </div>

    <div class="d-sec"><h4>Где искать ЛПР (владельца)</h4><div class="chips">
      <a class="pill" target="_blank" href="https://www.google.com/search?q=${qName}+владелец+OR+директор">Поиск в Google</a>
      <a class="pill" target="_blank" href="https://yandex.ru/search/?text=${qName}+директор">Поиск в Яндексе</a>
      <a class="pill" target="_blank" href="https://www.rusprofile.ru/search?query=${encodeURIComponent(l.name)}">Rusprofile</a>
      <a class="pill" target="_blank" href="https://vk.com/search?c%5Bq%5D=${encodeURIComponent(l.name)}&c%5Bsection%5D=communities">VK</a>    </div>
    <label class="field"><span>Контактное лицо</span><input data-f="contactPerson" value="${esc(l.contactPerson)}" placeholder="Имя, должность, личный контакт"/></label>
    <label class="field"><span>Ссылка на демо-сайт</span><div style="display:flex;gap:6px"><input data-f="demoUrl" value="${esc(l.demoUrl)}" placeholder="https://username.github.io/demo-..." style="flex:1"/>${l.demoUrl ? `<a class="pill" href="${esc(l.demoUrl)}" target="_blank">Открыть</a>` : ''}</div></label>
    <label class="field"><span>Заметка</span><textarea data-f="note" rows="3" placeholder="Позвонил, перезвонить в пятницу…">${esc(l.note)}</textarea></label>
    </div>

    <div class="d-sec"><h4>Данные для нейронки (Deep Enrich)</h4>
      ${l.enriched ? `
        <div class="chips">
          <span class="chip">Фото: ${l.enriched.photos?.length || 0}</span>
          <span class="chip">Услуг/цен: ${l.enriched.services?.length || 0}</span>
          <span class="chip">Отзывов: ${l.enriched.reviews?.length || 0}</span>
        </div>
        ${l.enriched.hours ? `<div class="muted" style="font-size:12px;margin-top:6px">Часы: ${esc(l.enriched.hours)}</div>` : ''}
        ${l.enriched.audit?.length ? `<ul style="margin-top:6px;font-size:12.5px">${l.enriched.audit.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        ${l.enriched.services?.length ? `<div class="muted" style="font-size:12px;margin-top:6px"><strong>Прайс:</strong> ${l.enriched.services.slice(0, 6).map((sv) => `${esc(sv.name)}${sv.price ? ' — ' + esc(sv.price) : ''}`).join(' · ')}</div>` : ''}
      ` : '<div class="muted">Ещё не допарсено (нет фото и прайса из карточки)</div>'}
      <div class="chips" style="margin-top:10px">
        <button class="pill" data-d="enrich">Допарсить карточку</button>
        <button class="pill glow" data-d="demo">Сделать демо</button>
      </div>
    </div>

    <div class="d-sec"><h4>Режим прозвона (скрипт)</h4>
      <div class="msg" id="d-call">${esc(callScript)}</div>
      <div class="chips" style="margin-top:10px">
        <button class="pill" data-copy-call>Копировать скрипт</button>
        <button class="pill" data-call-res="noanswer">Недозвон</button>
        <button class="pill glow" data-call-res="sent">Скинул демо</button>
        <button class="pill" data-call-res="reject">Отказ</button>
        <button class="pill glow" data-call-res="client">Клиент!</button>
      </div>
    </div>

    <div class="d-sec"><h4>Сообщение для первого касания</h4>
      <div class="msg" id="d-msg">${esc(msg)}</div>
      <div class="chips" style="margin-top:10px">
        <button class="pill glow" data-copy-msg>Скопировать текст</button>
        ${digits ? `<a class="pill" target="_blank" href="https://wa.me/${digits}?text=${encodeURIComponent(msg)}">Открыть в WhatsApp</a>` : ''}
      </div>
    </div>`;
}
$('#drawer-body').addEventListener('click', async (e) => {
  const l = S.byId.get(S.openId); if (!l) return;
  const st = e.target.closest('[data-status]');
  if (st) { await patch(l.id, { status: st.dataset.status }); toast('Статус: ' + STATUS[st.dataset.status]); return renderDrawer(); }
  const cp = e.target.closest('[data-copy]');
  if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); return toast('Скопировано'); }
  if (e.target.closest('[data-copy-msg]')) { navigator.clipboard?.writeText($('#d-msg').textContent); return toast('Сообщение скопировано'); }
  if (e.target.closest('[data-copy-call]')) { navigator.clipboard?.writeText($('#d-call').textContent); return toast('Скрипт звонка скопирован'); }
  const cr = e.target.closest('[data-call-res]');
  if (cr) {
    const type = cr.dataset.callRes;
    const stamp = new Date().toLocaleDateString('ru-RU');
    const prevNote = l.note ? l.note + '\n' : '';
    if (type === 'noanswer') await patch(l.id, { status: 'noanswer', note: `${prevNote}[${stamp}] Недозвон` });
    if (type === 'sent') await patch(l.id, { status: 'work', note: `${prevNote}[${stamp}] Созвон — скинул демо` });
    if (type === 'reject') await patch(l.id, { status: 'reject', note: `${prevNote}[${stamp}] Отказ` });
    if (type === 'client') await patch(l.id, { status: 'client', note: `${prevNote}[${stamp}] Договорились / Оплата` });
    toast('Результат звонка сохранён');
    return renderDrawer();
  }
  if (e.target.closest('[data-d=recheck]')) { await api('/api/recheck', { method: 'POST', body: { ids: [l.id] } }); toast('Сайт отправлен на проверку'); }
  if (e.target.closest('[data-d=enrich]')) {
    try { await api('/api/enrich', { method: 'POST', body: { ids: [l.id] } }); toast('Допарсинг карточки запущен'); }
    catch (err) { toast(err.message); }
  }
  if (e.target.closest('[data-d=demo]')) {
    try {
      const baseUrl = (localStorage.getItem('lh-demo-baseurl') || '').trim();
      const r = await api('/api/demos/generate', { method: 'POST', body: { ids: [l.id], baseUrl } });
      const item = r.results?.[0];
      if (item) {
        const updated = await api('/api/leads');
        setLeads(updated);
        renderDrawer();
        toast('Демо готово ✓');
        window.open(item.localUrl, '_blank');
      }
    } catch (err) { toast(err.message); }
  }
});
$('#drawer-body').addEventListener('change', (e) => {
  const f = e.target.dataset.f; if (f) patch(S.openId, { [f]: e.target.value }).then(() => toast('Сохранено'));
});

// ---------- Панель фильтров ----------
$$('#site-tabs .tab').forEach((t) => t.addEventListener('click', () => {
  $$('#site-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
  S.filter = t.dataset.f; S.shown = 120; render();
}));
['#q', '#f-city', '#f-niche', '#f-src', '#f-sort', '#f-hide-taken'].forEach((s) => $(s).addEventListener(s === '#q' ? 'input' : 'change', () => { S.shown = 120; render(); }));
$('#btn-more').addEventListener('click', () => { S.shown += 120; render(); });
$('#btn-pick-n')?.addEventListener('click', () => {
  const n = Math.max(1, Math.min(500, +$('#pick-count')?.value || 20));
  const list = applyFilters().slice(0, n);
  S.selected.clear();
  list.forEach((l) => S.selected.add(l.id));
  render();
  toast(`Выбрано ${list.length} лидов`);
});
$('#btn-select-all').addEventListener('click', () => {
  const list = applyFilters();
  const all = list.every((l) => S.selected.has(l.id));
  list.forEach((l) => (all ? S.selected.delete(l.id) : S.selected.add(l.id)));
  render();
});
function exportLeadsCsv(list) {
  if (CLOUD_ONLY) {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const header = ['Название', 'Ниша', 'Город', 'Адрес', 'Телефоны', 'Сайт', 'Состояние', 'Статус', 'Контакт', 'Заметка'].map(q).join(';');
    const rows = list.map((l) => [
      l.name, l.niche || l.category, l.city, l.address, (l.phones || []).join(', '),
      l.website, SITE[siteStatus(l)]?.t || '', STATUS[l.status] || l.status, l.contactPerson, l.note,
    ].map(q).join(';'));
    const blob = new Blob(['\uFEFF' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    return;
  }
  location.href = '/api/export.csv?ids=' + list.map((l) => l.id).join(',');
}
function exportLeadsMd(list, title = 'Выгрузка лидов для нейросети') {
  if (!list.length) return toast('Нет лидов для выгрузки');
  const lines = [
    `# ${title}`,
    `Дата: ${new Date().toISOString().slice(0, 10)} · Всего компаний: ${list.length}`,
    '',
    '## Инструкция для нейросети',
    'Открой указанные ссылки по каждой компании (сайт, соцсети, карты 2ГИС/Яндекс/Google, Rusprofile, VK) и собери структурированную карточку:',
    '1. Чем именно занимается компания, основные услуги и примерный прайс.',
    '2. Найденный ЛПР / владелец / директор (имя, должность, личные контакты/соцсети).',
    '3. Что не так с текущим сайтом или упаковкой в соцсетях (почему им нужен новый сайт).',
    '4. Персонализированное сообщение для первого касания под конкретную компанию.',
    '',
    '---',
    '',
  ];
  list.forEach((l, idx) => {
    const s = siteStatus(l);
    const maps = mapLinks(l, S.settings);
    const qName = encodeURIComponent(`${l.name} ${l.city}`.trim());
    const msg = (S.settings.messageTemplate || '').replace('{name}', l.name).replace('{problem}', problemText(l));
    lines.push(`## ${idx + 1}. ${l.name}`);
    lines.push(`- **ID:** \`${l.id}\``);
    lines.push(`- **Статус в воронке:** ${STATUS[l.status] || l.status}`);
    if (l.niche || l.category) lines.push(`- **Ниша / категория:** ${[l.niche, l.category].filter(Boolean).join(' · ')}`);
    if (l.city || l.address) lines.push(`- **Локация:** ${[l.city, l.address].filter(Boolean).join(', ')}`);
    if (l.rating) lines.push(`- **Рейтинг:** ${l.rating}${l.reviews ? ` (${l.reviews} отзывов)` : ''}`);
    if (l.phones?.length) lines.push(`- **Телефоны:** ${l.phones.join(', ')}`);
    lines.push(`- **Сайт:** ${l.website || 'нет'} (${SITE[s]?.t || s}${l.site?.builder ? `, конструктор: ${l.site.builder}` : ''})`);
    if (l.site?.reasons?.length) lines.push(`- **Проблемы сайта:** ${l.site.reasons.join('; ')}`);
    if (l.socials?.length) lines.push(`- **Соцсети:** ${l.socials.join(', ')}`);
    if (l.emails?.length) lines.push(`- **Email:** ${l.emails.join(', ')}`);
    if (l.contactPerson) lines.push(`- **Контактное лицо:** ${l.contactPerson}`);
    if (l.demoUrl) lines.push(`- **Готовое демо:** ${l.demoUrl}`);
    if (l.note) lines.push(`- **Заметка:** ${l.note}`);
    if (l.enriched) {
      const en = l.enriched;
      if (en.hours) lines.push(`- **Часы работы:** ${en.hours}`);
      if (en.description) lines.push(`- **Описание:** ${en.description}`);
      if (en.audit?.length) lines.push(`- **Найденные боли (аудит):** ${en.audit.join('; ')}`);
      if (en.services?.length) {
        lines.push(`- **Реальные услуги и прайс (НЕ ВЫДУМЫВАТЬ ДРУГИХ ЦЕН):**`);
        en.services.forEach((sv) => lines.push(`  - ${sv.name}${sv.price ? ` — ${sv.price}` : ''}`));
      }
      if (en.photos?.length) {
        lines.push(`- **Реальные фото (${en.photos.length} шт.):**`);
        en.photos.forEach((ph) => lines.push(`  - ${ph}`));
      }
      if (en.reviews?.length) {
        lines.push(`- **Реальные отзывы:**`);
        en.reviews.forEach((rv) => lines.push(`  - ${rv.author} (★${rv.rating}): "${rv.text}"`));
      }
      if (en.siteSummary?.text) {
        lines.push(`- **Контент текущего сайта:** ${en.siteSummary.title ? `[${en.siteSummary.title}] ` : ''}${en.siteSummary.text.slice(0, 600)}`);
      }
    }
    lines.push(`- **Карты:** ${maps.map((m) => `[${m.name}${m.direct ? ' (прямая)' : ''}](${m.url})`).join(' | ')}`);
    lines.push(`- **Поиск ЛПР:** [Google](https://www.google.com/search?q=${qName}+владелец+OR+директор) | [Яндекс](https://yandex.ru/search/?text=${qName}+директор) | [Rusprofile](https://www.rusprofile.ru/search?query=${encodeURIComponent(l.name)}) | [VK](https://vk.com/search?c%5Bq%5D=${encodeURIComponent(l.name)}&c%5Bsection%5D=communities)`);
    if (msg) lines.push(`- **Шаблон первого касания:** ${msg}`);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `leads-ai-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  toast(`Скачано ${list.length} лидов в .md`);
}
function exportLeadsAiJson(list) {
  if (!list.length) return toast('Нет лидов для выгрузки');
  if (!CLOUD_ONLY) {
    location.href = '/api/export.ai.json?ids=' + list.map((l) => l.id).join(',');
    return toast(`Выгружаю AI-пакет (.json) для ${list.length} лидов`);
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    count: list.length,
    leads: list,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `leads-ai-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast(`Скачано ${list.length} лидов в AI-пакет (.json)`);
}
$('#btn-export').addEventListener('click', () => exportLeadsCsv(applyFilters()));
$('#btn-export-md')?.addEventListener('click', () => exportLeadsMd(applyFilters(), 'Выгрузка из базы для нейросети'));
$('#btn-funnel-md')?.addEventListener('click', () => {
  const list = S.leads.filter((l) => l.status === 'base' || l.status === 'noanswer' || l.status === 'work' || l.status === 'client');
  exportLeadsMd(list, 'Выгрузка из воронки для нейросети');
});
$('#btn-funnel-json')?.addEventListener('click', () => {
  const list = S.leads.filter((l) => l.status === 'base' || l.status === 'noanswer' || l.status === 'work' || l.status === 'client');
  exportLeadsAiJson(list);
});
async function runGenerateDemos(ids) {
  const savedBase = localStorage.getItem('lh-demo-baseurl') || '';
  const baseUrl = prompt('Базовый URL для хостинга демок (например https://username.github.io/demos) или оставь пустым для локального /demos/:', savedBase);
  if (baseUrl === null) return;
  localStorage.setItem('lh-demo-baseurl', baseUrl.trim());
  try {
    const r = await api('/api/demos/generate', { method: 'POST', body: { ids, baseUrl: baseUrl.trim() } });
    toast(`Сгенерировано ${r.count} демо-сайтов`);
    window.open('/demos/', '_blank');
  } catch (err) { toast(err.message); }
}
$('#btn-gen-demos')?.addEventListener('click', () => {
  const ids = S.leads.filter((l) => l.status === 'work' || l.status === 'base').map((l) => l.id);
  runGenerateDemos(ids);
});
$('#btn-recheck').addEventListener('click', async () => {
  try {
    const ids = applyFilters().map((l) => l.id);
    const r = await api('/api/recheck', { method: 'POST', body: { ids } });
    toast(`Проверяю ${r.queued} сайтов`);
  } catch (e) { toast(e.message); }
});
$('#bulkbar').addEventListener('click', async (e) => {
  const a = e.target.dataset.bulk; if (!a) return;
  const ids = [...S.selected];
  if (a === 'clear') S.selected.clear();
  if (a === 'enrich') {
    try {
      await api('/api/enrich', { method: 'POST', body: { ids, targetStatus: 'base' } });
      toast(`Запущен допарсинг ${ids.length} лидов (переведены в «В базе»)`);
      S.selected.clear();
    } catch (err) { toast(err.message); }
  }
  if (a === 'demos') {
    await runGenerateDemos(ids);
    S.selected.clear();
  }
  if (a === 'ai') {
    const selected = S.leads.filter((l) => S.selected.has(l.id));
    for (const l of selected) {
      if (l.status === 'new') await patch(l.id, { status: 'base' });
    }
    exportLeadsMd(S.leads.filter((l) => S.selected.has(l.id)), 'Выбранные лиды для нейросети');
    S.selected.clear();
  }
  if (a === 'ai-json') {
    exportLeadsAiJson(S.leads.filter((l) => S.selected.has(l.id)));
    S.selected.clear();
  }
  if (a === 'base' || a === 'reject') { for (const id of ids) await patch(id, { status: a }); toast('Готово'); S.selected.clear(); }
  if (a === 'recheck') { try { await api('/api/recheck', { method: 'POST', body: { ids } }); toast('Проверяю сайты'); } catch (err) { toast(err.message); } }
  if (a === 'export') exportLeadsCsv(S.leads.filter((l) => S.selected.has(l.id)));
  if (a === 'delete') {
    if (!confirm(`Удалить ${ids.length} записей из базы?`)) return;
    await api('/api/leads/delete', { method: 'POST', body: { ids } });
    setLeads(S.leads.filter((l) => !S.selected.has(l.id))); S.selected.clear();
  }
  render();
});

// ---------- Парсер ----------
$('#quick-niches').innerHTML = NICHES.map((n) => `<button>${n}</button>`).join('');
$('#quick-niches').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const ta = $('#f-niches'); const cur = ta.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (!cur.includes(e.target.textContent)) cur.push(e.target.textContent);
  ta.value = cur.join(', ');
});
$$('#f-sources .tgl').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
$$('#f-save-statuses .tgl').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
$$('#f-limit button').forEach((b) => b.addEventListener('click', () => { $('#f-limit input').value = b.dataset.v; }));
const PREF_KEY = 'lh-form';
function saveForm() {
  localStorage.setItem(PREF_KEY, JSON.stringify({
    niches: $('#f-niches').value, cities: $('#f-cities').value, limit: $('#f-limit input').value,
    headless: $('#f-headless').checked, check: $('#f-check').checked,
    sources: $$('#f-sources .tgl.on').map((b) => b.dataset.src),
    saveStatuses: $$('#f-save-statuses .tgl.on').map((b) => b.dataset.st),
  }));
}
(function loadForm() {
  try {
    const f = JSON.parse(localStorage.getItem(PREF_KEY)); if (!f) return;
    $('#f-niches').value = f.niches || ''; $('#f-cities').value = f.cities || ''; $('#f-limit input').value = f.limit || 50;
    $('#f-headless').checked = !!f.headless; $('#f-check').checked = f.check !== false;
    $$('#f-sources .tgl').forEach((b) => b.classList.toggle('on', (f.sources || []).includes(b.dataset.src)));
    if (Array.isArray(f.saveStatuses)) {
      $$('#f-save-statuses .tgl').forEach((b) => b.classList.toggle('on', f.saveStatuses.includes(b.dataset.st)));
    }
  } catch {}
})();

$('#btn-start').addEventListener('click', async () => {
  saveForm();
  try {
    await api('/api/parse', { method: 'POST', body: {
      niches: $('#f-niches').value, cities: $('#f-cities').value,
      sources: $$('#f-sources .tgl.on').map((b) => b.dataset.src),
      saveStatuses: $$('#f-save-statuses .tgl.on').map((b) => b.dataset.st),
      limit: +$('#f-limit input').value, headless: $('#f-headless').checked, checkSites: $('#f-check').checked,
    } });
    $('#log').innerHTML = '';
  } catch (e) { toast(e.message); }
});
$('#btn-stop').addEventListener('click', () => api('/api/stop', { method: 'POST' }));

function renderJob(j) {
  S.job = j;
  const running = !!j?.running;
  $('.progress-panel').classList.toggle('running', running);
  $('#btn-start').disabled = running;
  $('#btn-start span').textContent = running ? 'Идёт парсинг…' : 'Запустить парсинг';
  $('#btn-stop').classList.toggle('hidden', !running);
  $('.nav-btn[data-view=parser]').classList.toggle('busy', running);
  if (!j) return;
  $('#p-found').textContent = j.found;
  $('#p-new').textContent = j.newLeads;
  $('#p-tasks').textContent = `${j.done}/${j.total}`;
  $('#p-checked').textContent = j.checked || 0;
  $('#p-current').textContent = running ? j.current || 'Запуск браузера…' : (j.finishedAt ? 'Готово ✓' : '');
  const pct = j.total ? j.done / j.total : 0;
  $('#ring-fg').style.strokeDashoffset = 327 - 327 * (running ? Math.max(pct, 0.08) : pct);
}
function addLog(e) {
  const box = $('#log');
  const d = document.createElement('div');
  d.innerHTML = `<time>${new Date(e.t).toLocaleTimeString('ru')}</time>${esc(e.msg)}`;
  box.appendChild(d);
  while (box.children.length > 300) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

// ---------- Воронка ----------
function renderKanban() {
  const cols = [['base', 'В базе'], ['noanswer', 'Недозвон'], ['work', 'В работе'], ['client', 'Клиенты'], ['reject', 'Отказ']];
  $('#kanban').innerHTML = cols.map(([k, t]) => {
    const items = S.leads.filter((l) => l.status === k).sort((a, b) => b.updatedAt - a.updatedAt);
    return `<div class="col glass" data-col="${k}"><h3 style="display:flex;align-items:center;gap:6px">${t}<b>${items.length}</b>${items.length ? `<button class="pill" data-col-clear="${k}" style="margin-left:auto;padding:2px 8px;font-size:11px" title="Убрать всех из колонки">Очистить</button>` : ''}</h3><div class="col-body">${items.map((l) => `
      <div class="card" draggable="true" data-id="${l.id}">
        <div class="c-top"><span class="chip ${siteStatus(l) === 'pending' ? 'pending' : siteStatus(l)}"><i></i>${SITE[siteStatus(l)]?.short || '…'}</span>${l.rating ? `<span class="rating">${I.star}${Number(l.rating).toFixed(1)}</span>` : ''}<button class="pill" data-k-remove="${l.id}" title="Убрать из воронки (в Новые)" style="margin-left:auto;padding:2px 7px;font-size:11px;line-height:1">✕</button></div>
        <h3 class="c-name">${esc(l.name)}</h3>
        <div class="c-meta">${esc(l.phones[0] || '')}</div>
        ${l.note ? `<div class="c-reason">${esc(l.note)}</div>` : ''}
      </div>`).join('')}</div></div>`;
  }).join('');
}
$('#kanban').addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-k-remove]');
  if (rm) {
    e.stopPropagation();
    await patch(rm.dataset.kRemove, { status: 'new' });
    renderKanban();
    return toast('Убрано из воронки');
  }
  const clr = e.target.closest('[data-col-clear]');
  if (clr) {
    e.stopPropagation();
    const colKey = clr.dataset.colClear;
    const items = S.leads.filter((l) => l.status === colKey);
    if (!items.length) return;
    if (!confirm(`Убрать ${items.length} лидов из колонки? (Вернутся в статус «Новый»)`)) return;
    for (const l of items) await patch(l.id, { status: 'new' });
    renderKanban();
    return toast(`Колонка очищена (${items.length})`);
  }
  const c = e.target.closest('.card');
  if (c) openDrawer(c.dataset.id);
});
$('#kanban').addEventListener('dragstart', (e) => { const c = e.target.closest('.card'); if (c) e.dataTransfer.setData('id', c.dataset.id); });
$('#kanban').addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); col.classList.add('drop'); } });
$('#kanban').addEventListener('dragleave', (e) => e.target.closest('.col')?.classList.remove('drop'));
$('#kanban').addEventListener('drop', async (e) => {
  const col = e.target.closest('.col'); if (!col) return;
  e.preventDefault(); col.classList.remove('drop');
  await patch(e.dataTransfer.getData('id'), { status: col.dataset.col }); renderKanban();
});

// ---------- Аналитика ----------
function bars(title, entries) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return `<div class="chart glass"><h3>${title}</h3>${entries.length ? entries.map(([k, v]) => `<div class="bar"><span title="${esc(k)}">${esc(k)}</span><div class="tr"><i style="width:${(v / max) * 100}%"></i></div><b>${v}</b></div>`).join('') : '<div class="muted">Нет данных</div>'}</div>`;
}
function groupCount(fn) {
  const m = new Map();
  for (const l of S.leads) for (const k of [].concat(fn(l)).filter(Boolean)) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
}
function renderStats() {
  const c = counts();
  const hotPct = c.all ? Math.round((c.hot / c.all) * 100) : 0;
  $('#stats').innerHTML = `
    <div class="tiles">
      <div class="tile glass"><b class="shimmer-text">${c.all}</b><span>всего в базе</span></div>
      <div class="tile glass"><b>${c.hot}</b><span>нужен сайт (${hotPct}%)</span></div>
      <div class="tile glass"><b>${c.none}</b><span>без сайта</span></div>
      <div class="tile glass"><b>${c.constructor}</b><span>на конструкторе</span></div>
      <div class="tile glass"><b>${S.leads.filter((l) => l.status === 'work').length}</b><span>в работе</span></div>
      <div class="tile glass"><b>${c.clients}</b><span>клиентов</span></div>
    </div>
    ${bars('Состояние сайтов', groupCount((l) => SITE[siteStatus(l)]?.t || 'Проверяется'))}
    ${bars('Конструкторы', groupCount((l) => l.site?.builder))}
    ${bars('Горячие лиды по нишам', groupCount((l) => (HOT.has(siteStatus(l)) ? l.niche : null)))}
    ${bars('По городам', groupCount((l) => l.city))}
    ${bars('По источникам', groupCount((l) => l.sources.map((s) => SRC[s.src]?.[2])))}
    ${bars('Воронка', groupCount((l) => STATUS[l.status]))}`;
}

// ---------- Настройки ----------
const SUPABASE_SQL = `create table if not exists leads (
  id text primary key,
  data jsonb not null,
  updated_at bigint not null default 0,
  deleted boolean not null default false
);
create index if not exists leads_updated_at_idx on leads (updated_at);
alter table leads disable row level security;`;

async function refreshCloudStatus() {
  const box = $('#cloud-status');
  if (!box) return;
  try {
    const st = await api('/api/cloud/status');
    if (!st.enabled) {
      box.innerHTML = '<span class="dot" style="background:var(--c-ok);color:var(--c-ok)"></span><span>Локальный режим (данные только на этом ПК)</span>';
    } else if (st.connected) {
      const t = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleTimeString() : '—';
      box.innerHTML = `<span class="dot d-client"></span><span>Подключено к Supabase · Лидов: ${st.totalLeads} · Синхр: ${t}</span>`;
    } else {
      box.innerHTML = `<span class="dot d-none"></span><span>Ошибка подключения: ${esc(st.error || 'проверьте URL и ключ')}</span>`;
    }
  } catch {}
}

function fillSettings() {
  const s = S.settings;
  $('#s-2gis').value = s.twogisDomain || ''; $('#s-yandex').value = s.yandexDomain || '';
  $('#s-delay').value = s.delayMs; $('#s-conc').value = s.siteCheckConcurrency; $('#s-template').value = s.messageTemplate || '';
  $('#s-sb-url').value = s.supabaseUrl || ''; $('#s-sb-key').value = s.supabaseKey || '';
  refreshCloudStatus();
}
$('#btn-save-settings').addEventListener('click', async () => {
  S.settings = await api('/api/settings', { method: 'POST', body: {
    twogisDomain: $('#s-2gis').value.trim() || '2gis.ru', yandexDomain: $('#s-yandex').value.trim() || 'yandex.ru',
    delayMs: +$('#s-delay').value || 1200, siteCheckConcurrency: +$('#s-conc').value || 6, messageTemplate: $('#s-template').value,
    supabaseUrl: $('#s-sb-url').value.trim(), supabaseKey: $('#s-sb-key').value.trim(),
  } });
  toast('Настройки сохранены');
  setTimeout(async () => {
    await refreshCloudStatus();
    setLeads(await api('/api/leads'));
    render();
  }, 800);
});
$('#btn-cloud-sync')?.addEventListener('click', async () => {
  toast('Синхронизация...');
  await api('/api/cloud/sync', { method: 'POST' });
  await refreshCloudStatus();
  setLeads(await api('/api/leads'));
  render();
  toast('Синхронизировано');
});
$('#btn-copy-sql')?.addEventListener('click', () => {
  navigator.clipboard.writeText(SUPABASE_SQL);
  toast('SQL скопирован — вставь в SQL Editor в Supabase');
});

function renderEnrich(st) {
  const el = $('#enrich-status');
  if (!el) return;
  if (!st || !st.running) {
    if (st && st.total && st.done >= st.total) {
      el.textContent = `Допарсинг готов: ${st.done}/${st.total}`;
      el.classList.remove('hidden', 'glow');
      setTimeout(() => { if (!$('#enrich-status')?.classList.contains('glow')) el.classList.add('hidden'); }, 6000);
    } else {
      el.classList.add('hidden');
    }
    return;
  }
  el.textContent = `Допарсинг: ${st.done}/${st.total}${st.current ? ' · ' + st.current : ''} (стоп)`;
  el.classList.remove('hidden');
  el.classList.add('glow');
}
$('#enrich-status')?.addEventListener('click', async () => {
  if ($('#enrich-status')?.classList.contains('glow')) {
    await api('/api/enrich/stop', { method: 'POST' });
    toast('Останавливаю допарсинг…');
  }
});

// ---------- Старт ----------
(async function init() {
  let jobInfo = null;
  if (document.documentElement.classList.contains('cloud-only')) {
    CLOUD_ONLY = true;
    try {
      const cached = JSON.parse(localStorage.getItem('lh-cloud-cache') || 'null');
      if (Array.isArray(cached) && cached.length) { setLeads(cached); render(); }
    } catch {}
  } else {
    try {
      const r = await fetch('/api/job');
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('application/json')) throw new Error('no backend');
      jobInfo = await r.json();
    } catch {
      CLOUD_ONLY = true;
    }
  }

  const [leads, settings] = await Promise.all([api('/api/leads'), api('/api/settings')]);
  setLeads(leads); S.settings = settings;
  if (jobInfo) {
    renderJob(jobInfo.job);
    renderEnrich(jobInfo.enrich);
    (jobInfo.logs || []).forEach(addLog);
  }
  render();
  const v = location.hash.slice(1);
  if (v && $('#view-' + v) && !(CLOUD_ONLY && v === 'parser')) go(v); else if (!leads.length && !CLOUD_ONLY) go('parser');

  if (CLOUD_ONLY) {
    $('.nav-btn[data-view="parser"]')?.classList.add('hidden');
    $('#view-parser')?.classList.add('hidden');
    $('#btn-recheck')?.classList.add('hidden');
    $('[data-bulk="recheck"]')?.classList.add('hidden');

    setInterval(async () => {
      try {
        const rows = await cloudFetchRows(cloudLastTs);
        if (!rows.length) return;
        let changed = false;
        for (const row of rows) {
          if (row.updated_at > cloudLastTs) cloudLastTs = row.updated_at;
          if (row.deleted) {
            if (S.byId.has(row.id)) {
              S.leads = S.leads.filter((l) => l.id !== row.id);
              S.byId.delete(row.id);
              S.selected.delete(row.id);
              changed = true;
            }
          } else if (row.data?.id) {
            const cur = S.byId.get(row.data.id);
            if (!cur || (row.data.updatedAt || row.updated_at) > (cur.updatedAt || 0)) {
              if (upsertLocal(row.data)) flashIds.add(row.data.id);
              changed = true;
            }
          }
        }
        cloudLastSyncAt = Date.now();
        cloudLastErr = null;
        if (changed) scheduleRender();
      } catch (e) {
        cloudLastErr = e.message;
      }
    }, 5000);
    return;
  }

  const es = new EventSource('/api/events');
  es.addEventListener('job', (e) => renderJob(JSON.parse(e.data)));
  es.addEventListener('enrich', (e) => renderEnrich(JSON.parse(e.data)));
  es.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
  es.addEventListener('lead', (e) => { const l = JSON.parse(e.data); if (upsertLocal(l)) flashIds.add(l.id); scheduleRender(); });
  es.addEventListener('deleted', (e) => {
    const { ids } = JSON.parse(e.data);
    const s = new Set(ids || []);
    S.leads = S.leads.filter((l) => !s.has(l.id));
    s.forEach((id) => S.selected.delete(id));
    scheduleRender();
  });
  es.addEventListener('sync', async () => {
    setLeads(await api('/api/leads'));
    scheduleRender();
  });
})();
