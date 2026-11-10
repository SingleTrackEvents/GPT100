// GPT100 Safety Worker (Cloudflare): the weather refresh relay and the Race Control incident log.
// It holds the GitHub key as a secret, so the key is never in the app or on anyone's device.
// Setup steps: tools/REFRESH_WORKER.md (weather) and tools/RACE_CONTROL.md (race control).
//
//   POST /refresh            start a quick refresh (warnings, observations, fires, CFA, air quality)
//   POST /refresh?models=1   start a full refresh, including fresh forecast models
//   GET  /status             the latest weather watch run (for the app's progress message)
//   Cron trigger             starts the watch every 15 minutes (GitHub's own timer misses most runs)
//
// Race Control (needs the D1 database bound as DB, and the RC_PASSWORD secret; every call sends the password):
//   GET  /rc/state?since=ms  incidents, units and log entries changed since then
//   POST /rc/incident        create or update an incident: { id?, patch, note?, who }
//   POST /rc/unit            update a unit's status: { id, patch, note?, who }
//   POST /rc/log             add a radio log entry: { text, incident?, who }
//   GET  /rc/ra?since=ms     risk assessments changed since then (the Risk tab)
//   POST /rc/ra              create or update a risk assessment: { id, patch, note?, who }. Once it's signed off,
//                            only its actions and reviews can change (409 for anything else)
//
// Live GPS tracking relay (the tracking provider's files, with CORS headers the app can use; no key needed):
//   GET  /gps/<event>/init.txt            the event setup and competitors
//   GET  /gps/<event>/data.lst            every position so far
//   GET  /gps/<event>/data.php?offset=…   the new positions since a byte offset (live events)
//   GET  /gps/time.php                    the provider's clock
//
// Timing chip relay (the timing team's RaceResult Simple API list, tools/TIMING.md; the link lives here as a secret):
//   GET  /timing/                         the latest list as JSON, cached 20 seconds on the edge
//
// Race archive (needs the DB database and the RC_PASSWORD secret; every call sends the password, from anywhere):
//   Cron trigger             during the race window, keeps a copy of the timing list (every 15 minutes) and of each
//                            GPS event's init.txt and data.lst (every hour) in the database, for next year's predictions
//   GET  /archive/list       every copy kept: when, what, size
//   GET  /archive/part?snap=…&part=n   one piece of a copy (gzip)
//   POST /archive/now        take a copy of everything now, inside the window or not (the final copy after the race)
//   Feed health (same timer, during the race window): a GPS event with no new positions for 20 minutes while the race
//                            is on, the timing list unchanged for an hour while trackers still send, or a timing column
//                            with no reads while columns further on have them. Each new problem goes to the phone (ntfy,
//                            the NTFY_TOPIC secret), and again when it clears.
//   Download them all with tools/archive_race.mjs. Setup and use: tools/ARCHIVE.md.
//
// Secret:    GITHUB_TOKEN   fine-grained key, this repository only, Actions read and write
// Secret:    TIMING_URL     the RaceResult Simple API link for the timing list (optional, turns on /timing/)
// Optional:  REPO, WORKFLOW, BRANCH, ALLOWED_ORIGIN (defaults below; several origins separated by commas)
// Optional:  ARCHIVE_GPS (GPS event ids, separated by commas), ARCHIVE_FROM and ARCHIVE_TO (the race window, as
//            ISO times with the offset), defaults below. Change them for next year's race. The archive also follows every
//            GPS event in the app's published config (SITE_CONFIG, tracking.gps), so an event added on the day is kept.
// Secret:    NTFY_TOPIC     the ntfy topic for feed health alerts on the phone (optional; the weather watch's topic works)

const DEFAULTS = {
  REPO: 'SingleTrackEvents/GPT100Safety',
  WORKFLOW: 'weather.yml',
  BRANCH: 'main',
  ALLOWED_ORIGIN: 'https://singletrackevents.github.io,https://app.gpt100.com.au',
  ARCHIVE_GPS: '20261106gpt100,20261105gpt50',
  ARCHIVE_FROM: '2026-11-05T05:00:00+11:00',
  ARCHIVE_TO: '2026-11-09T12:00:00+11:00',
  SITE_CONFIG: 'https://singletrackevents.github.io/GPT100Safety/data/config.js'
};
const GPS_HOST = 'https://tulospalvelu.fi/gps/';  // the GPS tracking provider (GPS-seuranta)
const COOLDOWN_MIN = 10;        // no new run within 10 minutes of the last one
const MODELS_COOLDOWN_MIN = 30; // a full refresh at most every 30 minutes

function cfg(env) { return Object.assign({}, DEFAULTS, Object.fromEntries(Object.keys(DEFAULTS).filter(k => env[k]).map(k => [k, env[k]]))); }

async function gh(env, path, init) {
  const c = cfg(env);
  const res = await fetch(`https://api.github.com/repos/${c.REPO}${path}`, Object.assign({}, init, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gpt100-refresh-worker',
      'Content-Type': 'application/json'
    }
  }));
  return res;
}

async function latestRun(env) {
  const c = cfg(env);
  const res = await gh(env, `/actions/workflows/${c.WORKFLOW}/runs?per_page=1`);
  if (!res.ok) throw new Error('GitHub said ' + res.status);
  const r = (await res.json()).workflow_runs[0];
  return r ? { id: r.id, status: r.status, conclusion: r.conclusion, event: r.event, created: r.created_at, updated: r.updated_at } : null;
}

// Start the watch unless one is running or started recently.
async function maybeStart(env, models) {
  const c = cfg(env);
  const last = await latestRun(env);
  const ageMin = last ? (Date.now() - Date.parse(last.created)) / 60000 : 1e9;
  if (last && last.status !== 'completed') return { started: false, reason: 'running', last };
  if (ageMin < COOLDOWN_MIN) return { started: false, reason: 'recent', last, waitMin: Math.ceil(COOLDOWN_MIN - ageMin) };
  const full = !!models && ageMin >= MODELS_COOLDOWN_MIN;
  const res = await gh(env, `/actions/workflows/${c.WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: c.BRANCH, inputs: full ? { force_models: true } : {} })
  });
  if (res.status !== 204) throw new Error('GitHub said ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return { started: true, full, last };
}

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const c = cfg(env);
  const allowed = c.ALLOWED_ORIGIN.split(',').map(s => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-RC-Password',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json'
    }
  };
}

// ---------- Race Control incident log (D1 database) ----------
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, num INTEGER, data TEXT NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, incident TEXT, kind TEXT, text TEXT, who TEXT, updated INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS incidents_updated ON incidents (updated)',
  'CREATE INDEX IF NOT EXISTS units_updated ON units (updated)',
  'CREATE INDEX IF NOT EXISTS log_updated ON log (updated)',
  'CREATE TABLE IF NOT EXISTS ra (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ra_updated ON ra (updated)'
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(q => db.prepare(q)));
  schemaReady = true;
}
function sameText(a, b) { // compare without leaking the length of the match
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const clip = (v, n) => v == null ? v : typeof v === 'string' ? v.slice(0, n || 2000) : v;
function cleanPatch(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = cleanPatch(v);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = clip(v);
  }
  return out;
}
function merge(a, b) {
  const out = Object.assign({}, a);
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
}
async function raceControl(req, env, url, c) {
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: c.headers });
  if (!c.ok) return json({ error: 'Not allowed from this site' }, 403);
  if (!env.DB || !env.RC_PASSWORD) return json({ error: 'Race Control isn\'t set up on the Worker yet (needs the DB database and the RC_PASSWORD secret)' }, 503);
  if (!sameText(req.headers.get('X-RC-Password'), env.RC_PASSWORD)) return json({ error: 'Wrong password' }, 401);
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();
  if (url.pathname === '/rc/state' && req.method === 'GET') {
    const since = Math.max(0, +url.searchParams.get('since') || 0);
    const [inc, units, log] = await db.batch([
      db.prepare('SELECT id, num, data, updated, version FROM incidents WHERE updated > ?1 ORDER BY updated').bind(since),
      db.prepare('SELECT id, data, updated FROM units WHERE updated > ?1').bind(since),
      db.prepare('SELECT id, t, incident, kind, text, who FROM log WHERE updated > ?1 ORDER BY id DESC LIMIT 500').bind(since)
    ]);
    return json({
      now,
      incidents: inc.results.map(r => Object.assign(JSON.parse(r.data), { id: r.id, num: r.num, updated: r.updated, version: r.version })),
      units: units.results.map(r => Object.assign(JSON.parse(r.data), { id: r.id, updated: r.updated })),
      log: log.results
    });
  }
  if (url.pathname === '/rc/ra' && req.method === 'GET') {
    const since = Math.max(0, +url.searchParams.get('since') || 0);
    const r = await db.prepare('SELECT id, data, updated, version FROM ra WHERE updated > ?1 ORDER BY updated').bind(since).all();
    return json({ now, ra: r.results.map(x => Object.assign(JSON.parse(x.data), { id: x.id, updated: x.updated, version: x.version })) });
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const text = await req.text();
  if (text.length > 32000) return json({ error: 'Too big' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'Bad request' }, 400); }
  const who = clip(String(body.who || ''), 60);
  const addLog = (incident, kind, t) => db.prepare('INSERT INTO log (t, incident, kind, text, who, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(now, incident, kind, clip(String(t), 1000), who, now);
  if (url.pathname === '/rc/incident') {
    const patch = cleanPatch(body.patch);
    let id = typeof body.id === 'string' && /^[A-Za-z0-9-]{4,40}$/.test(body.id) ? body.id : null;
    const old = id ? await db.prepare('SELECT num, data, version FROM incidents WHERE id = ?1').bind(id).first() : null;
    let num, data, version;
    if (old) { num = old.num; data = merge(JSON.parse(old.data), patch); version = old.version + 1; }
    else {
      id = id || 'i' + now.toString(36) + Math.random().toString(36).slice(2, 6);
      num = ((await db.prepare('SELECT MAX(num) AS n FROM incidents').first()) || {}).n + 1 || 1;
      data = Object.assign({ created: now, status: 'open' }, patch); version = 1;
    }
    const ops = [db.prepare('INSERT INTO incidents (id, num, data, updated, version) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET data = ?3, updated = ?4, version = ?5').bind(id, num, JSON.stringify(data), now, version)];
    if (body.note) ops.push(addLog(id, 'incident', '#' + num + ' ' + body.note));
    await db.batch(ops);
    return json({ ok: true, incident: Object.assign(data, { id, num, updated: now, version }) });
  }
  if (url.pathname === '/rc/unit') {
    if (typeof body.id !== 'string' || !/^[A-Za-z0-9 _.:-]{1,60}$/.test(body.id)) return json({ error: 'Bad unit' }, 400);
    const old = await db.prepare('SELECT data FROM units WHERE id = ?1').bind(body.id).first();
    const data = merge(old ? JSON.parse(old.data) : {}, cleanPatch(body.patch));
    const ops = [db.prepare('INSERT INTO units (id, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?2, updated = ?3').bind(body.id, JSON.stringify(data), now)];
    if (body.note) ops.push(addLog(data.incident || null, 'unit', body.note));
    await db.batch(ops);
    return json({ ok: true, unit: Object.assign(data, { id: body.id, updated: now }) });
  }
  // Risk assessments (the race-morning dynamic risk assessment, RMP Appendix A). Signed off means locked:
  // after that only the actions (ticked off as they're done) and reviews can change.
  if (url.pathname === '/rc/ra') {
    if (typeof body.id !== 'string' || !/^[A-Za-z0-9-]{4,40}$/.test(body.id)) return json({ error: 'Bad assessment' }, 400);
    const patch = cleanPatch(body.patch);
    const old = await db.prepare('SELECT data, version FROM ra WHERE id = ?1').bind(body.id).first();
    const cur = old ? JSON.parse(old.data) : null;
    if (cur && cur.signed && cur.signed.at && Object.keys(patch).some(k => k !== 'actions' && k !== 'reviews')) return json({ error: 'That assessment is signed off', ra: Object.assign(cur, { id: body.id, version: old.version }) }, 409);
    const data = cur ? merge(cur, patch) : Object.assign({ created: now }, patch), version = old ? old.version + 1 : 1;
    const ops = [db.prepare('INSERT INTO ra (id, data, updated, version) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET data = ?2, updated = ?3, version = ?4').bind(body.id, JSON.stringify(data), now, version)];
    if (body.note) ops.push(addLog(null, 'risk', body.note));
    await db.batch(ops);
    return json({ ok: true, ra: Object.assign(data, { id: body.id, updated: now, version }) });
  }
  if (url.pathname === '/rc/log') {
    if (!body.text) return json({ error: 'Empty' }, 400);
    await addLog(typeof body.incident === 'string' ? body.incident.slice(0, 40) : null, 'note', body.text).run();
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Race archive (D1 database) ----------
// Copies of the timing list and the GPS files, kept so next year's predictions can be fitted to how this year's field
// ran. The feeds only hold the latest state (and the providers may take an event down after the race), so the Worker
// keeps its own copies. A copy the same as the last one isn't kept again. Each copy is stored gzipped, in pieces small
// enough for a D1 row. Names and GPS tracks stay here, behind the password, never in the public repository.
const ARCHIVE_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS archive (id INTEGER PRIMARY KEY AUTOINCREMENT, snap TEXT NOT NULL, t INTEGER NOT NULL, kind TEXT NOT NULL, event TEXT NOT NULL, part INTEGER NOT NULL, parts INTEGER NOT NULL, size INTEGER NOT NULL, sha TEXT NOT NULL, enc TEXT NOT NULL, body BLOB NOT NULL)',
  'CREATE INDEX IF NOT EXISTS archive_kind ON archive (kind, event, t)',
  'CREATE INDEX IF NOT EXISTS archive_snap ON archive (snap, part)'
];
const ARCHIVE_PART = 1500000;   // bytes per piece (D1 rows hold up to 2 MB)
const ARCHIVE_GPS_MIN = 60;     // minutes between copies of each GPS event's data.lst (it holds every fix so far)
// Each data.lst copy holds every fix before it, so older copies are thinned out to keep the database small (D1's free
// plan allows 500 MB a database, shared with Race Control): the 2 latest are kept, and the last one of every 12 hours.
const ARCHIVE_GPS_KEEP = 2, ARCHIVE_GPS_BLOCK = 12 * 3600e3;
let archiveReady = false;
async function ensureArchive(db) {
  if (archiveReady) return;
  await db.batch(ARCHIVE_SCHEMA.map(q => db.prepare(q)));
  archiveReady = true;
}
async function gzip(buf) {
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function sha256(buf) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Keep one copy (unless it's the same as the last one of its kind).
async function keepCopy(db, kind, event, buf, t) {
  const sha = await sha256(buf);
  const last = await db.prepare('SELECT sha FROM archive WHERE kind = ?1 AND event = ?2 AND part = 0 ORDER BY t DESC LIMIT 1').bind(kind, event).first();
  if (last && last.sha === sha) return { kind, event, same: true, size: buf.byteLength };
  const z = await gzip(buf), parts = Math.max(1, Math.ceil(z.length / ARCHIVE_PART)), snap = `${kind}:${event}:${t}`;
  const ops = [];
  for (let i = 0; i < parts; i++) {
    ops.push(db.prepare('INSERT INTO archive (snap, t, kind, event, part, parts, size, sha, enc, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
      .bind(snap, t, kind, event, i, parts, buf.byteLength, sha, 'gzip', z.slice(i * ARCHIVE_PART, (i + 1) * ARCHIVE_PART).buffer));
  }
  await db.batch(ops);
  return { kind, event, kept: snap, size: buf.byteLength, gz: z.length, parts };
}
// One round of copies: the timing list, then each GPS event's competitors and (once an hour) its positions.
// Outside the race window it does nothing, unless forced (POST /archive/now).
async function archiveRun(env, force) {
  if (!env.DB) return { error: 'The archive needs the DB database bound to the Worker' };
  const c = cfg(env), now = Date.now();
  const from = Date.parse(c.ARCHIVE_FROM), to = Date.parse(c.ARCHIVE_TO);
  if (!force && !(now >= from && now <= to)) return { skipped: 'outside the race window', from: c.ARCHIVE_FROM, to: c.ARCHIVE_TO };
  const db = env.DB;
  await ensureArchive(db);
  const out = [];
  let timingBuf = null;
  const grab = async (kind, event, url, ttl) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'GPT100Safety archive' }, cf: { cacheTtl: ttl, cacheEverything: true } });
      // An event set up but not started has no data.lst yet (403 or 404): nothing to keep.
      if (!res.ok) { out.push({ kind, event, status: res.status }); return; }
      const buf = await res.arrayBuffer();
      if (kind === 'timing') timingBuf = buf;
      out.push(await keepCopy(db, kind, event, buf, now));
    } catch (e) { out.push({ kind, event, error: e.message }); }
  };
  if (env.TIMING_URL) await grab('timing', '', env.TIMING_URL, 20);
  else out.push({ kind: 'timing', error: 'no TIMING_URL secret' });
  const events = await archiveEvents(c);
  for (const ev of events) {
    await grab('gps-init', ev, GPS_HOST + ev + '/init.txt', 60);
    const last = await db.prepare('SELECT MAX(t) AS t FROM archive WHERE kind = ?1 AND event = ?2').bind('gps-data', ev).first();
    // A couple of minutes' grace, so a cron run a little early still takes the hourly copy.
    if (force || !last || !last.t || now - last.t >= (ARCHIVE_GPS_MIN - 3) * 60e3) await grab('gps-data', ev, GPS_HOST + ev + '/data.lst', 15);
    await db.prepare(`DELETE FROM archive WHERE kind = 'gps-data' AND event = ?1
      AND t NOT IN (SELECT t FROM archive WHERE kind = 'gps-data' AND event = ?1 AND part = 0 ORDER BY t DESC LIMIT ?2)
      AND t NOT IN (SELECT MAX(t) FROM archive WHERE kind = 'gps-data' AND event = ?1 GROUP BY CAST(t / ?3 AS INTEGER))`).bind(ev, ARCHIVE_GPS_KEEP, ARCHIVE_GPS_BLOCK).run();
  }
  let health = [];
  try { health = await feedHealth(env, db, now, events, timingBuf); await alertHealth(env, db, health); } catch (e) { health = [{ key: 'error', level: 'warn', text: 'Feed health check failed: ' + e.message }]; }
  return { at: new Date(now).toISOString(), events, copies: out, health };
}
// The GPS events to keep: ARCHIVE_GPS, plus every event in the app's published config (tracking.gps).
async function archiveEvents(c) {
  const ids = new Set(String(c.ARCHIVE_GPS || '').split(',').map(x => x.trim()));
  try {
    const res = await fetch(c.SITE_CONFIG, { headers: { 'User-Agent': 'GPT100Safety archive' }, cf: { cacheTtl: 300, cacheEverything: true } });
    const m = res.ok && (await res.text()).match(/\bgps:\s*\[([^\]]*)\]/);
    if (m) for (const q of m[1].match(/['"][A-Za-z0-9_-]{1,80}['"]/g) || []) ids.add(q.slice(1, -1));
  } catch (e) { }
  return [...ids].filter(x => /^[A-Za-z0-9_-]{1,80}$/.test(x));
}

// ---------- Feed health (during the race window, on the archive's timer) ----------
// The problems GPT100 2026 had, found by people late or not at all: a GPS event that stopped sending part way through
// (81 min), a timing reader that never read anyone (Copper Mine Track, the whole race), and so on. The app's own Feed
// health panel checks more (chip times ahead of the clock, a race with no chip times); this one reaches the phone.
const TIMING_META = /^(place|rank|pos|position|overall|status|state|bib|bibno|no|number|startno|startnumber|name|fullname|firstname|lastname|surname|contest|contestname|race|racename|event|eventname|distance|category|course|gender|sex|age|agegroup|club|team|nation|country|time|nettime|chiptime|guntime|racetime|elapsed|diff|difference|gap|behind|id|pid)$/;
function timingRows(j) {
  let rows = Array.isArray(j) ? j : [], labels = null;
  if (!Array.isArray(j) && j && typeof j === 'object') {
    const d = j.data != null ? j.data : j.rows != null ? j.rows : Array.isArray(j.list) ? j.list : null;
    if (Array.isArray(d)) rows = d; else if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) rows = rows.concat(v);
    const F = j.list && Array.isArray(j.list.Fields) ? j.list.Fields : null;
    if (F) labels = F.map(f => typeof f === 'string' ? f : (f.Label || f.Expression || ''));
  }
  if (rows.length && Array.isArray(rows[0]) && labels) rows = rows.map(r => Object.fromEntries(labels.map((l, i) => [l, r[i]])));
  return rows.filter(r => r && typeof r === 'object' && !Array.isArray(r));
}
async function feedHealth(env, db, now, events, timingBuf) {
  const issues = [], mins = ms => Math.round(ms / 60e3);
  const lastTiming = ((await db.prepare("SELECT MAX(t) AS t FROM archive WHERE kind = 'timing'").first()) || {}).t || 0;
  const raceOn = lastTiming && now - lastTiming < 60 * 60e3;  // the timing list changed in the last hour
  const gpsAge = {};
  for (const ev of events) {
    try {
      const res = await fetch(GPS_HOST + ev + '/data.lst', { method: 'HEAD', headers: { 'User-Agent': 'GPT100Safety health' } });
      const lm = res.ok ? Date.parse(res.headers.get('Last-Modified') || '') : NaN;
      if (lm) gpsAge[ev] = now - lm;
    } catch (e) { }
  }
  if (raceOn) for (const [ev, age] of Object.entries(gpsAge)) if (age > 20 * 60e3 && age < 12 * 3600e3)
    issues.push({ key: 'gps-quiet:' + ev, level: 'bad', text: `GPS event ${ev}: no new positions for ${mins(age)} min while the race is on. It may have stopped: check the provider for another event the trackers send to, and add it to tracking.gps.` });
  if (env.TIMING_URL && lastTiming && !raceOn && now - lastTiming < 12 * 3600e3 && Object.values(gpsAge).some(a => a < 10 * 60e3))
    issues.push({ key: 'timing-still', level: 'warn', text: `Timing list: no change for ${mins(now - lastTiming)} min while trackers are still sending. Is the timing feed stuck?` });
  if (timingBuf) {
    try {
      const rows = timingRows(JSON.parse(new TextDecoder().decode(timingBuf))), cols = [], n = {};
      for (const r of rows) for (const [k, v] of Object.entries(r)) {
        if (!(k in n)) { n[k] = 0; cols.push(k); }
        const sv = String(v == null ? '' : v).trim();
        if (/\d:\d\d/.test(sv) && !/^[0:.]+$/.test(sv)) n[k]++;
      }
      const pts = cols.filter(k => !TIMING_META.test(k.toLowerCase().replace(/[^a-z]/g, '')));
      pts.forEach((k, i) => {
        const further = Math.max(0, ...pts.slice(i + 1).map(x => n[x]));
        if (!n[k] && further >= 10) issues.push({ key: 'no-reads:' + k, level: 'warn', text: `Timing list: no reads at ${k}, though ${further} runners have been read further on. Is that reader up?` });
      });
    } catch (e) { }
  }
  return issues;
}
async function alertHealth(env, db, issues) {
  await db.prepare('CREATE TABLE IF NOT EXISTS health (key TEXT PRIMARY KEY, level TEXT NOT NULL, text TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL)').run();
  const now = Date.now(), prev = (await db.prepare('SELECT key, text FROM health').all()).results;
  const fresh = issues.filter(i => !prev.some(p => p.key === i.key)), gone = prev.filter(p => !issues.some(i => i.key === p.key));
  const ops = issues.map(i => db.prepare('INSERT INTO health (key, level, text, first, last) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(key) DO UPDATE SET level = ?2, text = ?3, last = ?4').bind(i.key, i.level, i.text, now));
  for (const g of gone) ops.push(db.prepare('DELETE FROM health WHERE key = ?1').bind(g.key));
  if (ops.length) await db.batch(ops);
  if (!env.NTFY_TOPIC) return;
  const send = (title, body, priority, tags) => fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), { method: 'POST', body,
    headers: { Title: title, Priority: String(priority), Tags: tags, Click: 'https://singletrackevents.github.io/GPT100Safety/' } }).catch(() => { });
  for (const i of fresh) await send(i.level === 'bad' ? 'GPT100 feed problem' : 'GPT100 feed warning', i.text, i.level === 'bad' ? 4 : 3, 'satellite');
  for (const g of gone) await send('GPT100 feed problem cleared', 'Cleared: ' + g.text, 2, 'white_check_mark');
}
// The archive endpoints. They're behind the medical password (RC_PASSWORD) but, unlike Race Control, don't need the
// app's site: tools/archive_race.mjs calls them from a computer.
async function archiveApi(req, env, url, c) {
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: c.headers });
  if (!env.DB || !env.RC_PASSWORD) return json({ error: 'The archive isn\'t set up on the Worker yet (needs the DB database and the RC_PASSWORD secret)' }, 503);
  if (!sameText(req.headers.get('X-RC-Password'), env.RC_PASSWORD)) return json({ error: 'Wrong password' }, 401);
  const db = env.DB;
  await ensureArchive(db);
  if (url.pathname === '/archive/list' && req.method === 'GET') {
    const r = await db.prepare('SELECT snap, t, kind, event, parts, size, sha FROM archive WHERE part = 0 ORDER BY t, kind, event').all();
    const tot = await db.prepare('SELECT COUNT(*) AS n, SUM(LENGTH(body)) AS bytes FROM archive').first();
    const c2 = cfg(env);
    return json({ now: Date.now(), window: { from: c2.ARCHIVE_FROM, to: c2.ARCHIVE_TO }, gps: (await archiveEvents(c2)).join(','), stored: tot, copies: r.results });
  }
  if (url.pathname === '/archive/part' && req.method === 'GET') {
    const row = await db.prepare('SELECT body FROM archive WHERE snap = ?1 AND part = ?2').bind(String(url.searchParams.get('snap') || ''), +url.searchParams.get('part') || 0).first();
    if (!row) return json({ error: 'No such copy' }, 404);
    return new Response(new Uint8Array(row.body), { headers: Object.assign({}, c.headers, { 'Content-Type': 'application/gzip' }) });
  }
  if (url.pathname === '/archive/now' && req.method === 'POST') return json(await archiveRun(env, true));
  return json({ error: 'Not found' }, 404);
}

// Relay the tracking provider's plain text files. The provider only lets its own viewer read them from a browser,
// so the app reads them through here. Cached briefly on the edge so a room full of phones is one request upstream.
async function gpsRelay(req, env, url, c) {
  const m = url.pathname.match(/^\/gps\/(?:([A-Za-z0-9_-]{1,80})\/)?(init\.txt|data\.lst|data\.php|time\.php)$/);
  if (!m || (!m[1] && m[2] !== 'time.php')) return new Response('Not found', { status: 404, headers: c.headers });
  if (!c.ok) return new Response('Not allowed from this site', { status: 403, headers: c.headers });
  const qs = new URLSearchParams();
  for (const k of ['offset', 'reset', 'data', 'a']) if (url.searchParams.has(k)) qs.set(k, url.searchParams.get(k).slice(0, 80));
  const upstream = GPS_HOST + (m[1] ? m[1] + '/' : '') + m[2] + (qs.toString() ? '?' + qs : '');
  const ttl = m[2] === 'init.txt' ? 60 : m[2] === 'data.lst' ? 15 : 5;
  const res = await fetch(upstream, { headers: { 'User-Agent': 'GPT100Safety relay' }, cf: { cacheTtl: ttl, cacheEverything: true } });
  const headers = Object.assign({}, c.headers, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=' + ttl,
    'Access-Control-Expose-Headers': 'X-GPS-Server-Filesize, X-GPS-Server-Reset'
  });
  for (const h of ['X-GPS-Server-Filesize', 'X-GPS-Server-Reset']) if (res.headers.get(h)) headers[h] = res.headers.get(h);
  return new Response(res.body, { status: res.status, headers });
}

// Relay the timing team's RaceResult list. The Simple API link is a secret here, so it's never in the app or on a
// phone, and the edge cache keeps a room full of phones to one request upstream every 20 seconds
// (RaceResult allows one call a second per link and caches its answer for 10 to 30 seconds anyway).
async function timingRelay(req, env, url, c) {
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: c.headers });
  if (!c.ok) return json({ error: 'Not allowed from this site' }, 403);
  if (!env.TIMING_URL) return json({ error: 'Timing isn\'t set up on the Worker yet (needs the TIMING_URL secret)' }, 503);
  const res = await fetch(env.TIMING_URL, { headers: { 'User-Agent': 'GPT100Safety relay' }, cf: { cacheTtl: 20, cacheEverything: true } });
  if (!res.ok) return json({ error: 'The timing feed said ' + res.status }, 502);
  return new Response(res.body, { status: 200, headers: Object.assign({}, c.headers, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=20' }) });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (url.pathname.startsWith('/gps/') && req.method === 'GET') {
      try { return await gpsRelay(req, env, url, c); } catch (e) { return new Response('Tracking provider unreachable: ' + e.message, { status: 502, headers: c.headers }); }
    }
    if ((url.pathname === '/timing/' || url.pathname === '/timing') && req.method === 'GET') {
      try { return await timingRelay(req, env, url, c); } catch (e) { return new Response(JSON.stringify({ error: 'Timing feed unreachable: ' + e.message }), { status: 502, headers: c.headers }); }
    }
    if (url.pathname.startsWith('/archive/')) {
      try { return await archiveApi(req, env, url, c); } catch (e) { return new Response(JSON.stringify({ error: 'Archive: ' + e.message }), { status: 502, headers: c.headers }); }
    }
    if (!env.GITHUB_TOKEN) return new Response(JSON.stringify({ error: 'The GITHUB_TOKEN secret is not set' }), { status: 500, headers: c.headers });
    try {
      if (url.pathname.startsWith('/rc/')) return await raceControl(req, env, url, c);
      if (url.pathname === '/status' && req.method === 'GET') {
        return new Response(JSON.stringify({ last: await latestRun(env) }), { headers: c.headers });
      }
      if (url.pathname === '/refresh' && req.method === 'POST') {
        // Only the GPT100 Safety site (or local testing) may ask for a refresh.
        if (!c.ok) return new Response(JSON.stringify({ error: 'Not allowed from this site' }), { status: 403, headers: c.headers });
        return new Response(JSON.stringify(await maybeStart(env, url.searchParams.get('models') === '1')), { headers: c.headers });
      }
      return new Response(JSON.stringify({ ok: true, about: 'GPT100 weather refresh relay' }), { headers: c.headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: c.headers });
    }
  },
  // Cron trigger (every 15 minutes): keep the weather fresh even when nobody presses the button, and during the race
  // keep copies of the timing and GPS feeds (the race archive).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(maybeStart(env, false).catch(e => console.log('refresh failed: ' + e.message)));
    ctx.waitUntil(archiveRun(env, false).then(r => console.log('archive: ' + JSON.stringify(r))).catch(e => console.log('archive failed: ' + e.message)));
  }
};
