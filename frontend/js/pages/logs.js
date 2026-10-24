/* Lịch sử & Log — connection events, config changes, alerts; filter, search, export */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};

  const LEVEL_VI = { info: 'Thông tin', good: 'Thành công', warn: 'Cảnh báo', crit: 'Nghiêm trọng' };
  const TYPE_VI = {
    connect: 'Kết nối', disconnect: 'Ngắt kết nối', roam: 'Chuyển AP', high_latency: 'Độ trễ cao', packet_loss: 'Mất gói',
    signal_drop: 'Tín hiệu yếu', ip_change: 'Đổi IP/mạng', dns_change: 'Đổi DNS', speedtest: 'Speed test', usage_alert: 'Dung lượng', agent: 'Agent',
  };
  // labels follow the current language: LEVELS.warn → "Cảnh báo" / "Warning"
  const localized = (src) => new Proxy(src, { get: (o, k) => (k in o ? NP.t(o[k]) : undefined) });
  const LEVELS = localized(LEVEL_VI), TYPES = localized(TYPE_VI);
  const ICON = {
    connect: 'link', disconnect: 'unlink', roam: 'radio', high_latency: 'timer', packet_loss: 'alert', signal_drop: 'wifi',
    ip_change: 'hash', dns_change: 'server', speedtest: 'gauge', usage_alert: 'database', agent: 'cpu',
  };
  const PAGE = 20;

  NP.pages.logs = {
    title: 'Lịch sử & Log',
    sub: 'Sự kiện kết nối, thay đổi cấu hình và cảnh báo',
    render() {
      return `
      <div class="grid">
        ${['info', 'good', 'warn', 'crit'].map((l) => `
          <div class="card lift c-3 kpi" style="min-height:96px;cursor:pointer" data-lvl="${l}">
            <div class="kpi-top"><span class="badge ${l}" style="padding:3px 9px">${NP.icon({ info: 'info', good: 'checkCircle', warn: 'alert', crit: 'xCircle' }[l])}${LEVELS[l]}</span></div>
            <div class="kpi-val"><span class="num" id="cnt-${l}">0</span><span class="unit">${NP.t('sự kiện')}</span></div>
          </div>`).join('')}

        <div class="card c-12">
          ${NP.cardHead(NP.t('Sự kiện theo ngày'), { icon: 'chart', sub: NP.t('7 ngày gần nhất'), right: `<div class="legend">${Object.keys(LEVEL_VI).map((k) => [k, LEVELS[k]]).map(([k, v]) => `<span><i style="background:var(--${k === 'info' ? 'accent' : k})"></i>${v}</span>`).join('')}</div>` })}
          <div class="chart-box h-200"><canvas id="lgChart"></canvas></div>
        </div>

        <div class="card c-12">
          <div class="row-flex" style="margin-bottom:14px">
            <div style="position:relative;flex:1;min-width:220px;max-width:360px">
              <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted);display:inline-flex;width:16px;height:16px">${NP.icon('search')}</span>
              <input class="input" id="lgSearch" placeholder="${NP.t('Tìm trong log…')}" style="padding-left:36px" />
            </div>
            ${NP.seg('lgLevel', [['all', NP.t('Tất cả')], ...Object.keys(LEVEL_VI).map((k) => [k, LEVELS[k]])], 'all')}
            <select class="select" id="lgType" style="width:auto"><option value="all">${NP.t('Mọi loại')}</option>${Object.keys(TYPE_VI).map((k) => `<option value="${k}">${TYPES[k]}</option>`).join('')}</select>
            <span class="spacer"></span>
            <button class="btn sm" id="lgExport">${NP.icon('download')}CSV</button>
            <button class="btn sm danger" id="lgClear">${NP.icon('trash')}${NP.t('Xoá log')}</button>
          </div>
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th style="width:150px">${NP.t('Thời gian')}</th><th style="width:130px">${NP.t('Mức độ')}</th><th style="width:150px">${NP.t('Loại')}</th><th>${NP.t('Sự kiện')}</th><th>${NP.t('Chi tiết')}</th></tr></thead>
            <tbody id="lgBody"></tbody></table></div>
          <div class="row-flex" style="margin-top:14px;justify-content:space-between">
            <span class="muted" style="font-size:12px" id="lgInfo"></span>
            <div class="row-flex" id="lgPager"></div>
          </div>
        </div>
      </div>`;
    },

    async mount(root) {
      const $ = (s) => root.querySelector(s);
      let all = await NP.api.getEvents();
      let level = 'all', type = 'all', q = '', page = 0;

      const counts = () => ['info', 'good', 'warn', 'crit'].forEach((l) => NP.countUp($(`#cnt-${l}`), all.filter((e) => e.level === l).length));

      const drawChart = () => {
        const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
        const series = ['info', 'good', 'warn', 'crit'].map((l) => ({
          label: LEVELS[l], color: NP.css(l === 'info' ? '--accent' : '--' + l),
          data: days.map((d) => all.filter((e) => e.level === l && e.ts >= +d && e.ts < +d + 86400e3).length),
        }));
        Chart.getChart($('#lgChart'))?.destroy();
        NP.charts.bar($('#lgChart'), { labels: days.map((d) => `${NP.pad(d.getDate())}/${NP.pad(d.getMonth() + 1)}`), series, stacked: true, yTitle: NP.t('Số sự kiện') });
      };

      const filtered = () => all.filter((e) =>
        (level === 'all' || e.level === level) && (type === 'all' || e.type === type) &&
        (!q || (e.title + ' ' + e.detail).toLowerCase().includes(q)));

      const draw = () => {
        const list = filtered();
        const pages = Math.max(1, Math.ceil(list.length / PAGE));
        page = Math.min(page, pages - 1);
        const rows = list.slice(page * PAGE, page * PAGE + PAGE);
        const hl = (s) => (q ? NP.esc(s).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark style="background:var(--accent-glow);color:var(--text);border-radius:3px">${m}</mark>`) : NP.esc(s));
        $('#lgBody').innerHTML = rows.length ? rows.map((e) => `
          <tr><td class="mono" style="font-size:12px">${NP.fmtDateTime(e.ts)}</td>
            <td><span class="badge ${e.level}">${LEVELS[e.level]}</span></td>
            <td><span class="row-flex txt-2" style="gap:6px;flex-wrap:nowrap"><span style="display:inline-flex;width:15px">${NP.icon(e.icon || ICON[e.type] || 'info')}</span>${TYPES[e.type] || NP.esc(e.type)}</span></td>
            <td><b>${hl(e.title)}</b></td><td class="txt-2" style="white-space:normal">${hl(e.detail)}</td></tr>`).join('')
          : `<tr><td colspan="5"><div class="empty">${NP.t('Không có sự kiện phù hợp')}</div></td></tr>`;
        $('#lgInfo').textContent = NP.t('Hiển thị {a}–{b} / {n} sự kiện', { a: list.length ? page * PAGE + 1 : 0, b: Math.min(list.length, (page + 1) * PAGE), n: list.length }) +
          (all.length ? NP.t(' · lưu trữ {d} ngày', { d: NP.settings.retentionDays }) : '');
        const btn = (p, label, dis, on) => `<button class="btn sm" data-p="${p}" ${dis ? 'disabled' : ''} style="${on ? 'border-color:var(--accent);color:var(--accent)' : ''}">${label}</button>`;
        const nums = [];
        for (let i = Math.max(0, page - 2); i <= Math.min(pages - 1, page + 2); i++) nums.push(btn(i, i + 1, false, i === page));
        $('#lgPager').innerHTML = btn(page - 1, '‹', page === 0) + nums.join('') + btn(page + 1, '›', page >= pages - 1);
      };

      $('#lgPager').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { page = +b.dataset.p; draw(); } });
      NP.bindSeg(root, 'lgLevel', (v) => { level = v; page = 0; draw(); });
      root.querySelectorAll('[data-lvl]').forEach((c) => c.addEventListener('click', () => {
        level = c.dataset.lvl; page = 0;
        root.querySelectorAll('#lgLevel button').forEach((b) => b.classList.toggle('on', b.dataset.v === level));
        draw();
        $('#lgSearch').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
      $('#lgType').addEventListener('change', (e) => { type = e.target.value; page = 0; draw(); });
      let deb;
      $('#lgSearch').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { q = e.target.value.trim().toLowerCase(); page = 0; draw(); }, 180); });
      $('#lgExport').addEventListener('click', () => {
        const rows = [['time', 'level', 'type', 'title', 'detail'], ...filtered().map((e) => [new Date(e.ts).toISOString(), e.level, e.type, e.title, `"${e.detail.replace(/"/g, '""')}"`])];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
        a.download = 'netpulse-events.csv'; a.click(); URL.revokeObjectURL(a.href);
        NP.toast(NP.t('Đã xuất log ra CSV'), 'good');
      });
      $('#lgClear').addEventListener('click', async () => {
        if (!confirm(NP.t('Xoá toàn bộ log sự kiện? Không thể hoàn tác.'))) return;
        try {
          await NP.api.clearEvents();
          all = []; counts(); draw(); drawChart();
          NP.toast(NP.t('Đã xoá log sự kiện'), 'warn');
        } catch (e) { NP.toast(NP.t('Không xoá được: ') + NP.esc(e.message), 'crit'); }
      });

      counts(); drawChart(); draw();
      // new events while the page is open
      return NP.bus.on('events', (list) => {
        all = [...list, ...all];
        counts(); drawChart(); draw();
      });
    },
  };
})();
