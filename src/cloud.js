// Облачная синхронизация через Supabase REST API (PostgreSQL + PostgREST)
// Не требует внешних npm-зависимостей — работает через встроенный fetch (Node 18+).

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 200;

function normalizeConfig(cfg = {}) {
  const url = String(process.env.SUPABASE_URL || cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_KEY || cfg.supabaseKey || '').trim();
  return { url, key };
}

function isConfigured(cfg) {
  const { url, key } = normalizeConfig(cfg);
  return Boolean(url && key);
}

async function sbFetch(cfg, path, options = {}) {
  const { url, key } = normalizeConfig(cfg);
  if (!url || !key) throw new Error('Supabase не настроен');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.message || json?.hint || json?.error || text || `HTTP ${res.status}`;
    if (/relation .*leads.* does not exist|Could not find the table/i.test(msg)) {
      throw new Error('Таблица leads не создана в Supabase. Выполни SQL из Настроек в SQL Editor.');
    }
    throw new Error(msg);
  }
  return json;
}

async function testConnection(cfg) {
  if (!isConfigured(cfg)) return { ok: false, error: 'Не указаны SUPABASE_URL или SUPABASE_KEY' };
  try {
    await sbFetch(cfg, 'leads?select=id&limit=1');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchRows(cfg, sinceTs = 0) {
  const all = [];
  let offset = 0;
  const filter = sinceTs > 0
    ? `updated_at=gt.${sinceTs}`
    : 'deleted=eq.false';
  while (true) {
    const rows = await sbFetch(
      cfg,
      `leads?select=id,data,updated_at,deleted&${filter}&order=updated_at.asc`,
      { headers: { Range: `${offset}-${offset + PAGE_SIZE - 1}` } }
    );
    if (!Array.isArray(rows) || !rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function upsertLeads(cfg, leads) {
  if (!leads.length) return;
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE).map((l) => ({
      id: l.id,
      data: l,
      updated_at: l.updatedAt || Date.now(),
      deleted: false,
    }));
    await sbFetch(cfg, 'leads?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
  }
}

async function deleteLeads(cfg, ids) {
  if (!ids.length) return;
  const now = Date.now();
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE).map((id) => ({
      id,
      data: {},
      updated_at: now,
      deleted: true,
    }));
    await sbFetch(cfg, 'leads?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
  }
}

module.exports = {
  normalizeConfig,
  isConfigured,
  testConnection,
  fetchRows,
  upsertLeads,
  deleteLeads,
};
