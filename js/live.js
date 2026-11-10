// The apps' line to Race Control, through the Worker (tools/LIVE.md). Loaded first by every app, so it's there
// before anything else can go wrong:
//   fault reports   an error in the app's own code goes to the Worker: the app, its build, the message, file and line.
//                   Nothing about the person: no bib, name, position or link. Race Control sees them under Feed health.
//   notices         what Race Control posts shows as a banner under the header, and stays with no signal
//   help requests   GPTLive.help: send one (kept on the phone until there's signal) and follow whether it's been answered
//   field phones    GPTLive.field: share this phone's position with the board's map, with the team code
//   alerts          GPTLive.push: a notification when a followed runner reaches a checkpoint, and for notices
//   screen on       GPTLive.awake: keep the screen awake while the map is in use
// A copy opened on a computer (localhost) talks to no Worker unless ?api=http://127.0.0.1:8787 points it at a local one.
(function () {
  const PAGE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const APP = /^runner/.test(PAGE) ? 'runner' : /^field/.test(PAGE) ? 'field' : /^map/.test(PAGE) ? 'map' : 'staff';
  const BUILD = ((document.currentScript && document.currentScript.src || '').match(/\?v=(\d+)/) || [])[1] || '';
  const local = u => { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(u, location.href).hostname); } catch (e) { return false; } };
  let Q; try { Q = new URLSearchParams(location.search); } catch (e) { Q = { get: () => null }; }
  function base() {
    const q = Q.get('api');
    if (q && local(q)) return q.replace(/\/$/, '');
    if (window.GPTDemo && window.GPTDemo.rcBase) return window.GPTDemo.rcBase;
    if (local(location.href)) return '';
    const C = window.GPT100_CONFIG;
    return ((C && C.weather && C.weather.refreshUrl) || '').replace(/\/$/, '');
  }
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null || typeof v !== typeof d || Array.isArray(v) !== Array.isArray(d) ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tf = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const rid = () => { const a = new Uint8Array(15); (window.crypto || window.msCrypto).getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join('') + Date.now().toString(36); };
  async function call(path, body, ms) {
    const b = base(); if (!b) throw new Error('no line');
    const ac = window.AbortController ? new AbortController() : null, t = ac && setTimeout(() => ac.abort(), ms || 15000);
    try {
      const r = await fetch(b + path, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: ac ? ac.signal : undefined, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, j };
    } finally { clearTimeout(t); }
  }
  const subs = [];
  const tell = () => subs.forEach(fn => { try { fn(); } catch (e) { } });

  // ---------- fault reports ----------
  // Only errors from the app's own files (not a browser add-on's), each kind once a visit, five at most.
  const told = new Set();
  function fault(msg, src, line, col, stack) {
    try {
      msg = String(msg || '').slice(0, 300); src = String(src || '');
      const ours = (src && src.indexOf(location.origin) === 0) || (!src && stack && String(stack).indexOf(location.origin) >= 0);
      if (!msg || !ours || /^Script error/.test(msg) || /ResizeObserver loop/.test(msg)) return;
      const sig = msg + '|' + src + '|' + line;
      if (told.has(sig) || told.size >= 5 || !base()) return;
      told.add(sig);
      fetch(base() + '/fault', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: APP, build: BUILD, msg, src, line: line || 0, col: col || 0, stack: String(stack || '').slice(0, 900), ua: navigator.userAgent.slice(0, 160), page: PAGE }) }).catch(() => { });
    } catch (e) { }
  }
  addEventListener('error', e => { if (e && e.message) fault(e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack); });
  addEventListener('unhandledrejection', e => {
    const r = e && e.reason; if (!r || !(r instanceof Error) || /abort|Failed to fetch|NetworkError|Load failed|no line/i.test(r.name + ' ' + r.message)) return;
    const m = String(r.stack || '').match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/) || [];
    fault(r.name + ': ' + r.message, m[1] || '', +m[2] || 0, +m[3] || 0, r.stack);
  });

  // ---------- what Race Control is saying: /live, once a minute while the app is on screen ----------
  const LK = 'gptLive';
  let S = load(LK, { t: 0, notices: [], help: { open: false }, field: { on: false }, push: { key: '' } }), busy = false;
  async function refresh() {
    if (busy || !base()) return S;
    busy = true;
    try {
      const r = await call('/live', null, 12000);
      if (r.ok && Array.isArray(r.j.notices)) { S = { t: Date.now(), notices: r.j.notices, help: r.j.help || { open: false }, field: r.j.field || { on: false }, push: r.j.push || { key: '' } }; save(LK, S); }
    } catch (e) { }
    busy = false;
    drawNotices(); tell();
    return S;
  }
  const fresh = ms => Date.now() - S.t < ms;

  // ---------- notices ----------
  // A banner under the header in every app. Race Control's important ones are red and fold to a thin bar when hidden;
  // the rest can be put away for good. The last ones fetched stay on the phone, so they still show with no signal.
  const HIDE = 'gptLiveHide';
  let host = null, showAll = false;
  const mine = n => n && typeof n.text === 'string' && (APP === 'runner' ? n.aud !== 'field' : APP === 'field' ? n.aud !== 'runner' : true) && (!n.until || n.until > Date.now());
  function drawNotices() {
    const top = document.querySelector('header.top');
    if (!top) return;
    if (!host) { host = document.createElement('div'); host.id = 'gptNotices'; host.className = 'lv-notices'; host.setAttribute('role', 'status'); top.after(host); host.addEventListener('click', onNoticeClick); }
    const hidden = load(HIDE, []), list = (S.notices || []).filter(mine), shown = list.filter(n => showAll || !hidden.includes(n.id));
    const folded = list.filter(n => !showAll && hidden.includes(n.id) && n.level === 'alert').length;
    const to = n => APP === 'staff' || APP === 'map' ? (n.aud === 'runner' ? ' · to runners and crews' : n.aud === 'field' ? ' · to the field app' : ' · to every phone') : '';
    host.innerHTML = shown.map(n => `<div class="lv-n${n.level === 'alert' ? ' lv-alert' : ''}" data-id="${esc(n.id)}"><p><b>Race Control, ${tf.format(n.t)}${to(n)}${fresh(10 * 60e3) ? '' : ' (saved)'}</b>${esc(n.text)}</p><button type="button" class="lv-n-x" data-hide="${esc(n.id)}">Hide</button></div>`).join('') +
      (folded ? `<button type="button" class="lv-n-more" data-show="1">${folded} important notice${folded > 1 ? 's' : ''} from Race Control · Show</button>` : '');
    host.hidden = !host.innerHTML;
    // The map tabs size themselves to the screen: they give this much of it up.
    document.documentElement.style.setProperty('--lv-h', (host.hidden ? 0 : host.offsetHeight) + 'px');
  }
  function onNoticeClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.show) showAll = true;
    else if (b.dataset.hide) { showAll = false; save(HIDE, load(HIDE, []).filter(x => (S.notices || []).some(n => n.id === x)).concat(b.dataset.hide).slice(-40)); }
    drawNotices(); window.dispatchEvent(new Event('resize'));
  }

  // ---------- help requests ----------
  // One at a time. It stays on the phone until it's sent (no signal: tried again every 15 seconds and when signal
  // returns), then the phone asks every 20 seconds whether Race Control has answered. The screens that offer it say
  // what to do meanwhile: Call 000 always comes first.
  const HK = 'gptHelpReq';
  let helpT = null;
  const help = {
    open: () => !!(S.help && S.help.open && fresh(5 * 60e3) && base()),
    current: () => { const r = load(HK, {}); return r.id && Date.now() - r.t < 12 * 3600e3 ? r : null; },
    send(body) { const r = { id: rid(), body: Object.assign({ app: APP === 'field' ? 'field' : 'runner' }, body), t: Date.now(), state: 'queued', tries: 0 }; save(HK, r); pump(); tell(); return r; },
    clear() { save(HK, null); clearTimeout(helpT); tell(); }
  };
  async function pump() {
    clearTimeout(helpT);
    const r = help.current(); if (!r || !base()) return;
    let again = 0;
    try {
      if (r.state === 'queued') {
        r.tries++;
        const x = await call('/help', Object.assign({ id: r.id }, r.body), 20000);
        if (x.ok) { r.state = 'sent'; r.num = x.j.num; r.sentAt = Date.now(); again = 8000; }
        else if (x.status === 409) { r.state = 'refused'; r.why = 'closed'; }
        else if (x.status === 429 || x.status === 400 || x.status === 413 || x.status === 403) { r.state = 'refused'; r.why = x.status === 429 ? 'busy' : 'bad'; }
        else again = 15000;
      } else if (r.state === 'sent' || r.state === 'ack') {
        const x = await call('/help?id=' + r.id, null, 12000);
        if (x.ok && x.j.found) { if (x.j.ack) { r.state = 'ack'; r.ack = x.j.ack; } r.sent = x.j.sent || null; r.onScene = x.j.onScene || null; r.closed = !!x.j.closed; }
        again = r.closed ? 0 : 20000;
      }
    } catch (e) { again = r.state === 'queued' ? 15000 : 30000; }
    const cur = help.current();
    if (cur && cur.id === r.id) { save(HK, r); tell(); if (again) helpT = setTimeout(pump, again); }
  }

  // ---------- field phones on the board's map ----------
  const FK = 'gptFieldShare';
  let lastShare = 0, shareMsg = '';
  const field = {
    cfg: () => Object.assign({ on: false, name: '', code: '', id: '' }, load(FK, {})),
    set(p) { const c = Object.assign(field.cfg(), p); if (!c.id) c.id = rid(); save(FK, c); tell(); return c; },
    status: () => shareMsg,
    available: () => !!(base() && S.field && S.field.on),
    async check(code) { try { const x = await call('/field/check', { code }); return x.ok ? '' : x.j.error || 'That team code isn\'t right'; } catch (e) { return 'No signal: the code will be checked when there is.'; } },
    // fix: { lat, lon, acc, t, km, course, offM }. At most one every 30 seconds.
    async share(fix) {
      const c = field.cfg();
      if (!c.on || !c.name || !c.code || !fix || !base() || Date.now() - lastShare < 30000) return;
      lastShare = Date.now();
      try {
        const x = await call('/field/pos', Object.assign({ code: c.code, id: c.id, name: c.name }, fix));
        shareMsg = x.ok ? 'Race Control has your position, ' + tf.format(Date.now()) + '.' : x.status === 401 ? 'The team code isn\'t right: check it with Race Control.' : x.status === 409 ? 'Race Control hasn\'t turned on position sharing.' : 'Couldn\'t send your position. It will try again.';
      } catch (e) { shareMsg = 'No signal: your position will send when there is.'; lastShare = Date.now() - 20000; }
      tell();
    }
  };

  // ---------- alerts (Web Push) ----------
  const PK = 'gptPush';
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const keyBytes = k => { const s = atob(String(k).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  const push = {
    // 'unsupported', 'install' (iPhone: only from the home screen app), 'blocked', 'off' or 'on'
    async state() {
      if (!base()) return 'unsupported';
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return ios && !standalone() ? 'install' : 'unsupported';
      if (Notification.permission === 'denied') return 'blocked';
      try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub && load(PK, {}).on ? 'on' : 'off'; } catch (e) { return 'off'; }
    },
    async enable(bibs) {
      if (!S.push || !S.push.key) await refresh();
      if (!S.push || !S.push.key) throw new Error('Alerts aren\'t set up yet. Try again with signal.');
      if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the phone\'s settings.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(S.push.key) });
      // The service worker asks the Worker what's new when a push wakes it: it reads the address from here.
      try { await (await caches.open('gpt100-live')).put('/__live-base', new Response(base())); } catch (e) { }
      const x = await call('/push/sub', { endpoint: sub.endpoint, app: APP === 'field' ? 'field' : 'runner', bibs: bibs || [], notices: true });
      if (!x.ok) throw new Error(x.j.error || 'Couldn\'t turn alerts on. Try again.');
      save(PK, { on: true, bibs: x.j.bibs || [] }); tell();
    },
    async setBibs(bibs) {
      const p = load(PK, {}); if (!p.on || (p.bibs || []).join() === (bibs || []).join()) return;
      try { const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription(); if (!sub) return;
        const x = await call('/push/sub', { endpoint: sub.endpoint, app: APP === 'field' ? 'field' : 'runner', bibs, notices: true }); if (x.ok) save(PK, { on: true, bibs: x.j.bibs || [] }); } catch (e) { }
    },
    async disable() {
      try { const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription(); if (sub) { await call('/push/unsub', { endpoint: sub.endpoint }).catch(() => { }); await sub.unsubscribe(); } } catch (e) { }
      save(PK, null); tell();
    }
  };

  // ---------- keep the screen on ----------
  // While it's wanted and the app is on screen. The phone lets go of it when the app is put away; it's taken again on return.
  const AK = 'gptAwake.' + APP;
  let lock = null, want = load(AK, false) === true;
  const awake = {
    supported: 'wakeLock' in navigator,
    on: () => want,
    async set(v) { want = !!v; save(AK, want); await hold(); tell(); }
  };
  async function hold() {
    try {
      if (want && !lock && awake.supported && !document.hidden) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      else if (!want && lock) { const l = lock; lock = null; await l.release(); }
    } catch (e) { lock = null; }
  }

  // ---------- start ----------
  let poll = null;
  function start() {
    drawNotices();
    setTimeout(refresh, 1200);
    poll = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (!fresh(45000)) refresh(); hold(); pump(); } });
    addEventListener('online', () => { refresh(); pump(); });
    addEventListener('resize', () => { if (host && !host.hidden) document.documentElement.style.setProperty('--lv-h', host.offsetHeight + 'px'); });
    hold(); pump();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.GPTLive = { app: APP, build: BUILD, base, state: () => S, fresh, refresh, onChange: fn => { subs.push(fn); }, help, field, push, awake, tf, fault };
})();
