// LeadHunter — Telegram Mini App. Работает с тем же сервером, что и программа на ПК.
const tg = window.Telegram?.WebApp;
const INIT = tg?.initData || '';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SITE = {
  none: ['Без сайта', '#ff5c7a'], social: ['Только соцсети', '#ffb84d'], constructor: ['Конструктор', '#7aa2ff'],
  dead: ['Не работает', '#ff7a45'], weak: ['Слабый сайт', '#c38bff'], ok: ['Есть сайт', '#6b7080'],
  unknown: ['Не проверен', '#6b7080'], pending: ['Проверяется…', '#6b7080'],
};
const STATUS = { new: 'Новый', base: 'В базе', noanswer: 'Недозвон', work: 'В работе', client: 'Клиент', reject: 'Отказ' };
const HOT = new Set(['none', 'social', 'constructor', 'dead', 'weak']);
const NICHES = ['автосервис', 'шиномонтаж', 'барбершоп', 'салон красоты', 'стоматология', 'клининг', 'ремонт квартир', 'натяжные потолки', 'фитнес', 'юрист', 'груминг', 'автомойка', 'кафе', 'пекарня', 'цветы', 'ветклиника', 'массаж', 'тату-салон', 'изготовление мебели'];
const SRC = { '2gis': '2ГИС', yandex: 'Яндекс', google: 'Google' };

const S = {
  leads: [], byId: new Map(), job: null, logs: [], settings: {},
  view: 'parser', filter: 'hot', city: '', q: '', hideTaken: true, shown: 40, funnel: 'work', openId: null,
  form: { sources: ['2gis', 'yandex'], limit: 50, headless: false },
  flash: new Set(), lastEvent: 0,
};

const siteStatus = (l) => l.site?.status || (l.website ? 'pending' : (l.socials?.length ? 'social' : 'none'));
const score = (l) => l.site?.score ?? (l.website ? 50 : 100);
const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');

// ---------- Telegram ----------
const haptic = (t = 'light') => { try { t === 'ok' || t === 'error' ? tg.HapticFeedback.notificationOccurred(t === 'ok' ? 'success' : 'error') : tg.HapticFeedback.impactOccurred(t); } catch {} };
function openLink(url) {
  if (!url) return;
  if (/^https?:\/\/t\.me\//.test(url) && tg?.openTelegramLink) return tg.openTelegramLink(url);
  if (tg?.openLink && /^https?:/.test(url)) return tg.openLink(url);
  window.open(url, '_blank');
}
if (tg) {
  tg.ready(); tg.expand();
  try { tg.setHeaderColor('#050506'); tg.setBackgroundColor('#050506'); tg.setBottomBarColor?.('#08080a'); } catch {}
  try { tg.disableVerticalSwipes?.(); } catch {}
  tg.BackButton?.onClick(() => closeSheet());
}

// ---------- API ----------
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Tg-Init-Data': INIT },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { denied(j.error); throw new Error(j.error || 'Нет доступа'); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function denied(msg) { $('#denied').classList.remove('hidden'); if (msg) $('#deniedText').textContent = msg; }

let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  haptic('ok'); toast('Скопировано');
}

// ---------- хранение формы (CloudStorage Telegram, т.к. адрес туннеля меняется) ----------
const store = {
  get(k) { return new Promise((res) => { if (tg?.CloudStorage && tg.isVersionAtLeast?.('6.9')) tg.CloudStorage.getItem(k, (e, v) => res(e ? null : v)); else res(localStorage.getItem(k)); }); },
  set(k, v) { if (tg?.CloudStorage && tg.isVersionAtLeast?.('6.9')) tg.CloudStorage.setItem(k, v, () => {}); else localStorage.setItem(k, v); },
};

// ---------- данные ----------
function upsert(l) {
  const isNew = !S.byId.has(l.id);
  if (isNew) S.leads.push(l); else Object.assign(S.byId.get(l.id), l);
  S.byId.set(l.id, isNew ? l : S.byId.get(l.id));
  return isNew;
}
async function loadAll() {
  const [leads, job, settings] = await Promise.all([api('/leads'), api('/job'), api('/settings')]);
  S.leads = leads; S.byId = new Map(leads.map((l) => [l.id, l]));
  S.job = job.job; S.logs = job.logs.slice(-60); S.settings = settings;
  if (S.form.headless === null) S.form.headless = !!settings.headless;
}

let renderT;
function scheduleRender() { clearTimeout(renderT); renderT = setTimeout(renderAll, 250); }
function renderAll() { renderJob(); renderHeader(); renderView(); if (S.openId) renderSheet(); }

function connect() {
  const es = new EventSource('/api/events' + (INIT ? '?tg=' + encodeURIComponent(INIT) : ''));
  const alive = () => { S.lastEvent = Date.now(); $('#live').classList.add('on'); };
  es.onopen = alive;
  es.addEventListener('job', (e) => { alive(); S.job = JSON.parse(e.data); renderJob(); });
  es.addEventListener('log', (e) => { alive(); S.logs.push(JSON.parse(e.data)); S.logs = S.logs.slice(-60); renderLog(); });
  es.addEventListener('lead', (e) => { alive(); const l = JSON.parse(e.data); if (upsert(l)) S.flash.add(l.id); scheduleRender(); });
  es.addEventListener('deleted', (e) => { const { ids } = JSON.parse(e.data); const s = new Set(ids); S.leads = S.leads.filter((l) => !s.has(l.id)); ids.forEach((i) => S.byId.delete(i)); scheduleRender(); });
  es.addEventListener('sync', async () => { alive(); S.leads = await api('/api/leads'); S.byId = new Map(S.leads.map((l) => [l.id, l])); scheduleRender(); });
  es.onerror = () => $('#live').classList.remove('on');
}
// запасной вариант, если туннель режет поток событий
setInterval(async () => {
  if (document.hidden || Date.now() - S.lastEvent < 25000) return;
  try {
    const j = await api('/job');
    const wasRunning = S.job?.running;
    S.job = j.job; S.logs = j.logs.slice(-60); renderJob(); renderLog();
    if (wasRunning || j.job?.running) { const leads = await api('/leads'); leads.forEach(upsert); scheduleRender(); }
  } catch {}
}, 8000);

// ---------- шапка ----------
function hotList() { return S.leads.filter((l) => HOT.has(siteStatus(l)) && l.status === 'new'); }
function renderHeader() {
  const hot = hotList().length;
  $('#sub').textContent = S.job?.running ? `Парсинг: ${S.job.done}/${S.job.total} · найдено ${S.job.found}` : `${S.leads.length} в базе · ${hot} нужен сайт`;
  $('#hotBadge').textContent = hot ? (hot > 999 ? '999+' : hot) : '';
}

// ---------- парсер ----------
function renderJob() {
  const j = S.job, run = !!j?.running;
  const pct = j?.total ? Math.round((j.done / j.total) * 100) : 0;
  $('#jobCard').classList.toggle('running', run);
  $('#ring').style.setProperty('--p', run ? Math.max(pct, 3) : j ? 100 : 0);
  $('#ringTxt').textContent = run ? pct + '%' : j ? '✓' : '—';
  $('#jobTitle').textContent = run ? (j.stopRequested ? 'Останавливаю…' : 'Идёт парсинг') : j ? 'Парсинг завершён' : 'Парсер свободен';
  $('#jobCurrent').textContent = run ? `${j.current || 'запуск браузера…'} · задание ${Math.min(j.done + 1, j.total)}/${j.total}` : j ? 'Можно запускать снова' : 'Запусти поиск ниже';
  $('#kFound').textContent = j?.found ?? 0;
  $('#kNew').textContent = j?.newLeads ?? 0;
  $('#kChecked').textContent = j?.checked ?? 0;
  $('#stopBtn').classList.toggle('hidden', !run);
  $('#startBtn').disabled = run;
  $('#startBtn').textContent = run ? 'Парсинг уже идёт' : 'Запустить парсинг';
  renderHeader();
}
function renderLog() {
  $('#log').innerHTML = S.logs.slice(-30).reverse().map((e) => `<div class="${/⚠|Ошибка/.test(e.msg) ? 'warn' : ''}">${esc(e.msg)}</div>`).join('');
}
const splitList = (s) => String(s || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
function renderForm() {
  const ni = new Set(splitList($('#niches').value).map((x) => x.toLowerCase()));
  $('#nicheChips').innerHTML = NICHES.map((n) => `<button class="chip ${ni.has(n) ? 'on' : ''}" data-niche="${esc(n)}">${esc(n)}</button>`).join('');
  const cityCount = {};
  for (const l of S.leads) if (l.city) cityCount[l.city] = (cityCount[l.city] || 0) + 1;
  const ci = new Set(splitList($('#cities').value).map((x) => x.toLowerCase()));
  $('#cityChips').innerHTML = Object.entries(cityCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([c]) => `<button class="chip ${ci.has(c.toLowerCase()) ? 'on' : ''}" data-city="${esc(c)}">${esc(c)}</button>`).join('');
  $$('#sources button').forEach((b) => b.classList.toggle('on', S.form.sources.includes(b.dataset.v)));
  $$('#limit button').forEach((b) => b.classList.toggle('on', +b.dataset.v === S.form.limit));
  $('#headless').checked = !!S.form.headless;
  const n = splitList($('#niches').value).length, c = Math.max(1, splitList($('#cities').value).length), s = S.form.sources.length;
  $('#plan').textContent = n && s ? `${n} ниш × ${c} город(ов) × ${s} источник(а) = ${n * c * s} заданий, до ${S.form.limit} фирм в каждом` : '';
  store.set('form', JSON.stringify({ ...S.form, niches: $('#niches').value, cities: $('#cities').value }));
}
function toggleInList(input, value) {
  const list = splitList(input.value);
  const i = list.findIndex((x) => x.toLowerCase() === value.toLowerCase());
  if (i >= 0) list.splice(i, 1); else list.push(value);
  input.value = list.join(', ');
  haptic('light'); renderForm();
}
$('#nicheChips').addEventListener('click', (e) => { const b = e.target.closest('[data-niche]'); if (b) toggleInList($('#niches'), b.dataset.niche); });
$('#cityChips').addEventListener('click', (e) => { const b = e.target.closest('[data-city]'); if (b) toggleInList($('#cities'), b.dataset.city); });
$('#sources').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const v = b.dataset.v, s = S.form.sources;
  S.form.sources = s.includes(v) ? s.filter((x) => x !== v) : [...s, v];
  haptic('light'); renderForm();
});
$('#limit').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.form.limit = +b.dataset.v; haptic('light'); renderForm(); });
$('#headless').addEventListener('change', (e) => { S.form.headless = e.target.checked; renderForm(); });
$('#niches').addEventListener('input', renderForm);
$('#cities').addEventListener('input', renderForm);
$('#startBtn').addEventListener('click', async () => {
  const btn = $('#startBtn'); btn.disabled = true;
  try {
    await api('/parse', { method: 'POST', body: { niches: $('#niches').value, cities: $('#cities').value, sources: S.form.sources, limit: S.form.limit, headless: S.form.headless, checkSites: true } });
    haptic('ok'); toast('Парсинг запущен на ПК');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { haptic('error'); toast(e.message); btn.disabled = false; }
});
$('#stopBtn').addEventListener('click', async () => {
  const go = () => api('/stop', { method: 'POST' }).then(() => { haptic('medium'); toast('Останавливаю…'); });
  if (tg?.showConfirm) tg.showConfirm('Остановить парсинг?', (ok) => ok && go()); else go();
});

// ---------- база ----------
function filtered() {
  const q = S.q.toLowerCase().trim();
  return S.leads.filter((l) => {
    const s = siteStatus(l);
    if (S.filter === 'hot' && !HOT.has(s)) return false;
    if (S.filter !== 'hot' && S.filter !== 'all' && s !== S.filter) return false;
    if (S.city && l.city !== S.city) return false;
    if (S.hideTaken && l.status !== 'new') return false;
    if (q && !(l.name + ' ' + l.category + ' ' + l.address + ' ' + l.phones.join(' ') + ' ' + l.phones.map(digits).join(' ')).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => score(b) - score(a) || (b.reviews || 0) - (a.reviews || 0));
}
function leadCard(l) {
  const s = siteStatus(l), [label, c] = SITE[s] || SITE.unknown;
  const flash = S.flash.has(l.id);
  return `<div class="lead ${flash ? 'flash' : ''}" style="--c:${c}" data-id="${l.id}">
    <div class="sc">${score(l)}</div>
    <div class="grow">
      <b>${esc(l.name)}</b>
      <div class="m">${esc([l.category, l.city].filter(Boolean).join(' · '))}</div>
      <div class="tags"><span class="tag c">${label}</span>${l.phones[0] ? `<span class="tag">📞 ${esc(l.phones[0])}</span>` : ''}${l.status !== 'new' ? `<span class="tag">${STATUS[l.status]}</span>` : ''}${l.rating ? `<span class="tag">★ ${l.rating}</span>` : ''}</div>
    </div>
  </div>`;
}
function renderLeads() {
  const counts = {}; for (const l of S.leads) { const s = siteStatus(l); counts[s] = (counts[s] || 0) + 1; }
  const hot = S.leads.filter((l) => HOT.has(siteStatus(l))).length;
  const f = [['hot', '🔥 Нужен сайт', hot], ['all', 'Все', S.leads.length], ...Object.keys(SITE).filter((k) => counts[k]).map((k) => [k, SITE[k][0], counts[k], SITE[k][1]])];
  $('#siteFilter').innerHTML = f.map(([k, t, n, c]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-f="${k}">${c ? `<span class="d" style="--c:${c}"></span>` : ''}${esc(t)}<b>${n}</b></button>`).join('');
  const cities = [...new Set(S.leads.map((l) => l.city).filter(Boolean))].sort();
  $('#cityFilter').innerHTML = cities.length > 1 ? [['', 'Все города'], ...cities.map((c) => [c, c])].map(([k, t]) => `<button class="chip ${S.city === k ? 'on' : ''}" data-c="${esc(k)}">${esc(t)}</button>`).join('') : '';
  const list = filtered();
  $('#count').textContent = list.length + ' шт.';
  $('#list').innerHTML = list.length ? list.slice(0, S.shown).map(leadCard).join('') : '<div class="empty">Ничего не найдено</div>';
  $('#more').classList.toggle('hidden', list.length <= S.shown);
  S.flash.clear();
}
$('#siteFilter').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; S.filter = b.dataset.f; S.shown = 40; haptic('light'); renderLeads(); });
$('#cityFilter').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; S.city = b.dataset.c; S.shown = 40; haptic('light'); renderLeads(); });
$('#q').addEventListener('input', (e) => { S.q = e.target.value; S.shown = 40; renderLeads(); });
$('#hideTaken').addEventListener('change', (e) => { S.hideTaken = e.target.checked; renderLeads(); });
$('#more').addEventListener('click', () => { S.shown += 40; renderLeads(); });
$('#exportList').addEventListener('click', async () => {
  const ids = filtered().map((l) => l.id);
  if (!ids.length) return toast('Список пуст');
  try { await api('/tg/export', { method: 'POST', body: { ids, title: 'Выгрузка из приложения' } }); haptic('ok'); toast(`CSV (${ids.length}) отправлен в чат с ботом`); }
  catch (e) { toast(e.message); }
});
$('#recheckList').addEventListener('click', async () => {
  const ids = filtered().map((l) => l.id);
  if (!ids.length) return toast('Список пуст');
  const r = await api('/recheck', { method: 'POST', body: { ids } }); toast(`Проверяю сайты: ${r.queued}`);
});

// ---------- воронка ----------
function renderFunnel() {
  const keys = ['base', 'noanswer', 'work', 'client', 'reject'];
  $('#funnelTabs').innerHTML = keys.map((k) => `<button class="${S.funnel === k ? 'on' : ''}" data-k="${k}"><b>${S.leads.filter((l) => l.status === k).length}</b>${STATUS[k]}</button>`).join('');
  const list = S.leads.filter((l) => l.status === S.funnel).sort((a, b) => b.updatedAt - a.updatedAt);
  $('#funnelList').innerHTML = list.length ? list.map(leadCard).join('') : `<div class="empty">Пусто.<br>Открой контору в «Базе» и поставь статус «${STATUS[S.funnel]}».</div>`;
}
$('#funnelTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; S.funnel = b.dataset.k; haptic('light'); renderFunnel(); });

// ---------- статистика ----------
function bars(title, entries, colorOf) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return `<h4>${title}</h4>` + entries.map(([k, n]) => `<div class="bar" style="--c:${colorOf?.(k) || '#b9c8ff'}"><span>${esc(k || '—')}</span><span class="muted">${n}</span><div class="t"><i style="width:${(n / max) * 100}%"></i></div></div>`).join('');
}
function group(fn) { const m = {}; for (const l of S.leads) { const k = fn(l); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function renderStats() {
  const hot = S.leads.filter((l) => HOT.has(siteStatus(l))).length;
  const t = [[S.leads.length, 'в базе'], [hot, 'нужен сайт'], [S.leads.filter((l) => l.status === 'work').length, 'в работе'], [S.leads.filter((l) => l.status === 'client').length, 'клиентов']];
  $('#tiles').innerHTML = t.map(([n, s]) => `<div class="tile"><b>${n}</b><span>${s}</span></div>`).join('');
  const siteName = Object.fromEntries(Object.entries(SITE).map(([k, v]) => [v[0], v[1]]));
  $('#bars').className = 'card bars';
  $('#bars').innerHTML = bars('Сайты', group((l) => SITE[siteStatus(l)]?.[0]), (k) => siteName[k])
    + bars('Города', group((l) => l.city).slice(0, 8))
    + bars('Ниши', group((l) => l.niche || l.category).slice(0, 8))
    + bars('Воронка', group((l) => STATUS[l.status]));
  if (document.activeElement !== $('#tpl')) $('#tpl').value = S.settings.messageTemplate || '';
  if (document.activeElement !== $('#delay')) $('#delay').value = S.settings.delayMs || 1200;
}
$('#saveSettings').addEventListener('click', async () => {
  try {
    S.settings = await api('/settings', { method: 'POST', body: { messageTemplate: $('#tpl').value, delayMs: Math.max(300, +$('#delay').value || 1200) } });
    haptic('ok'); toast('Сохранено');
  } catch (e) { toast(e.message); }
});

// ---------- вкладки ----------
function renderView() {
  if (S.view === 'leads') renderLeads();
  else if (S.view === 'funnel') renderFunnel();
  else if (S.view === 'stats') renderStats();
  else if (S.view === 'parser' && !$('#cityChips').children.length) renderForm();
}
$('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  S.view = b.dataset.view;
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'v-' + S.view));
  haptic('light'); window.scrollTo(0, 0); renderView();
});

// ---------- карточка конторы ----------
function problemText(l) {
  const s = siteStatus(l);
  if (s === 'none') return 'Заметил, что у вас нет сайта — клиенты из поиска уходят к конкурентам.';
  if (s === 'social') return 'Вижу, что вместо сайта у вас только соцсети — из поиска Яндекса и Google вас почти не найти.';
  if (s === 'constructor') return `Ваш сайт собран на конструкторе${l.site?.builder ? ' (' + l.site.builder + ')' : ''} — такие сайты плохо продвигаются и выглядят шаблонно.`;
  if (s === 'dead') return 'Ваш сайт сейчас не открывается — клиенты видят ошибку.';
  if (s === 'weak') return 'Ваш сайт выглядит устаревшим и плохо открывается с телефона.';
  return 'Посмотрел ваш сайт — есть что улучшить по заявкам и скорости.';
}
function openLead(id) {
  S.openId = id; renderSheet();
  $('#sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  tg?.BackButton?.show(); haptic('light');
}
function closeSheet() {
  S.openId = null; $('#sheet').classList.add('hidden'); document.body.style.overflow = '';
  tg?.BackButton?.hide(); renderView();
}
function renderSheet() {
  const l = S.byId.get(S.openId);
  if (!l) return closeSheet();
  const body = $('#sheetBody');
  if (body.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) return; // не мешаем вводу
  const s = siteStatus(l), [label, c] = SITE[s] || SITE.unknown;
  const d = digits(l.phones[0]);
  const tgLink = l.socials.find((x) => /t\.me|telegram/.test(x));
  const maps = mapLinks(l, S.settings);
  const map = mainMapLink(l, S.settings).url;
  const msg = (S.settings.messageTemplate || '').replace('{name}', l.name).replace('{problem}', problemText(l));
  const q = encodeURIComponent(`${l.name} ${l.city}`);
  body.innerHTML = `
    <div class="sh-head" style="--c:${c}">
      <span class="tag c">${label}</span>
      <h2>${esc(l.name)}</h2>
      <div class="muted small">${esc([l.category, l.city].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="need" style="--c:${c}"><div class="t"><i style="width:${score(l)}%"></i></div><span>Потребность в сайте: ${score(l)}%</span></div>
    <div class="acts">
      <a class="${d ? '' : 'off'}" href="tel:+${d}"><span class="ic">📞</span>Позвонить</a>
      <button class="${d ? '' : 'off'}" data-open="https://wa.me/${d}"><span class="ic">💬</span>WhatsApp</button>
      <button class="${tgLink ? '' : 'off'}" data-open="${esc(tgLink || '')}"><span class="ic">✈️</span>Telegram</button>
      <button data-open="${esc(map)}"><span class="ic">📍</span>Карта</button>
    </div>
    <div class="blk"><h4>Страница на картах</h4>
      <div class="links">${maps.map((m) => `<button class="chip ${m.direct ? 'on' : ''}" data-open="${esc(m.url)}">${m.direct ? '📍 ' : '🔎 '}${m.name}</button>`).join('')}</div>
      <div class="muted small" style="margin-top:6px">📍 — страница конторы, 🔎 — поиск по названию и адресу</div>
    </div>
    <div class="blk"><h4>Статус</h4>
      <div class="seg" id="stSeg">${Object.entries(STATUS).map(([k, v]) => `<button class="${l.status === k ? 'on' : ''}" data-status="${k}">${v}</button>`).join('')}</div>
    </div>
    <div class="blk"><h4>Контакты</h4>
      ${l.phones.map((p) => `<div class="kv"><span class="k">📞</span><span class="lnk" data-copy="${esc(p)}">${esc(p)}</span></div>`).join('') || '<div class="kv muted"><span class="k">📞</span>Телефона нет</div>'}
      ${l.address ? `<div class="kv"><span class="k">📍</span><span>${esc(l.address)}</span></div>` : ''}
      ${l.emails?.length ? l.emails.map((m) => `<div class="kv"><span class="k">✉️</span><span class="lnk" data-copy="${esc(m)}">${esc(m)}</span></div>`).join('') : ''}
      ${l.socials.map((x) => `<div class="kv"><span class="k">🔗</span><span class="lnk" data-open="${esc(x)}">${esc(x.replace(/^https?:\/\/(www\.)?/, ''))}</span></div>`).join('')}
      ${l.rating ? `<div class="kv"><span class="k">⭐</span><span>${l.rating}${l.reviews ? ` · ${l.reviews} отзывов` : ''}</span></div>` : ''}
    </div>
    <div class="blk"><h4>Сайт · ${label}</h4>
      ${l.website ? `<div class="kv"><span class="k">🌐</span><span class="lnk" data-open="${esc(l.website)}">${esc(l.website)}</span></div>` : '<div class="muted small">На картах сайт не указан</div>'}
      ${l.site?.reasons?.length ? `<ul>${l.site.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <button class="btn ghost" data-recheck>Перепроверить сайт</button>
    </div>
    <div class="blk"><h4>Первое касание</h4>
      <div class="msg">${esc(msg)}</div>
      <div class="row gap">
        <button class="btn" data-copy="${esc(msg)}">Скопировать</button>
        ${d ? `<button class="btn primary" data-open="https://wa.me/${d}?text=${encodeURIComponent(msg)}">В WhatsApp</button>` : ''}
      </div>
    </div>
    <div class="blk"><h4>Заметка</h4>
      <input id="person" placeholder="Контактное лицо" value="${esc(l.contactPerson || '')}" style="margin-bottom:8px" />
      <textarea id="note" rows="3" placeholder="Договорились созвониться в пятницу…">${esc(l.note || '')}</textarea>
    </div>
    <div class="blk"><h4>Найти владельца</h4>
      <div class="links">
        <button class="chip" data-open="https://www.google.com/search?q=${q}">Google</button>
        <button class="chip" data-open="https://yandex.ru/search/?text=${q}">Яндекс</button>
        <button class="chip" data-open="https://www.rusprofile.ru/search?query=${encodeURIComponent(l.name)}">Rusprofile</button>
        <button class="chip" data-open="https://vk.com/search?c%5Bq%5D=${q}&c%5Bsection%5D=communities">VK</button>
      </div>
    </div>`;
}
async function patchLead(id, patch) {
  const l = await api('/leads/' + id, { method: 'PATCH', body: patch });
  upsert(l); return l;
}
$('#sheet').addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]')) return closeSheet();
  const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); return openLink(o.dataset.open); }
  const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy);
  const st = e.target.closest('[data-status]');
  if (st) { await patchLead(S.openId, { status: st.dataset.status }); haptic('ok'); toast('Статус: ' + STATUS[st.dataset.status]); return renderSheet(); }
  if (e.target.closest('[data-recheck]')) { await api('/recheck', { method: 'POST', body: { ids: [S.openId] } }); toast('Проверяю сайт…'); }
});
$('#sheet').addEventListener('change', async (e) => {
  if (e.target.id === 'note') { await patchLead(S.openId, { note: e.target.value }); toast('Заметка сохранена'); }
  if (e.target.id === 'person') { await patchLead(S.openId, { contactPerson: e.target.value }); toast('Сохранено'); }
});
document.addEventListener('click', (e) => {
  const card = e.target.closest('.lead[data-id]');
  if (card && !e.target.closest('#sheet')) openLead(card.dataset.id);
});

// ---------- старт ----------
(async () => {
  const saved = await store.get('form').catch(() => null);
  try {
    const f = JSON.parse(saved || 'null');
    if (f) { $('#niches').value = f.niches || ''; $('#cities').value = f.cities || ''; S.form = { sources: f.sources?.length ? f.sources : S.form.sources, limit: f.limit || 50, headless: !!f.headless }; }
    else S.form.headless = null;
  } catch {}
  try { await loadAll(); } catch (e) { if (!$('#denied').classList.contains('hidden')) return; toast('Нет связи с ПК: ' + e.message); return; }
  renderForm(); renderJob(); renderLog(); renderAll();
  connect();
  // открыть карточку по ссылке из бота: startapp=lead_<id>
  const sp = tg?.initDataUnsafe?.start_param || '';
  if (sp.startsWith('lead_') && S.byId.has(sp.slice(5))) openLead(sp.slice(5));
})();
