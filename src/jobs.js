// Очередь парсинга: ниши × города × источники, затем проверка сайтов
const db = require('./db');
const { getContext } = require('./browser');
const { checkSite, networkOk } = require('./siteCheck');
const SOURCES = {
  '2gis': require('./sources/twogis'),
  yandex: require('./sources/yandex'),
  google: require('./sources/google'),
};
const SOURCE_NAMES = { '2gis': '2ГИС', yandex: 'Яндекс', google: 'Google' };

const listeners = new Set();
const emit = (type, data) => { for (const fn of listeners) fn(type, data); };

let job = null; // текущее задание
const logs = [];
function log(msg) {
  const e = { t: Date.now(), msg };
  logs.push(e); if (logs.length > 400) logs.shift();
  emit('log', e);
  console.log('[job]', msg);
}

function publicJob() {
  if (!job) return null;
  const { stop, ...rest } = job;
  return rest;
}
function progress(patch) { Object.assign(job, patch); emit('job', publicJob()); }

const checkQueue = [];
let checking = 0;
function queueCheck(lead) {
  checkQueue.push(lead.id);
  pumpChecks();
}
function pumpChecks() {
  const conc = db.getSettings().siteCheckConcurrency || 6;
  while (checking < conc && checkQueue.length) {
    const id = checkQueue.shift();
    const lead = db.getLead(id);
    if (!lead) continue;
    checking++;
    checkSite(lead.website, lead.socials)
      .then((site) => { db.updateLead(id, { site }); emit('lead', db.getLead(id)); })
      .catch((e) => log('Ошибка проверки сайта ' + lead.website + ': ' + e.message))
      .finally(() => {
        checking--;
        if (job) progress({ checked: (job.checked || 0) + 1 });
        pumpChecks();
        if (!checking && !checkQueue.length) emit('checksDone', {});
      });
  }
}

async function start(opts) {
  if (job && job.running) throw new Error('Парсинг уже идёт');
  const niches = splitList(opts.niches);
  const cities = splitList(opts.cities);
  if (!cities.length) cities.push('');
  const sources = (opts.sources || []).filter((s) => SOURCES[s]);
  if (!niches.length) throw new Error('Укажи хотя бы одну нишу');
  if (!sources.length) throw new Error('Выбери хотя бы один источник');
  const limit = Math.max(1, Math.min(1000, +opts.limit || 50));
  const settings = { ...db.getSettings(), headless: !!opts.headless };

  const tasks = [];
  for (const niche of niches) for (const city of cities) for (const src of sources) tasks.push({ niche, city, src });

  job = { running: true, startedAt: Date.now(), total: tasks.length, done: 0, found: 0, newLeads: 0, checked: 0, current: '', stopRequested: false };
  logs.length = 0;
  emit('job', publicJob());
  log(`Старт: ${niches.length} ниш × ${cities.length} городов × ${sources.length} источников = ${tasks.length} заданий, до ${limit} фирм на каждое`);

  (async () => {
    let page;
    try {
      if (!(await networkOk())) {
        log('⚠ Российские сайты (ya.ru, rbc.ru, mail.ru) не открываются из твоей сети — похоже, включён VPN. ' +
          '2ГИС и Яндекс Карты не загрузятся, а сайты нельзя будет проверить. Выключи VPN и запусти заново.');
      }
      const ctx = await getContext(settings.headless);
      page = await ctx.newPage();
      for (const t of tasks) {
        if (job.stopRequested) break;
        progress({ current: `${SOURCE_NAMES[t.src]} · ${t.niche}${t.city ? ' · ' + t.city : ''}` });
        try {
          await SOURCES[t.src].run({
            page, niche: t.niche, city: t.city, limit, settings, delayMs: settings.delayMs || 1200,
            log, shouldStop: () => job.stopRequested,
            onItem: (item) => {
              if (!item.name) return;
              const { lead, isNew } = db.upsertLead(item);
              job.found++;
              if (isNew) job.newLeads++;
              emit('lead', lead);
              emit('job', publicJob());
              if (opts.checkSites !== false && (isNew || !lead.site)) queueCheck(lead);
            },
          });
        } catch (e) {
          log(`Ошибка (${SOURCE_NAMES[t.src]}): ${e.message.split('\n')[0]}`);
        }
        progress({ done: job.done + 1 });
      }
    } catch (e) {
      log('Не удалось запустить браузер: ' + e.message.split('\n')[0]);
    } finally {
      if (page) await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
      db.saveNow();
      log(job.stopRequested ? 'Остановлено' : `Готово: найдено ${job.found}, новых ${job.newLeads}`);
      progress({ running: false, current: '', finishedAt: Date.now() });
    }
  })();
  return publicJob();
}

function stop() { if (job && job.running) { job.stopRequested = true; log('Останавливаю…'); } }

function recheck(ids) {
  const list = ids && ids.length ? ids.map(db.getLead).filter(Boolean) : db.getLeads();
  for (const l of list) queueCheck(l);
  log(`Проверка сайтов: в очереди ${list.length}`);
  return list.length;
}

function splitList(s) {
  return String(s || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
}

module.exports = {
  start, stop, recheck,
  getJob: publicJob, getLogs: () => logs,
  checkStats: () => ({ checking, queued: checkQueue.length }),
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  // сообщить всем (веб-интерфейсу) об изменении лида, сделанном вне веба — например, из Telegram
  notifyLead(lead) { if (lead) emit('lead', lead); },
  notify: emit,
  SOURCE_NAMES,
};
