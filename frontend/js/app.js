/* App shell: navigation, hash router, live sample loop, agent connection, theme */
(function () {
  const NP = window.NP;

  const NAV = [
    ['Giám sát', [
      ['dashboard', 'Tổng quan', 'dashboard'],
      ['realtime', 'Thời gian thực', 'activity'],
      ['wifi', 'Wi-Fi & Mạng', 'wifi'],
      ['quality', 'Chất lượng kết nối', 'target'],
    ]],
    ['Phân tích', [
      ['analytics', 'Thống kê & Xu hướng', 'chart'],
      ['logs', 'Lịch sử & Log', 'list'],
    ]],
    ['Hệ thống', [
      ['tools', 'Công cụ mạng', 'tool'],
      ['settings', 'Cài đặt', 'settings'],
    ]],
  ];

  const $ = (id) => document.getElementById(id);

  /* ---------- Live sample store ---------- */
  const MAX = 900; // 15 min @ 1s
  const live = {
    buffer: [], last: null, paused: false, subs: new Set(), timer: null, status: null, fails: 0,
    subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
    push(s) {
      this.last = s;
      this.buffer.push(s);
      if (this.buffer.length > MAX) this.buffer.shift();
      this.subs.forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } });
    },
    async tick() {
      if (!this.paused) {
        try {
          const r = await NP.api.samples();
          this.fails = 0;
          setAgentState(true);
          if (r.status) applyStatus(r.status);
          r.samples.forEach((s) => this.push(s));
          if (this.last) updateTopbar(this.last);
          if (r.eventSeq > events.seq) onNewEvents(r.eventSeq);
        } catch {
          if (++this.fails >= 2) setAgentState(false);
        }
      }
      this.timer = setTimeout(() => this.tick(), Math.min(NP.settings.refreshMs, 2000));
    },
    async prefill(n = MAX) {
      const r = await NP.api.prefill(n);
      this.buffer = r.samples.slice(-MAX);
      this.last = this.buffer[this.buffer.length - 1] || null;
      events.seq = r.eventSeq || 0;
    },
  };
  NP.live = live;

  /* ---------- Events: badge + notifications ---------- */
  // "last seen" marker lives in the agent's database, not in the browser
  const events = { seq: 0, seen: 0 };
  NP.markEventsSeen = (id) => {
    const next = Math.max(events.seen, id ?? events.seq);
    if (next !== events.seen) {
      events.seen = next;
      NP.api.markSeen?.(next).catch(() => {});
    }
    refreshBadge();
  };
  async function refreshBadge() {
    const b = $('navLogBadge');
    if (!b) return;
    try {
      const list = await NP.api.getEvents(events.seen);
      const n = list.filter((e) => e.level === 'warn' || e.level === 'crit').length;
      b.textContent = n > 99 ? '99+' : n;
      b.style.display = n ? '' : 'none';
    } catch { b.style.display = 'none'; }
  }
  async function onNewEvents(seq) {
    const prev = events.seq;
    events.seq = seq;
    let list = [];
    try { list = await NP.api.getEvents(prev); } catch { return; }
    if (NP.settings.notify) {
      list.slice(0, 3).reverse().forEach((e) => {
        if (e.level === 'warn' || e.level === 'crit' || e.type === 'speedtest' || e.type === 'connect')
          NP.toast(`<b>${NP.esc(e.title)}</b><br><span class="muted">${NP.esc(e.detail)}</span>`, e.level === 'info' ? 'info' : e.level, 6000);
      });
    }
    NP.bus.emit('events', list);
    if (current === 'logs') NP.markEventsSeen(seq); else refreshBadge();
  }

  /* ---------- Topbar / agent state ---------- */
  function updateTopbar(s) {
    $('pillDown').textContent = NP.fmtRate(s.down).text;
    $('pillUp').textContent = NP.fmtRate(s.up).text;
  }
  function applyStatus(st) {
    live.status = { ...(live.status || {}), ...st };
    $('connName').textContent = NP.tx(st.name) || '—';
    $('liveDot').className = 'live-dot' + (live.paused ? ' paused' : st.online === false ? ' off' : '');
  }
  let agentOk = true;
  function setAgentState(ok) {
    if (ok === agentOk) return;
    agentOk = ok;
    $('agentDot').className = 'live-dot' + (ok ? '' : ' off');
    $('liveDot').className = 'live-dot' + (ok ? '' : ' off');
    $('offlineBar').style.display = ok ? 'none' : '';
    if (ok) NP.toast(NP.t('Đã kết nối lại với agent'), 'good', 2000);
  }
  function setPaused(p) {
    live.paused = p;
    $('pauseBtn').innerHTML = NP.icon(p ? 'play' : 'pause');
    $('liveDot').classList.toggle('paused', p);
    $('agentDot').classList.toggle('paused', p);
  }

  function applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = NP.settings.theme;
    const accents = {
      cyan: ['#22d3ee', '#0891b2', '#818cf8'],
      violet: ['#a78bfa', '#7c3aed', '#22d3ee'],
      emerald: ['#34d399', '#059669', '#22d3ee'],
      pink: ['#f472b6', '#db2777', '#a78bfa'],
    }[NP.settings.accent] || null;
    if (accents && NP.settings.accent !== 'cyan') {
      const a = NP.settings.theme === 'light' ? accents[1] : accents[0];
      root.style.setProperty('--accent', a);
      root.style.setProperty('--accent-2', accents[2]);
      root.style.setProperty('--accent-glow', NP.alpha(a, 0.3));
      root.style.setProperty('--border-strong', NP.alpha(a, 0.45));
    } else {
      ['--accent', '--accent-2', '--accent-glow', '--border-strong'].forEach((p) => root.style.removeProperty(p));
    }
    $('themeBtn').innerHTML = NP.icon(NP.settings.theme === 'dark' ? 'sun' : 'moon');
    NP.charts.applyTheme();
  }
  NP.applyTheme = applyTheme;

  /* ---------- Router ---------- */
  let cleanup = null, current = null;
  function buildNav() {
    $('nav').innerHTML = NAV.map(([group, items]) =>
      `<div class="nav-label">${NP.t(group)}</div>` +
      items.map(([key, label, icon]) => `<a class="nav-item${key === current ? ' active' : ''}" href="#/${key}" data-key="${key}">${NP.icon(icon)}<span>${NP.t(label)}</span>${key === 'logs' ? '<span class="badge warn" id="navLogBadge" style="display:none">0</span>' : ''}</a>`).join('')
    ).join('');
  }

  async function route() {
    const key = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
    const page = NP.pages[key] || NP.pages.dashboard;
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    Object.values(Chart.instances).forEach((c) => c.destroy());
    current = key;
    document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.key === key));
    $('pageTitle').textContent = NP.t(page.title);
    $('pageSub').textContent = NP.t(page.sub);
    document.title = `${NP.t(page.title)} · NetPulse`;
    const view = $('view');
    view.innerHTML = `<div class="page">${page.render()}</div>`;
    view.querySelectorAll('.page > .grid > *, .page > .reveal, .page > .grid > .stack > *').forEach((el, i) => {
      el.classList.add('reveal'); el.style.setProperty('--i', i);
    });
    window.scrollTo({ top: 0 });
    closeSidebar();
    if (key === 'logs') NP.markEventsSeen();
    try { cleanup = (await page.mount(view.firstElementChild)) || null; }
    catch (e) { console.error(e); NP.toast(NP.t('Lỗi khi tải trang: ') + NP.esc(e.message), 'crit'); }
  }
  NP.rerender = route;

  /* ---------- Mobile sidebar ---------- */
  const closeSidebar = () => { $('sidebar').classList.remove('open'); $('overlay').classList.remove('show'); };
  $('menuBtn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('overlay').classList.add('show'); });
  $('overlay').addEventListener('click', closeSidebar);

  $('themeBtn').addEventListener('click', () => {
    NP.saveSettings({ theme: NP.settings.theme === 'dark' ? 'light' : 'dark' });
    applyTheme();
    route();
  });
  $('pauseBtn').addEventListener('click', () => {
    setPaused(!live.paused);
    NP.toast(live.paused ? NP.t('Đã tạm dừng cập nhật trên giao diện (agent vẫn ghi dữ liệu)') : NP.t('Tiếp tục cập nhật'), live.paused ? 'warn' : 'good', 2200);
  });

  /* ---------- Language switch (EN / VI) ---------- */
  function applyLang(lang, save = true) {
    if (lang !== 'en' && lang !== 'vi') return;
    const changed = lang !== NP.lang;
    NP.setLang(lang);
    if (save && NP.settings.lang !== lang) NP.saveSettings({ lang });
    if (!changed) return;
    buildNav();
    refreshBadge();
    if (live.status) applyStatus(live.status);
    if (current) route();
  }
  NP.applyLang = applyLang;
  $('langSwitch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (b) applyLang(b.dataset.lang);
  });

  window.addEventListener('error', (e) => NP.toast(`JS error: ${NP.esc(e.message)} (${(e.filename || '').split('/').pop()}:${e.lineno})`, 'crit', 8000));
  window.addEventListener('unhandledrejection', (e) => NP.toast(`${NP.t('Lỗi:')} ${NP.esc(e.reason?.message || e.reason)}`, 'crit', 8000));

  /* ---------- Boot ---------- */
  function showBootError() {
    $('view').innerHTML = `
      <div class="page"><div class="card" style="max-width:640px;margin:40px auto;text-align:center;padding:36px">
        <div style="width:56px;height:56px;margin:0 auto 14px;color:var(--crit)">${NP.icon('plug')}</div>
        <h2 style="font-size:20px;margin-bottom:8px">${NP.t('Không kết nối được tới NetPulse Agent')}</h2>
        <p class="txt-2" style="margin-bottom:18px">${NP.t('Giao diện cần agent chạy nền để đọc dữ liệu mạng thật từ Windows.')}<br>
          ${NP.t('Chạy <b class="mono">start.bat</b> trong thư mục OPT_WIFI rồi mở <b class="mono">http://127.0.0.1:8765</b>.')}</p>
        <div class="row-flex" style="justify-content:center">
          <button class="btn primary" onclick="location.reload()">${NP.icon('refresh')}${NP.t('Thử lại')}</button>
          <a class="btn" href="?demo">${NP.icon('play')}${NP.t('Xem bản demo (dữ liệu mô phỏng)')}</a>
        </div>
      </div></div>`;
    $('agentDot').className = 'live-dot off';
    $('agentMode').textContent = 'offline';
    $('liveDot').className = 'live-dot off';
    setTimeout(() => location.reload(), 5000);
  }

  (async function boot() {
    if (location.search.includes('noanim')) document.documentElement.classList.add('noanim');
    NP.hydrateIcons();
    NP.setLang(NP.lang);
    buildNav();
    applyTheme();
    let status;
    try {
      status = await NP.api.getStatus();
    } catch {
      showBootError();
      return;
    }
    await NP.loadSettings();
    applyLang(NP.settings.lang, false);
    applyTheme();
    live.status = status;
    events.seen = status.lastSeenEvent || 0;
    applyStatus(status);
    $('agentMode').textContent = NP.demo ? 'demo' : `v${status.version}`;
    $('demoBadge').style.display = NP.demo ? '' : 'none';
    $('agentInterval').textContent = `${NP.settings.refreshMs / 1000}s`;
    setInterval(() => ($('agentUptime').textContent = NP.fmtDuration((Date.now() - status.startedAt) / 1000)), 1000);
    NP.bus.on('settings', (s) => ($('agentInterval').textContent = `${s.refreshMs / 1000}s`));
    await live.prefill();
    if (live.last) updateTopbar(live.last);
    refreshBadge();
    window.addEventListener('hashchange', route);
    route();
    live.tick();
  })();
})();
