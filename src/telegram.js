// Telegram-бот LeadHunter. Работает в том же процессе, что и веб-интерфейс:
// общая база (db), общая очередь парсинга (jobs) — запускать и смотреть можно и с ПК, и из Telegram.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const jobs = require('./jobs');
const { STATUS_RU, LEAD_STATUS, HOT, siteStatus, score, problemText, toCsv } = require('./leadUtil');
const { mapLinks } = require('../public/maplinks');

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const API = `https://api.telegram.org/bot${TOKEN}/`;
const ACCESS_FILE = path.join(db.DATA_DIR, 'telegram.json');
const PAGE = 8;
const SRC_LIST = [['2gis', '2ГИС'], ['yandex', 'Яндекс'], ['google', 'Google']];
const NICHES = ['автосервис', 'шиномонтаж', 'барбершоп', 'салон красоты', 'стоматология', 'клининг', 'ремонт квартир', 'натяжные потолки'];

// ---------- доступ ----------
let access = { owners: [], lastSources: ['2gis', 'yandex'], lastLimit: 50 };
try { access = { ...access, ...JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8')) }; } catch {}
for (const id of String(process.env.TELEGRAM_ALLOWED || '').split(/[\s,;]+/).filter(Boolean)) if (!access.owners.includes(+id)) access.owners.push(+id);
const saveAccess = () => fs.writeFileSync(ACCESS_FILE, JSON.stringify(access, null, 2));
const isOwner = (id) => access.owners.includes(id);

// ---------- Telegram API ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, params = {}, timeoutMs = 20000) {
  const r = await fetch(API + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.description || 'Telegram error'); e.code = j.error_code; throw e; }
  return j.result;
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const send = (chat_id, text, extra = {}) => api('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
const edit = (chat_id, message_id, text, extra = {}) =>
  api('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    .catch((e) => { if (!/not modified/.test(e.message)) throw e; });
const broadcast = (text, extra) => Promise.all(access.owners.map((id) => send(id, text, extra).catch((e) => console.error('[tg]', e.message))));

async function sendDocument(chat_id, filename, content, caption) {
  const fd = new FormData();
  fd.append('chat_id', String(chat_id));
  if (caption) fd.append('caption', caption);
  fd.append('document', new Blob([content], { type: 'text/csv' }), filename);
  const r = await fetch(API + 'sendDocument', { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description);
}

// ---------- Mini App ----------
let appUrl = '';
const appButton = (text = '📱 Открыть приложение') => (appUrl ? [{ text, web_app: { url: appUrl } }] : null);

async function setAppUrl(url) {
  appUrl = url;
  if (!TOKEN) return;
  for (let i = 1; i <= 10 && appUrl === url; i++) {
    try {
      await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'LeadHunter', web_app: { url } } });
      console.log('  Мини-апп подключён к кнопке меню бота');
      return;
    } catch (e) {
      console.error(`[tg] Не удалось поставить кнопку мини-аппа (попытка ${i}):`, e.message);
      await sleep(5000 * i);
    }
  }
}

/** Проверка подписи Telegram.WebApp.initData. Возвращает пользователя, если это владелец бота. */
function checkInitData(initData) {
  if (!TOKEN || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
    if (Date.now() / 1000 - +params.get('auth_date') > 7 * 86400) return null;
    const user = JSON.parse(params.get('user') || 'null');
    return user && isOwner(user.id) ? user : null;
  } catch { return null; }
}

async function sendCsv(userId, list, title) {
  const chat = userId || access.owners[0];
  if (!chat) throw new Error('Сначала напиши боту /start');
  await sendDocument(chat, `leads-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list, db.getSettings()), `${title}: ${list.length} шт.`);
}

// ---------- клавиатуры ----------
const MAIN_KB = {
  keyboard: [
    [{ text: '🚀 Парсинг' }, { text: '📊 Статус' }],
    [{ text: '🔥 Горячие' }, { text: '📁 Экспорт' }],
    [{ text: '🔄 Проверить сайты' }, { text: '⏹ Стоп' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const BUTTONS = { '🚀 Парсинг': '/parse', '📊 Статус': '/status', '🔥 Горячие': '/hot', '📁 Экспорт': '/export', '🔄 Проверить сайты': '/recheck', '⏹ Стоп': '/stop' };
const ik = (rows) => ({ reply_markup: { inline_keyboard: rows } });

// ---------- мастер запуска парсинга ----------
const sessions = new Map(); // chatId -> { step, niches, cities, sources:Set, limit, headless }

function sourcesView(s) {
  return {
    text: `<b>Шаг 3/4.</b> Источники:\n\nНиши: ${esc(s.niches)}\nГорода: ${esc(s.cities || 'без города')}`,
    extra: ik([
      SRC_LIST.map(([k, n]) => ({ text: (s.sources.has(k) ? '✅ ' : '▫️ ') + n, callback_data: 'src:' + k })),
      [{ text: 'Далее ▶', callback_data: 'src:next' }, { text: '✖ Отмена', callback_data: 'wiz:cancel' }],
    ]),
  };
}
function confirmView(s) {
  const src = SRC_LIST.filter(([k]) => s.sources.has(k)).map(([, n]) => n).join(', ');
  return {
    text: `<b>Шаг 4/4. Проверь и запускай</b>\n\nНиши: ${esc(s.niches)}\nГорода: ${esc(s.cities || 'без города')}\nИсточники: ${src}\nЛимит: до ${s.limit} фирм на задание\nБраузер: ${s.headless ? 'фоновый режим (окна не будет)' : 'окно на ПК (можно пройти капчу)'}`,
    extra: ik([
      [{ text: '🚀 Запустить', callback_data: 'wiz:go' }],
      [{ text: s.headless ? '🖥 Показать окно браузера' : '🙈 Фоновый режим', callback_data: 'wiz:hl' }],
      [20, 50, 100, 200].map((n) => ({ text: (n === s.limit ? '• ' : '') + n, callback_data: 'lim:' + n })),
      [{ text: '✖ Отмена', callback_data: 'wiz:cancel' }],
    ]),
  };
}

async function launch(chatId, opts) {
  try {
    await jobs.start({ ...opts, checkSites: true });
    access.lastSources = opts.sources; access.lastLimit = opts.limit; saveAccess();
    // сообщение с прогрессом придёт всем владельцам через подписку на jobs
  } catch (e) {
    await send(chatId, '❌ ' + esc(e.message));
  }
}

// ---------- представления ----------
function dbStats() {
  const leads = db.getLeads();
  const hot = leads.filter((l) => HOT.has(siteStatus(l)) && l.status === 'new').length;
  const by = (st) => leads.filter((l) => l.status === st).length;
  return `🗂 В базе: <b>${leads.length}</b> · 🔥 горячих необработанных: <b>${hot}</b>\nВ работе: ${by('work')} · Клиенты: ${by('client')} · Отказ: ${by('reject')}`;
}

function progressText(j) {
  const logs = jobs.getLogs();
  const last = logs[logs.length - 1]?.msg || '';
  const c = jobs.checkStats();
  if (j?.running) {
    return `⏳ <b>Парсинг идёт</b>\n\nЗадания: ${j.done}/${j.total}\nСейчас: ${esc(j.current || '—')}\nНайдено: <b>${j.found}</b> (новых ${j.newLeads})\nСайтов проверено: ${j.checked || 0}${c.queued || c.checking ? ` (в очереди ${c.queued + c.checking})` : ''}\n\n<i>${esc(last.slice(0, 300))}</i>`;
  }
  return `✅ <b>Парсинг завершён</b>\n\nНайдено: <b>${j?.found ?? 0}</b>, новых: <b>${j?.newLeads ?? 0}</b>\nСайтов проверено: ${j?.checked || 0}${c.queued || c.checking ? `, ещё проверяется: ${c.queued + c.checking}` : ''}\n<i>${esc(last.slice(0, 300))}</i>`;
}

const hotLeads = () => db.getLeads()
  .filter((l) => HOT.has(siteStatus(l)) && l.status === 'new')
  .sort((a, b) => score(b) - score(a) || (b.reviews || 0) - (a.reviews || 0));

function leadLine(l) {
  const ph = l.phones[0] ? ' · 📞 ' + esc(l.phones[0]) : '';
  const st = STATUS_RU[siteStatus(l)] || '';
  return `<b>${esc(l.name)}</b> — ${st} · ${score(l)}%\n${esc([l.category, l.city].filter(Boolean).join(', '))}${ph}\n/l_${l.id}`;
}

function hotView(page) {
  const list = hotLeads();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  if (!list.length) return { text: '🔥 Горячих необработанных контор нет. Запусти парсинг 🚀', extra: {} };
  const items = list.slice(page * PAGE, page * PAGE + PAGE);
  const nav = [];
  if (page > 0) nav.push({ text: '◀', callback_data: 'hot:' + (page - 1) });
  nav.push({ text: `${page + 1}/${pages}`, callback_data: 'hot:' + page });
  if (page < pages - 1) nav.push({ text: '▶', callback_data: 'hot:' + (page + 1) });
  return {
    text: `🔥 <b>Нужен сайт</b> — ${list.length} контор (без взятых в работу)\n\n` + items.map(leadLine).join('\n\n'),
    extra: ik([nav]),
  };
}

function leadView(l) {
  const s = siteStatus(l);
  const lines = [
    `<b>${esc(l.name)}</b>`,
    esc([l.category, l.city].filter(Boolean).join(' · ')),
    l.address ? '📍 ' + esc(l.address) : '',
    l.phones.length ? '📞 ' + l.phones.map((p) => `<code>${esc(p)}</code>`).join(', ') : '📞 нет телефона',
    l.website ? '🌐 ' + esc(l.website) : '🌐 сайта нет',
    `Сайт: <b>${STATUS_RU[s] || s}</b>${l.site?.builder ? ' (' + esc(l.site.builder) + ')' : ''} · потребность ${score(l)}%`,
    ...(l.site?.reasons || []).slice(0, 5).map((r) => '  • ' + esc(r)),
    l.socials.length ? '💬 ' + l.socials.map(esc).join('\n      ') : '',
    l.emails?.length ? '✉️ ' + l.emails.map(esc).join(', ') : '',
    l.rating ? `⭐ ${l.rating}${l.reviews ? ` (${l.reviews} отзывов)` : ''}` : '',
    `Статус: <b>${LEAD_STATUS[l.status] || l.status}</b>`,
    l.note ? '📝 ' + esc(l.note) : '',
  ].filter(Boolean);
  const digits = (l.phones[0] || '').replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');
  const links = [];
  if (digits) links.push({ text: 'WhatsApp', url: 'https://wa.me/' + digits });
  const mapRow = mapLinks(l, db.getSettings()).map((m) => ({ text: (m.direct ? '📍 ' : '🔎 ') + m.name.replace(' Карты', '').replace(' Maps', ''), url: m.url }));
  const st = Object.entries(LEAD_STATUS).map(([k, v]) => ({ text: (l.status === k ? '✅ ' : '') + v, callback_data: `st:${l.id}:${k}` }));
  return {
    text: lines.join('\n'),
    extra: ik([
      st.slice(0, 3), st.slice(3),
      [{ text: '✉ Текст для первого касания', callback_data: 'msg:' + l.id }, { text: '🔄 Перепроверить', callback_data: 'rc:' + l.id }],
      ...(links.length ? [links] : []),
      mapRow,
    ]),
  };
}

const HELP = `<b>LeadHunter в Telegram</b>

Бот работает вместе с программой на ПК: та же база и тот же парсер. Запуск с ПК виден здесь, изменения отсюда видны на ПК.

📱 <b>Приложение</b> — кнопка «LeadHunter» слева от поля ввода (или /app): парсер, база, карточки, воронка, статистика.
Ниже — то же самое командами:

🚀 <b>Парсинг</b> — мастер запуска по шагам
Быстрый запуск одной строкой:
<code>/parse автосервис, шиномонтаж | Казань, Уфа | 2gis,yandex | 50</code>

📊 /status — прогресс и статистика базы
🔥 /hot — конторы, которым нужен сайт
🔎 /find <i>текст</i> — поиск по названию
📁 /export — выгрузка CSV
🔄 /recheck — перепроверить все сайты
⏹ /stop — остановить парсинг
✖ /cancel — отменить мастер

Важно: парсер открывает браузер на ПК. Если 2ГИС или Яндекс покажут капчу, её нужно пройти в окне на ПК, поэтому для первых запусков фоновый режим лучше не включать.`;

// ---------- обработка сообщений ----------
async function onMessage(m) {
  const chatId = m.chat.id, uid = m.from?.id;
  let text = (m.text || '').trim();
  if (!text || m.chat.type !== 'private') return;

  if (!isOwner(uid)) {
    if (!access.owners.length && /^\/start/.test(text)) {
      access.owners.push(uid); saveAccess();
      console.log(`[tg] Владелец бота: ${uid} (@${m.from.username || '-'})`);
      await send(chatId, '🔐 Ты привязан как владелец бота. Остальным доступ закрыт.\n\n' + HELP, { reply_markup: MAIN_KB });
      if (appUrl) await send(chatId, '📱 Открой приложение:', ik([appButton()]));
      return;
    }
    return send(chatId, `Нет доступа. Твой Telegram ID: <code>${uid}</code>\nВладелец может добавить его в TELEGRAM_ALLOWED в файле .env.`);
  }

  if (BUTTONS[text]) text = BUTTONS[text];
  const [cmdRaw, ...rest] = text.split(' ');
  const cmd = cmdRaw.startsWith('/') ? cmdRaw.split('@')[0].toLowerCase() : '';
  const arg = rest.join(' ').trim();

  if (cmd) {
    if (cmd !== '/parse') sessions.delete(chatId);
    if (cmd === '/start' || cmd === '/help' || cmd === '/app') {
      if (cmd !== '/app') await send(chatId, HELP, { reply_markup: MAIN_KB });
      return send(chatId, appUrl ? '📱 Всё то же самое, но удобнее, — в приложении:' : '📱 Приложение ещё запускается, попробуй /app через минуту.',
        appUrl ? ik([appButton()]) : {});
    }
    if (cmd === '/cancel') return send(chatId, 'Отменено.', { reply_markup: MAIN_KB });
    if (cmd === '/status') {
      const j = jobs.getJob();
      const head = j ? progressText(j) : 'Парсинг ещё не запускался.';
      return send(chatId, head + '\n\n' + dbStats(), j?.running ? ik([[{ text: '⏹ Остановить', callback_data: 'stop' }]]) : {});
    }
    if (cmd === '/stop') {
      if (!jobs.getJob()?.running) return send(chatId, 'Парсинг сейчас не идёт.');
      jobs.stop(); return send(chatId, '⏹ Останавливаю…');
    }
    if (cmd === '/recheck') {
      const n = jobs.recheck();
      return send(chatId, `🔄 В очереди на проверку сайтов: ${n}`);
    }
    if (cmd === '/hot') { const v = hotView(0); return send(chatId, v.text, v.extra); }
    if (cmd === '/export') {
      return send(chatId, 'Что выгрузить в CSV?', ik([[{ text: '🔥 Горячие', callback_data: 'exp:hot' }, { text: '📋 Вся база', callback_data: 'exp:all' }]]));
    }
    if (cmd === '/find') {
      if (!arg) return send(chatId, 'Напиши так: <code>/find барбершоп</code>');
      const q = arg.toLowerCase();
      const found = db.getLeads().filter((l) => (l.name + ' ' + l.category + ' ' + l.phones.join(' ')).toLowerCase().includes(q)).slice(0, 10);
      return send(chatId, found.length ? found.map(leadLine).join('\n\n') : 'Ничего не нашлось.');
    }
    if (cmd.startsWith('/l_')) {
      const l = db.getLead(cmd.slice(3));
      if (!l) return send(chatId, 'Контора не найдена (возможно, удалена).');
      const v = leadView(l); return send(chatId, v.text, v.extra);
    }
    if (cmd === '/parse') {
      if (arg) {
        const [niches, cities = '', src = '', lim = ''] = arg.split('|').map((x) => x.trim());
        const sources = src ? src.toLowerCase().split(/[\s,]+/).map((x) => (x === '2гис' ? '2gis' : x === 'яндекс' ? 'yandex' : x)).filter(Boolean) : access.lastSources;
        return launch(chatId, { niches, cities, sources, limit: +lim || access.lastLimit, headless: !!db.getSettings().headless });
      }
      if (jobs.getJob()?.running) return send(chatId, 'Парсинг уже идёт. /status — прогресс, /stop — остановить.');
      sessions.set(chatId, { step: 'niches', sources: new Set(access.lastSources), limit: access.lastLimit, headless: !!db.getSettings().headless });
      return send(chatId, '<b>Шаг 1/4.</b> Напиши ниши через запятую или нажми готовую.\n\nНапример: <code>автосервис, барбершоп</code>', {
        reply_markup: { keyboard: [...chunk(NICHES.map((t) => ({ text: t })), 2), [{ text: '/cancel' }]], resize_keyboard: true, one_time_keyboard: true },
      });
    }
    return send(chatId, 'Не знаю такой команды. /help');
  }

  const s = sessions.get(chatId);
  if (s?.step === 'niches') {
    s.niches = text; s.step = 'cities';
    return send(chatId, `<b>Шаг 2/4.</b> Города через запятую.\nНапример: <code>Казань, Уфа</code>`, {
      reply_markup: { keyboard: [[{ text: '— без города —' }], [{ text: '/cancel' }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }
  if (s?.step === 'cities') {
    s.cities = text === '— без города —' ? '' : text; s.step = 'sources';
    await send(chatId, 'Ок 👍', { reply_markup: MAIN_KB });
    const v = sourcesView(s); return send(chatId, v.text, v.extra);
  }
  return send(chatId, 'Выбери действие на клавиатуре или /help', { reply_markup: MAIN_KB });
}

async function onCallback(q) {
  const chatId = q.message?.chat.id, mid = q.message?.message_id, data = q.data || '';
  if (!isOwner(q.from.id)) return api('answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа', show_alert: true });
  let answer = '';
  const [kind, a, b] = data.split(':');
  const s = sessions.get(chatId);

  if (kind === 'src' && s) {
    if (a === 'next') {
      if (!s.sources.size) answer = 'Выбери хотя бы один источник';
      else { s.step = 'confirm'; const v = confirmView(s); await edit(chatId, mid, v.text, v.extra); }
    } else { s.sources.has(a) ? s.sources.delete(a) : s.sources.add(a); const v = sourcesView(s); await edit(chatId, mid, v.text, v.extra); }
  } else if (kind === 'lim' && s) {
    s.limit = +a; const v = confirmView(s); await edit(chatId, mid, v.text, v.extra);
  } else if (kind === 'wiz' && s) {
    if (a === 'cancel') { sessions.delete(chatId); await edit(chatId, mid, 'Отменено.'); }
    if (a === 'hl') { s.headless = !s.headless; const v = confirmView(s); await edit(chatId, mid, v.text, v.extra); }
    if (a === 'go') {
      sessions.delete(chatId);
      await edit(chatId, mid, confirmView(s).text.replace('Шаг 4/4. Проверь и запускай', 'Запуск…'));
      await launch(chatId, { niches: s.niches, cities: s.cities, sources: [...s.sources], limit: s.limit, headless: s.headless });
    }
  } else if (['src', 'lim', 'wiz'].includes(kind)) {
    answer = 'Мастер устарел — начни заново: 🚀 Парсинг';
  } else if (kind === 'stop') {
    jobs.stop(); answer = 'Останавливаю…';
  } else if (kind === 'hot') {
    const v = hotView(+a); await edit(chatId, mid, v.text, v.extra);
  } else if (kind === 'exp') {
    const list = a === 'hot' ? hotLeads() : db.getLeads();
    if (!list.length) answer = 'Нечего выгружать';
    else {
      await api('answerCallbackQuery', { callback_query_id: q.id, text: 'Готовлю файл…' });
      await sendDocument(chatId, `leads-${a}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list, db.getSettings()), `${a === 'hot' ? 'Горячие' : 'Вся база'}: ${list.length} шт.`);
      return;
    }
  } else if (kind === 'st') {
    const l = db.updateLead(a, { status: b });
    if (!l) answer = 'Контора не найдена';
    else { jobs.notifyLead(l); answer = 'Статус: ' + LEAD_STATUS[b]; const v = leadView(l); await edit(chatId, mid, v.text, v.extra); }
  } else if (kind === 'msg') {
    const l = db.getLead(a);
    if (l) {
      const msg = (db.getSettings().messageTemplate || '').replace('{name}', l.name).replace('{problem}', problemText(l));
      await send(chatId, `<code>${esc(msg)}</code>\n\n<i>Нажми на текст, чтобы скопировать.</i>`);
    }
  } else if (kind === 'rc') {
    jobs.recheck([a]); answer = 'Сайт поставлен на проверку';
  }
  await api('answerCallbackQuery', { callback_query_id: q.id, text: answer }).catch(() => {});
}

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// ---------- живой прогресс (для любых запусков: с ПК или из бота) ----------
let prog = null; // { startedAt, msgs: [{chat, id}], timer }
function flushProgress() {
  if (!prog) return;
  prog.timer = null;
  const j = jobs.getJob();
  const text = progressText(j);
  const extra = j?.running ? ik([[{ text: '⏹ Остановить', callback_data: 'stop' }]]) : {};
  for (const m of prog.msgs) edit(m.chat, m.id, text, extra).catch(() => {});
}
jobs.subscribe((type, data) => {
  if (!TOKEN || !access.owners.length) return;
  if (type === 'job' && data) {
    if (data.running && (!prog || prog.startedAt !== data.startedAt)) {
      const p = (prog = { startedAt: data.startedAt, msgs: [], timer: null });
      for (const chat of access.owners) {
        send(chat, progressText(data), ik([[{ text: '⏹ Остановить', callback_data: 'stop' }]]))
          .then((r) => p.msgs.push({ chat, id: r.message_id })).catch((e) => console.error('[tg]', e.message));
      }
    } else if (data.running && prog && !prog.timer) {
      prog.timer = setTimeout(flushProgress, 4000);
    } else if (!data.running && prog && prog.startedAt === data.startedAt && !prog.finished) {
      prog.finished = true;
      clearTimeout(prog.timer);
      flushProgress();
      const hotNew = db.getLeads().filter((l) => l.createdAt >= data.startedAt && HOT.has(siteStatus(l))).length;
      broadcast(`🏁 Парсинг закончен: найдено <b>${data.found}</b>, новых <b>${data.newLeads}</b>, из них нужен сайт: <b>${hotNew}</b>` +
        (jobs.checkStats().queued + jobs.checkStats().checking ? '\nСайты ещё проверяются, цифра может вырасти.' : ''),
        ik([[{ text: '🔥 Горячие', callback_data: 'hot:0' }, { text: '📁 CSV горячих', callback_data: 'exp:hot' }], ...(appUrl ? [appButton('📱 Открыть в приложении')] : [])]));
    }
  }
  if (type === 'log' && /⚠/.test(data.msg)) broadcast(esc(data.msg));
});

// ---------- long polling ----------
let running = false;
async function poll() {
  let offset = 0, fails = 0;
  while (running) {
    try {
      const ups = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, 45000);
      fails = 0;
      for (const u of ups) {
        offset = u.update_id + 1;
        const h = u.message ? onMessage(u.message) : u.callback_query ? onCallback(u.callback_query) : null;
        h?.catch((e) => console.error('[tg] Ошибка обработки:', e.message));
      }
    } catch (e) {
      if (!running) break;
      fails++;
      if (e.code === 409) console.error('[tg] Бот уже запущен в другом месте (409). Закрой второй экземпляр.');
      else if (e.code === 401) { console.error('[tg] Неверный токен бота — проверь TELEGRAM_BOT_TOKEN в .env'); running = false; break; }
      else if (fails === 1 || fails % 20 === 0) console.error('[tg] Нет связи с Telegram:', e.message);
      await sleep(Math.min(30000, 2000 * fails));
    }
  }
}

async function start() {
  if (!TOKEN) { console.log('  Telegram-бот выключен: нет TELEGRAM_BOT_TOKEN в .env'); return; }
  running = true;
  try {
    const me = await api('getMe');
    console.log(`  Telegram-бот @${me.username} запущен` + (access.owners.length ? '' : ' — напиши ему /start, чтобы стать владельцем'));
    await api('deleteWebhook', {}).catch(() => {});
    await api('setMyCommands', { commands: [
      { command: 'app', description: 'Открыть приложение' },
      { command: 'parse', description: 'Запустить парсинг' },
      { command: 'status', description: 'Прогресс и статистика' },
      { command: 'hot', description: 'Кому нужен сайт' },
      { command: 'find', description: 'Поиск по базе' },
      { command: 'export', description: 'Выгрузка CSV' },
      { command: 'recheck', description: 'Перепроверить сайты' },
      { command: 'stop', description: 'Остановить парсинг' },
      { command: 'help', description: 'Справка' },
    ] }).catch(() => {});
  } catch (e) {
    console.error('[tg] Не удалось подключиться к Telegram:', e.message, '— буду пробовать дальше');
    if (e.code === 401) { running = false; return; }
  }
  poll();
}
function stop() { running = false; }

module.exports = { start, stop, setAppUrl, checkInitData, sendCsv };
