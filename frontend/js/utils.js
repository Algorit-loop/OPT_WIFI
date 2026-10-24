/* Shared helpers: formatting, settings, event bus, toasts, small UI effects */
(function () {
  const NP = window.NP;

  /* ---------- Settings: owned by the agent (data/settings.json); nothing is kept in the browser ---------- */
  const DEFAULTS = {
    refreshMs: 1000,
    unit: 'bits',            // 'bits' → Mbps, 'bytes' → MB/s
    theme: 'dark',
    accent: 'cyan',
    pingTarget: '1.1.1.1',
    pingWarn: 80,
    pingCrit: 150,
    lossWarn: 1,
    signalWarn: 50,
    monthlyCapGB: 0,         // 0 = không giới hạn
    planDownMbps: 0,         // gói cước ISP (tốc độ cam kết), 0 = chưa đặt
    planUpMbps: 0,
    publicIpLookup: true,
    retentionDays: 90,
    notify: true,
    autoSpeedtest: 'off',    // off | 6h | daily
    animations: true,
    lang: NP.lang,           // 'vi' | 'en' — see i18n.js
  };
  NP.settings = { ...DEFAULTS };
  let pending = {}, saveTimer;
  NP.saveSettings = (patch) => {
    Object.assign(NP.settings, patch);
    NP.bus.emit('settings', NP.settings);
    Object.assign(pending, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const p = pending; pending = {};
      NP.api.saveSettings(p).catch((e) => NP.toast(NP.t('Không lưu được cài đặt: ') + NP.esc(e.message), 'crit'));
    }, 300);
  };
  /** Pull the agent's settings (source of truth) into the page. */
  NP.loadSettings = async () => {
    try {
      Object.assign(NP.settings, await NP.api.getSettings());
    } catch { /* offline: defaults */ }
  };
  NP.resetSettings = async () => {
    NP.settings = { ...DEFAULTS };
    try { Object.assign(NP.settings, (await NP.api.resetSettings()) || {}); } catch {}
    NP.bus.emit('settings', NP.settings);
  };

  /* ---------- Event bus ---------- */
  const handlers = {};
  NP.bus = {
    on(ev, fn) { (handlers[ev] ||= new Set()).add(fn); return () => handlers[ev].delete(fn); },
    emit(ev, data) { handlers[ev]?.forEach((fn) => fn(data)); },
  };

  /* ---------- Formatting ---------- */
  // Rates arrive in bits per second from the API.
  NP.fmtRate = (bps, opts = {}) => {
    if (bps == null || !Number.isFinite(Number(bps))) return { value: '—', unit: '', text: '—' };
    const unit = opts.unit || NP.settings.unit;
    let v = unit === 'bytes' ? Number(bps) / 8 : Number(bps);
    const units = unit === 'bytes' ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['bps', 'Kbps', 'Mbps', 'Gbps'];
    let i = 0;
    if (opts.fixed) { i = units.indexOf(opts.fixed); v = v / Math.pow(1000, i); }
    else while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
    const digits = opts.digits ?? (v >= 100 ? 0 : v >= 10 ? 1 : 2);
    return { value: v.toFixed(digits), unit: units[i], text: `${v.toFixed(digits)} ${units[i]}` };
  };
  NP.rateUnitLabel = () => (NP.settings.unit === 'bytes' ? 'MB/s' : 'Mbps');
  NP.toDisplayRate = (bps) => (NP.settings.unit === 'bytes' ? bps / 8 / 1e6 : bps / 1e6);

  NP.fmtBytes = (bytes, digits) => {
    if (bytes == null || !Number.isFinite(Number(bytes))) return { value: '—', unit: '', text: '—' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Number(bytes), i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    const d = digits ?? (v >= 100 ? 0 : v >= 10 ? 1 : 2);
    return { value: v.toFixed(d), unit: units[i], text: `${v.toFixed(d)} ${units[i]}` };
  };

  NP.pad = (n) => String(n).padStart(2, '0');
  NP.fmtTime = (ts, sec = true) => {
    const d = new Date(ts);
    return `${NP.pad(d.getHours())}:${NP.pad(d.getMinutes())}${sec ? ':' + NP.pad(d.getSeconds()) : ''}`;
  };
  NP.fmtDateTime = (ts) => {
    const d = new Date(ts);
    return `${NP.pad(d.getDate())}/${NP.pad(d.getMonth() + 1)} ${NP.fmtTime(ts)}`;
  };
  NP.fmtDuration = (sec) => {
    sec = Math.floor(sec);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    return `${NP.pad(h)}:${NP.pad(m)}:${NP.pad(s)}`;
  };
  NP.timeAgo = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return NP.t('{n}s trước', { n: s });
    if (s < 3600) return NP.t('{n} phút trước', { n: Math.floor(s / 60) });
    if (s < 86400) return NP.t('{n} giờ trước', { n: Math.floor(s / 3600) });
    return NP.t('{n} ngày trước', { n: Math.floor(s / 86400) });
  };
  NP.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Null-safe display ---------- */
  NP.num = (v, digits = 0, suffix = '') => (v == null || Number.isNaN(v) ? '—' : `${Number(v).toFixed(digits)}${suffix}`);

  /**
   * The "maximum" a connection can do, best source first:
   * measured speed test → ISP plan (settings) → Wi-Fi/Ethernet link rate.
   */
  NP.capacityBasis = (capacity, wifi, network) => {
    if (capacity && capacity.down) return { down: capacity.down, up: capacity.up, source: 'speedtest', label: NP.t('Internet đo được') };
    const S = NP.settings;
    if (S.planDownMbps) return { down: S.planDownMbps * 1e6, up: (S.planUpMbps || S.planDownMbps) * 1e6, source: 'plan', label: NP.t('Gói cước') };
    if (wifi && wifi.connected && wifi.rxRate) return { down: wifi.rxRate * 1e6, up: (wifi.txRate || wifi.rxRate) * 1e6, source: 'link', label: NP.t('Tốc độ liên kết Wi-Fi') };
    if (network && network.linkSpeed) return { down: network.linkSpeed, up: network.linkSpeed, source: 'link', label: NP.t('Tốc độ liên kết') };
    return null;
  };

  NP.lcFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  NP.emptyHTML = (icon, text) => `<div class="empty">${NP.icon(icon)}${text}</div>`;

  /* ---------- Quality classification (shared thresholds) ---------- */
  NP.pingTone = (ms) => (ms == null ? 'crit' : ms >= NP.settings.pingCrit ? 'crit' : ms >= NP.settings.pingWarn ? 'warn' : 'good');
  NP.signalTone = (pct) => (pct == null ? 'crit' : pct >= 70 ? 'good' : pct >= NP.settings.signalWarn ? 'warn' : 'crit');
  NP.signalBars = (pct) => (pct >= 80 ? 4 : pct >= 60 ? 3 : pct >= 40 ? 2 : pct > 0 ? 1 : 0);
  NP.signalHTML = (pct, cls = '') => {
    const n = NP.signalBars(pct), tone = NP.signalTone(pct);
    return `<span class="signal ${tone === 'good' ? '' : tone} ${cls}">${[1, 2, 3, 4].map((i) => `<span class="${i <= n ? 'on' : ''}"></span>`).join('')}</span>`;
  };
  NP.toneLabel = {
    get good() { return NP.t('Tốt'); },
    get warn() { return NP.t('Trung bình'); },
    get crit() { return NP.t('Kém'); },
  };

  /* ---------- CSS token reader (charts follow the theme) ---------- */
  NP.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  NP.alpha = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  /* ---------- Toasts ---------- */
  NP.toast = (msg, tone = 'info', ms = 3200) => {
    const box = document.getElementById('toasts');
    const icon = { good: 'checkCircle', warn: 'alert', crit: 'xCircle', info: 'info' }[tone];
    const color = { good: 'var(--good)', warn: 'var(--warn)', crit: 'var(--crit)', info: 'var(--accent)' }[tone];
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.innerHTML = `<span style="color:${color}">${NP.icon(icon)}</span><span>${msg}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, ms);
  };

  /* ---------- Count-up number animation ---------- */
  NP.countUp = (el, to, { digits = 0, duration = 900 } = {}) => {
    if (!el) return;
    const from = parseFloat(el.dataset.v || '0') || 0;
    el.dataset.v = to;
    if (!NP.settings.animations) { el.textContent = Number(to).toFixed(digits); return; }
    cancelAnimationFrame(el._raf);
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0) / duration));
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = (from + (to - from) * e).toFixed(digits);
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  };

  /* ---------- Card spotlight follows the cursor ---------- */
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

  /* ---------- Copy to clipboard (delegated) ---------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-copy]');
    if (!btn) return;
    navigator.clipboard?.writeText(btn.dataset.copy).then(
      () => NP.toast(`${NP.t('Đã sao chép:')} <b class="mono">${NP.esc(btn.dataset.copy)}</b>`, 'good', 1800),
      () => NP.toast(NP.t('Không sao chép được'), 'crit')
    );
  });

  /* ---------- Small builders ---------- */
  NP.spec = (k, v, { icon, copy } = {}) =>
    `<div class="spec"><span class="k">${icon ? NP.icon(icon) : ''}${k}</span><span class="v">${v ?? '—'}${copy ? `<span class="copy" data-copy="${NP.esc(copy)}" title="${NP.t('Sao chép')}">${NP.icon('copy')}</span>` : ''}</span></div>`;

  NP.cardHead = (title, { icon, sub, right = '' } = {}) =>
    `<div class="card-head">${icon ? `<span class="ico">${NP.icon(icon)}</span>` : ''}<div><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="right">${right}</div></div>`;

  NP.seg = (id, options, active) =>
    `<div class="seg" id="${id}">${options.map(([v, l]) => `<button data-v="${v}" class="${v === active ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  NP.bindSeg = (root, id, fn) => {
    const seg = root.querySelector('#' + id);
    seg?.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      fn(b.dataset.v);
    });
  };

  NP.meter = (label, valueText, pct, color) =>
    `<div class="meter"><div class="meter-head"><span class="k">${label}</span><span class="v">${valueText}</span></div>
      <div class="meter-track"><div class="meter-fill" style="--c:${color};width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%"></div></div></div>`;

  /* Seeded RNG so mock history is stable between page switches */
  NP.rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
