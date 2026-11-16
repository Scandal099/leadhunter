// Хранилище лидов: локальный кэш в JSON + опциональная облачная синхронизация (Supabase)
const fs = require('fs');
const path = require('path');
const cloud = require('./cloud');

const APP_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA_DIR = path.join(APP_DIR, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  twogisDomain: '2gis.ru',
  yandexDomain: 'yandex.ru',
  headless: false,
  delayMs: 1200,
  siteCheckConcurrency: 6,
  supabaseUrl: 'https://mahpmhesnbgdmqvcddul.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1haHBtaGVzbmJnZG1xdmNkZHVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MzMwMzUsImV4cCI6MjExMDQwOTAzNX0.tzSJ58FPrQ_HEK_3y4AW4jwmR_ENpS7dKN7lJ91FhxU',
  messageTemplate:
    'Здравствуйте! Нашёл вашу компанию «{name}» на картах. {problem} Я делаю современные сайты под ключ — быстро, с адаптивом под телефоны и формой заявки. Могу показать пару примеров и прислать бесплатный макет главной страницы. Интересно?',
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

let leads = readJson(LEADS_FILE, []);
let settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };

const listeners = new Set();
const emit = (type, data) => { for (const fn of listeners) fn(type, data); };
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  clearTimeout(saveTimer);
  const tmp = LEADS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(leads));
  fs.renameSync(tmp, LEADS_FILE);
}

const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
};
const normName = (s) => String(s || '').toLowerCase().replace(/[«»"'`.,\-–—()]/g, '').replace(/\s+/g, ' ').trim();
const normAddr = (s) => normName(s).replace(/\b(ул|улица|д|дом|пр|проспект|корп|к|стр)\b/g, '').replace(/\s+/g, ' ').trim();

function findDuplicateIn(list, lead) {
  const phones = new Set((lead.phones || []).map(normPhone).filter((p) => p.length >= 10));
  const n = normName(lead.name), a = normAddr(lead.address);
  return list.find((l) => {
    if (phones.size && (l.phones || []).some((p) => phones.has(normPhone(p))) && normName(l.name).slice(0, 4) === n.slice(0, 4)) return true;
    return n && a && normName(l.name) === n && normAddr(l.address) === a;
  });
}

function findDuplicate(lead) {
  return findDuplicateIn(leads, lead);
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function mergeLeadData(target, input) {
  target.phones = uniq([...(target.phones || []), ...(input.phones || [])]);
  target.socials = uniq([...(target.socials || []), ...(input.socials || [])]);
  target.emails = uniq([...(target.emails || []), ...(input.emails || [])]);
  if (!target.website && input.website) { target.website = input.website; target.site = null; }
  for (const s of input.sources || []) {
    if (!target.sources.some((x) => x.src === s.src)) target.sources.push(s);
  }
  if (!target.rating && input.rating) { target.rating = input.rating; target.reviews = input.reviews; }
  target.category = target.category || input.category;
  target.lat = target.lat || input.lat;
  target.lon = target.lon || input.lon;
  target.updatedAt = Date.now();
}

// ---------- Облачная синхронизация ----------
const pendingUpserts = new Set();
const pendingDeletes = new Set();
let pushTimer = null;
let syncTimer = null;
let syncing = false;
let lastSyncTs = 0;
let cloudState = {
  enabled: cloud.isConfigured(settings),
  connected: false,
  lastSyncAt: 0,
  error: null,
  syncing: false,
};

function scheduleCloudPush(immediate = false) {
  if (!cloud.isConfigured(settings)) return;
  clearTimeout(pushTimer);
  if (immediate || pendingUpserts.size >= 40) {
    flushCloud().catch((e) => console.error('[cloud push]', e.message));
  } else {
    pushTimer = setTimeout(() => {
      flushCloud().catch((e) => console.error('[cloud push]', e.message));
    }, 1000);
  }
}

async function flushCloud() {
  clearTimeout(pushTimer);
  if (!cloud.isConfigured(settings)) return;
  if (pendingDeletes.size) {
    const delIds = [...pendingDeletes];
    pendingDeletes.clear();
    try {
      await cloud.deleteLeads(settings, delIds);
    } catch (e) {
      delIds.forEach((id) => pendingDeletes.add(id));
      cloudState.error = e.message;
      cloudState.connected = false;
      throw e;
    }
  }
  if (pendingUpserts.size) {
    const ids = [...pendingUpserts];
    pendingUpserts.clear();
    const byId = new Map(leads.map((l) => [l.id, l]));
    const batch = ids.map((id) => byId.get(id)).filter(Boolean);
    if (batch.length) {
      try {
        await cloud.upsertLeads(settings, batch);
      } catch (e) {
        ids.forEach((id) => pendingUpserts.add(id));
        cloudState.error = e.message;
        cloudState.connected = false;
        throw e;
      }
    }
  }
}

async function syncCloud() {
  const enabled = cloud.isConfigured(settings);
  cloudState.enabled = enabled;
  if (!enabled) {
    cloudState.connected = false;
    cloudState.error = null;
    return cloudState;
  }
  if (syncing) return cloudState;
  syncing = true;
  cloudState.syncing = true;
  try {
    await flushCloud();

    const isInitial = lastSyncTs === 0;
    const rows = await cloud.fetchRows(settings, lastSyncTs);
    let maxTs = lastSyncTs;
    const changedLeads = [];
    const deletedIds = [];

    if (isInitial) {
      const byId = new Map(leads.map((l) => [l.id, l]));
      const cloudIds = new Set();
      let changed = false;

      for (const row of rows) {
        if (row.updated_at > maxTs) maxTs = row.updated_at;
        if (row.deleted || !row.data || !row.data.id) continue;
        const remote = row.data;
        cloudIds.add(remote.id);
        const local = byId.get(remote.id);
        if (!local) {
          byId.set(remote.id, remote);
          changedLeads.push(remote);
          changed = true;
        } else if ((remote.updatedAt || row.updated_at) > (local.updatedAt || 0)) {
          byId.set(remote.id, remote);
          changedLeads.push(remote);
          changed = true;
        } else if ((local.updatedAt || 0) > (remote.updatedAt || row.updated_at)) {
          pendingUpserts.add(local.id);
        }
      }

      // Локальные лиды, которых ещё нет в облаке, отправляем в облако (если не дубли)
      const mergedList = [...byId.values()];
      const cloudList = rows.filter((r) => !r.deleted && r.data?.id).map((r) => r.data);
      for (const local of leads) {
        if (cloudIds.has(local.id)) continue;
        const dup = findDuplicateIn(cloudList, local);
        if (dup) {
          // Сливаем локальные заметки/статус/контакты в облачный дубль, если нужно
          const before = JSON.stringify(dup);
          mergeLeadData(dup, local);
          if (local.status && local.status !== 'new' && dup.status === 'new') dup.status = local.status;
          if (local.note && !dup.note) dup.note = local.note;
          if (local.contactPerson && !dup.contactPerson) dup.contactPerson = local.contactPerson;
          byId.delete(local.id);
          byId.set(dup.id, dup);
          if (JSON.stringify(dup) !== before) pendingUpserts.add(dup.id);
          changed = true;
        } else {
          pendingUpserts.add(local.id);
        }
      }

      leads = [...byId.values()];
      if (changed) saveNow();
      if (pendingUpserts.size) await flushCloud();
      if (changedLeads.length) emit('sync', { count: changedLeads.length });
    } else if (rows.length) {
      const byId = new Map(leads.map((l) => [l.id, l]));
      let changed = false;

      for (const row of rows) {
        if (row.updated_at > maxTs) maxTs = row.updated_at;
        if (row.deleted) {
          if (byId.has(row.id) && !pendingUpserts.has(row.id)) {
            byId.delete(row.id);
            deletedIds.push(row.id);
            changed = true;
          }
        } else if (row.data && row.data.id) {
          const remote = row.data;
          const local = byId.get(remote.id);
          if (!local) {
            byId.set(remote.id, remote);
            changedLeads.push(remote);
            changed = true;
          } else if (!pendingUpserts.has(remote.id) && (remote.updatedAt || row.updated_at) > (local.updatedAt || 0)) {
            byId.set(remote.id, remote);
            changedLeads.push(remote);
            changed = true;
          }
        }
      }

      if (changed) {
        leads = [...byId.values()];
        saveNow();
        if (changedLeads.length + deletedIds.length > 15) {
          emit('sync', { count: changedLeads.length + deletedIds.length });
        } else {
          for (const l of changedLeads) emit('lead', l);
          if (deletedIds.length) emit('deleted', { ids: deletedIds });
        }
      }
    }

    lastSyncTs = maxTs || Date.now();
    cloudState.connected = true;
    cloudState.error = null;
    cloudState.lastSyncAt = Date.now();
  } catch (e) {
    cloudState.connected = false;
    cloudState.error = e.message;
  } finally {
    syncing = false;
    cloudState.syncing = false;
  }
  return cloudState;
}

function startCloudSync(intervalMs = 4000) {
  stopCloudSync();
  if (cloud.isConfigured(settings)) {
    syncCloud().then((st) => {
      if (st.connected) console.log(`  Облачная БД (Supabase) подключена — лидов в базе: ${leads.length}`);
      else if (st.error) console.error(`  Ошибка облачной БД (Supabase): ${st.error}`);
    });
  }
  syncTimer = setInterval(() => {
    if (cloud.isConfigured(settings)) syncCloud();
  }, intervalMs);
}

function stopCloudSync() {
  clearInterval(syncTimer);
  syncTimer = null;
}

/** Добавить или слить с существующим. Возвращает {lead, isNew} */
function upsertLead(input) {
  const dup = findDuplicate(input);
  if (dup) {
    mergeLeadData(dup, input);
    scheduleSave();
    pendingDeletes.delete(dup.id);
    pendingUpserts.add(dup.id);
    scheduleCloudPush(false);
    return { lead: dup, isNew: false };
  }
  const lead = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: input.name,
    category: input.category || '',
    address: input.address || '',
    city: input.city || '',
    niche: input.niche || '',
    phones: uniq(input.phones || []),
    website: input.website || '',
    socials: uniq(input.socials || []),
    emails: uniq(input.emails || []),
    rating: input.rating || null,
    reviews: input.reviews || null,
    lat: input.lat || null,
    lon: input.lon || null,
    sources: input.sources || [],
    site: null,
    status: 'new',
    note: '',
    contactPerson: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  leads.push(lead);
  scheduleSave();
  pendingDeletes.delete(lead.id);
  pendingUpserts.add(lead.id);
  scheduleCloudPush(false);
  return { lead, isNew: true };
}

function updateLead(id, patch) {
  const l = leads.find((x) => x.id === id);
  if (!l) return null;
  const allowed = ['status', 'note', 'contactPerson', 'website', 'site', 'phones', 'socials', 'enriched', 'demoUrl'];
  for (const k of allowed) if (k in patch) l[k] = patch[k];
  l.updatedAt = Date.now();
  scheduleSave();
  pendingDeletes.delete(id);
  pendingUpserts.add(id);
  scheduleCloudPush(true);
  return l;
}

function deleteLeads(ids) {
  const set = new Set(ids);
  leads = leads.filter((l) => !set.has(l.id));
  scheduleSave();
  for (const id of ids) {
    pendingUpserts.delete(id);
    pendingDeletes.add(id);
  }
  scheduleCloudPush(true);
}

module.exports = {
  getLeads: () => leads,
  getLead: (id) => leads.find((l) => l.id === id),
  upsertLead, updateLead, deleteLeads, saveNow,
  subscribe,
  getCloudStatus: () => ({
    ...cloudState,
    enabled: cloud.isConfigured(settings),
    envConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY),
    totalLeads: leads.length,
  }),
  syncCloud,
  startCloudSync,
  stopCloudSync,
  flushCloud,
  getSettings: () => settings,
  setSettings(patch) {
    const prevUrl = settings.supabaseUrl;
    const prevKey = settings.supabaseKey;
    settings = { ...settings, ...patch };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    if (settings.supabaseUrl !== prevUrl || settings.supabaseKey !== prevKey) {
      lastSyncTs = 0;
      cloudState.enabled = cloud.isConfigured(settings);
      cloudState.connected = false;
      cloudState.error = null;
      syncCloud();
    }
    return settings;
  },
  DATA_DIR,
};
