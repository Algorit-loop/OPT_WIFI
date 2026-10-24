/* Công cụ mạng — Speed test, Ping, DNS lookup, Traceroute, quick network actions */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};

  /* ---- speed test dial: non-linear scale so both 5 and 900 Mbps are readable ---- */
  const STEPS = [0, 5, 10, 50, 100, 250, 500, 1000];
  const CX = 170, CY = 170, R = 140, START = 150, SWEEP = 240;
  const frac = (mbps) => {
    if (mbps >= 1000) return 1;
    for (let i = 1; i < STEPS.length; i++) if (mbps <= STEPS[i]) return (i - 1 + (mbps - STEPS[i - 1]) / (STEPS[i] - STEPS[i - 1])) / (STEPS.length - 1);
    return 0;
  };
  const pt = (deg, r) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (r) => { const [x1, y1] = pt(START, r), [x2, y2] = pt(START + SWEEP, r); return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`; };
  const LEN = (2 * Math.PI * R * SWEEP) / 360;

  const dial = () => `
    <svg viewBox="0 0 340 250">
      <defs><linearGradient id="stGrad" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
      <path d="${arc(R)}" fill="none" stroke="rgba(148,163,184,.12)" stroke-width="18" stroke-linecap="round"/>
      <path id="stArc" d="${arc(R)}" fill="none" stroke="url(#stGrad)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${LEN}" stroke-dashoffset="${LEN}" style="transition:stroke-dashoffset .35s var(--ease);filter:drop-shadow(0 0 10px var(--accent-glow))"/>
      ${STEPS.map((s, i) => {
        const deg = START + (SWEEP * i) / (STEPS.length - 1);
        const [x1, y1] = pt(deg, R - 16), [x2, y2] = pt(deg, R - 24), [lx, ly] = pt(deg, R - 40);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(148,163,184,.4)" stroke-width="2"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" fill="var(--muted)" font-size="11" font-family="var(--mono)">${s}</text>`;
      }).join('')}
      <g class="needle" id="stNeedle" style="transform:rotate(${START}deg)"><line x1="${CX}" y1="${CY}" x2="${CX + R - 52}" y2="${CY}"/></g>
      <circle cx="${CX}" cy="${CY}" r="9" fill="var(--panel-solid)" stroke="var(--accent)" stroke-width="3"/>
    </svg>`;

  NP.pages.tools = {
    title: 'Công cụ mạng',
    sub: 'Speed test, Ping, DNS, Traceroute và thao tác nhanh',
    render() {
      const res = (id, icon, label, unit) => `<div class="st-res" id="${id}"><div class="k">${NP.icon(icon)}${label}</div><div class="v"><span>—</span><small>${unit}</small></div></div>`;
      return `
      <div class="grid">
        <div class="card c-12">
          ${NP.cardHead('Speed Test', { icon: 'gauge', sub: NP.t('Đo tốc độ Internet thực tế qua Cloudflare — kết quả dùng làm "mức tối đa" cho các biểu đồ'), right: `<span class="badge" id="stPhase">${NP.t('Sẵn sàng')}</span>` })}
          <div class="speedtest">
            <div class="st-gauge">
              ${dial()}
              <div class="st-center" id="stCenter" style="display:none"><div class="big" id="stVal">0</div><div class="lbl" id="stLbl">Mbps</div></div>
              <div style="position:absolute;left:50%;top:68%;transform:translate(-50%,-50%)" id="stGoWrap"><button class="st-go" id="stGo">GO</button></div>
            </div>
            <div>
              <div class="st-results">
                ${res('rPing', 'timer', 'Ping', 'ms')}${res('rJit', 'activity', 'Jitter', 'ms')}
                ${res('rDown', 'down', 'Download', 'Mbps')}${res('rUp', 'up', 'Upload', 'Mbps')}
              </div>
              <div class="chart-box" style="height:110px;margin-top:14px"><canvas id="stLive"></canvas></div>
              <div class="row-flex" style="margin-top:12px;justify-content:space-between">
                <span class="muted" style="font-size:12px" id="stServer">${NP.t('Máy chủ: Cloudflare (tự chọn gần nhất) · tốn khoảng 100–500 MB dữ liệu')}</span>
                <button class="btn sm" id="stAgain" style="display:none">${NP.icon('refresh')}${NP.t('Đo lại')}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card c-7">
          <div class="tabs" id="toolTabs">
            <button class="tab on" data-t="ping">${NP.icon('timer')}Ping</button>
            <button class="tab" data-t="dns">${NP.icon('globe')}DNS Lookup</button>
            <button class="tab" data-t="trace">${NP.icon('route')}Traceroute</button>
          </div>
          <div id="toolPanel"></div>
        </div>

        <div class="card c-5">
          ${NP.cardHead(NP.t('Thao tác nhanh'), { icon: 'zap', sub: NP.t('Các lệnh quản lý mạng trên Windows') })}
          <div class="actions" style="grid-template-columns:1fr 1fr">
            <button class="action" data-a="flushdns"><span class="ai">${NP.icon('eraser')}</span><b>${NP.t('Xoá cache DNS')}</b><span>ipconfig /flushdns</span></button>
            <button class="action" data-a="renew"><span class="ai">${NP.icon('refresh')}</span><b>${NP.t('Làm mới IP')}</b><span>ipconfig /renew</span></button>
            <button class="action" data-a="reconnect"><span class="ai">${NP.icon('wifi')}</span><b>${NP.t('Kết nối lại Wi-Fi')}</b><span>netsh wlan connect</span></button>
            <button class="action" data-a="diag"><span class="ai">${NP.icon('sparkles')}</span><b>${NP.t('Chẩn đoán')}</b><span>${NP.t('Kiểm tra gateway, DNS, Internet')}</span></button>
            <button class="action" data-a="release"><span class="ai">${NP.icon('unlink')}</span><b>${NP.t('Cấp lại IP')}</b><span>ipconfig /release + /renew</span></button>
            <button class="action danger" data-a="resetWinsock"><span class="ai">${NP.icon('power')}</span><b>Reset Winsock</b><span>${NP.t('Cần khởi động lại')}</span></button>
          </div>
          <div class="terminal" id="actTerm" style="height:150px;margin-top:14px"><div class="ln dim">${NP.t('Kết quả lệnh sẽ hiển thị tại đây.')}</div></div>
        </div>
      </div>`;
    },

    async mount(root) {
      const $ = (s) => root.querySelector(s);
      let alive = true;
      let gateway = null;
      try { gateway = (await NP.api.getNetwork()).gateway; } catch { /* optional */ }

      /* ---------------- speed test ---------------- */
      const live = NP.charts.line($('#stLive'), {
        labels: [], series: [
          { label: 'Download', color: NP.css('--down'), data: [], alpha: 0.25 },
          { label: 'Upload', color: NP.css('--up'), data: [], alpha: 0.25 },
        ], tooltipValue: (v) => `${(+v).toFixed(1)} Mbps`,
      });
      live.options.scales.x.display = false;
      live.options.animation = false;

      const setDial = (mbps) => {
        const f = frac(mbps);
        $('#stArc').style.strokeDashoffset = LEN * (1 - f);
        $('#stNeedle').style.transform = `rotate(${START + SWEEP * f}deg)`;
        $('#stVal').textContent = mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1);
      };
      const setRes = (id, v, active) => {
        const el = $('#' + id);
        if (v != null) el.querySelector('span').textContent = v;
        root.querySelectorAll('.st-res').forEach((x) => x.classList.toggle('active', x.id === active));
      };

      // jobId: re-attach to a test already running in the agent (started before a reload/page switch, or automatic)
      const run = async (jobId) => {
        $('#stGoWrap').style.display = 'none';
        $('#stCenter').style.display = '';
        $('#stAgain').style.display = 'none';
        ['rPing', 'rJit', 'rDown', 'rUp'].forEach((id) => setRes(id, '—'));
        live.data.labels = []; live.data.datasets.forEach((d) => (d.data = [])); live.update();
        let i = 0;
        const phaseName = { ping: NP.t('Đang đo Ping'), download: NP.t('Đang đo Download'), upload: NP.t('Đang đo Upload'), done: NP.t('Hoàn tất') };
        let result;
        try {
        result = await NP.api.speedTest((p) => {
          if (p.server) $('#stServer').textContent = `${NP.t('Máy chủ:')} ${p.server}`;
          if (!alive) return;
          $('#stPhase').textContent = phaseName[p.phase];
          $('#stPhase').className = 'badge ' + (p.phase === 'done' ? 'good' : 'info');
          if (p.phase === 'ping') { $('#stLbl').textContent = 'ms · ping'; $('#stVal').textContent = p.ping ?? 0; setRes('rPing', p.ping, 'rPing'); setDial(0); $('#stVal').textContent = p.ping ?? 0; }
          if (p.phase === 'download' || p.phase === 'upload') {
            const mbps = p.value / 1e6;
            $('#stLbl').textContent = `Mbps · ${p.phase}`;
            setDial(mbps);
            setRes(p.phase === 'download' ? 'rDown' : 'rUp', mbps.toFixed(1), p.phase === 'download' ? 'rDown' : 'rUp');
            live.data.labels.push(i++);
            live.data.datasets[0].data.push(p.phase === 'download' ? mbps : null);
            live.data.datasets[1].data.push(p.phase === 'upload' ? mbps : null);
            live.update('none');
          }
        }, jobId);
        } catch (e) {
          if (!alive) return;
          $('#stPhase').textContent = NP.t('Lỗi'); $('#stPhase').className = 'badge crit';
          $('#stAgain').style.display = '';
          NP.toast(NP.t('Speed test thất bại: ') + NP.esc(e.message), 'crit', 6000);
          return;
        }
        if (!alive) return;
        setRes('rPing', result.ping); setRes('rJit', result.jitter);
        setRes('rDown', (result.down / 1e6).toFixed(1)); setRes('rUp', (result.up / 1e6).toFixed(1), null);
        setDial(result.down / 1e6); $('#stLbl').textContent = 'Mbps · download';
        $('#stAgain').style.display = '';
        $('#stServer').textContent = `${NP.t('Máy chủ:')} ${result.server || 'Cloudflare'}${result.isp ? ' · ' + result.isp : ''} · ${NP.fmtTime(Date.now())}`;
        NP.toast(`${NP.t('Speed test xong:')} ↓ ${(result.down / 1e6).toFixed(0)} Mbps · ↑ ${(result.up / 1e6).toFixed(0)} Mbps`, 'good', 4500);
      };
      // show the most recent stored result until a new test runs
      NP.api.getCapacity().then((c) => {
        if (!c || !alive || !$('#stGoWrap') || $('#stGoWrap').style.display === 'none') return;
        setRes('rPing', NP.num(c.ping, 0)); setRes('rJit', NP.num(c.jitter, 1));
        setRes('rDown', (c.down / 1e6).toFixed(1)); setRes('rUp', (c.up / 1e6).toFixed(1));
        $('#stPhase').textContent = `${NP.t('Lần đo gần nhất:')} ${NP.timeAgo(c.ts)}`;
        $('#stServer').textContent = `${NP.t('Máy chủ:')} ${c.server || 'Cloudflare'} · ${NP.fmtDateTime(c.ts)}${c.ssid ? ' · ' + c.ssid : ''}`;
      }).catch(() => {});
      $('#stGo').addEventListener('click', () => run());
      $('#stAgain').addEventListener('click', () => run());
      const active = await NP.api.activeJobs().catch(() => ({}));
      if (!alive) return;
      if (active.speedtest) {
        run(active.speedtest.id);
        if (active.speedtest.params?.auto) NP.toast(NP.t('Đang hiển thị speed test tự động do agent chạy theo lịch'), 'info', 4000);
      }

      /* ---------------- tabs: ping / dns / trace ---------------- */
      const term = (id, h = 330) => `<div class="terminal" id="${id}" style="height:${h}px"><div class="term-bar"><i style="background:#f87171"></i><i style="background:#fbbf24"></i><i style="background:#34d399"></i></div><div class="ln dim">${NP.t('Sẵn sàng.')}</div></div>`;
      const write = (el, text, cls = '') => {
        const d = document.createElement('div'); d.className = 'ln ' + cls; d.textContent = text;
        el.appendChild(d); el.scrollTop = el.scrollHeight;
      };
      const panels = {
        ping: () => `
          <div class="input-group" style="margin-bottom:12px">
            <input class="input mono" id="pHost" value="${NP.esc(NP.settings.pingTarget)}" placeholder="${NP.t('Host hoặc IP')}" />
            <select class="select" id="pCount" style="width:110px">${[4, 10, 20].map((n) => `<option value="${n}">${NP.t('{n} lần', { n })}</option>`).join('')}</select>
            <button class="btn primary" id="pRun">${NP.icon('play')}Ping</button>
          </div>
          <div class="row-flex" style="margin-bottom:12px">${[...(gateway ? [gateway] : []), '1.1.1.1', '8.8.8.8', 'google.com'].map((h) => `<button class="btn sm" data-host="${h}">${h}</button>`).join('')}</div>
          ${term('pTerm')}`,
        dns: () => `
          <div class="input-group" style="margin-bottom:12px">
            <input class="input mono" id="dHost" value="google.com" placeholder="${NP.t('Tên miền')}" />
            <select class="select" id="dType" style="width:110px">${['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'PTR'].map((t) => `<option>${t}</option>`).join('')}</select>
            <button class="btn primary" id="dRun">${NP.icon('search')}${NP.t('Tra cứu')}</button>
          </div>
          <div id="dOut"><div class="empty">${NP.t('Nhập tên miền và nhấn Tra cứu')}</div></div>`,
        trace: () => `
          <div class="input-group" style="margin-bottom:12px">
            <input class="input mono" id="tHost" value="google.com" placeholder="${NP.t('Host hoặc IP')}" />
            <button class="btn primary" id="tRun">${NP.icon('route')}Trace</button>
          </div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th class="num">#</th><th>${NP.t('Địa chỉ')}</th><th>${NP.t('Tên')}</th><th class="num">RTT 1</th><th class="num">RTT 2</th><th class="num">RTT 3</th><th style="width:28%"></th></tr></thead>
          <tbody id="tBody"><tr><td colspan="7"><div class="empty">${NP.t('Nhấn Trace để bắt đầu')}</div></td></tr></tbody></table></div>`,
      };

      // job: {id, params} of a ping/traceroute still running in the agent — the panel re-attaches to it
      const bindPanel = (t, job) => {
        $('#toolPanel').innerHTML = `<div class="tab-panel">${panels[t]()}</div>`;
        if (t === 'ping') {
          const go = async (job) => {
            if (job) { $('#pHost').value = job.params.host; $('#pCount').value = String(job.params.count); }
            const host = $('#pHost').value.trim(); if (!host) return;
            const btn = $('#pRun'); btn.disabled = true;
            const out = $('#pTerm'); out.querySelectorAll('.ln').forEach((x) => x.remove());
            write(out, `> ping ${host} -n ${$('#pCount').value}`, 'p');
            try { await NP.api.ping(host, +$('#pCount').value, (l, c) => alive && write(out, l, c), job?.id); }
            catch (e) { write(out, NP.t('Lỗi: ') + e.message, 'er'); }
            btn.disabled = false;
          };
          $('#pRun').addEventListener('click', () => go());
          $('#pHost').addEventListener('keydown', (e) => e.key === 'Enter' && go());
          if (job) go(job);
          root.querySelectorAll('[data-host]').forEach((b) => b.addEventListener('click', () => { $('#pHost').value = b.dataset.host; go(); }));
        }
        if (t === 'dns') {
          const go = async () => {
            const host = $('#dHost').value.trim(); if (!host) return;
            $('#dOut').innerHTML = '<div class="skeleton" style="height:120px"></div>';
            let r;
            try { r = await NP.api.dns(host, $('#dType').value); }
            catch (e) { $('#dOut').innerHTML = NP.emptyHTML('alert', NP.esc(e.message)); return; }
            if (!alive) return;
            $('#dOut').innerHTML = `
              <div class="row-flex" style="margin-bottom:10px"><span class="badge info">Server ${NP.esc(r.server || '—')}</span><span class="badge good">${r.time} ms</span><span class="badge">${NP.t('{n} bản ghi', { n: r.records.length })}</span>${r.error ? `<span class="badge crit">${NP.esc(r.error)}</span>` : ''}</div>
              <div class="table-wrap"><table class="tbl"><thead><tr><th>${NP.t('Loại')}</th><th>${NP.t('Giá trị')}</th><th class="num">TTL</th><th></th></tr></thead><tbody>
              ${r.records.map((x) => `<tr><td><span class="badge violet">${x.type}</span></td><td class="mono" style="font-size:12.5px">${NP.esc(x.value)}</td><td class="num">${x.ttl}s</td><td><span class="copy" style="cursor:pointer;color:var(--muted)" data-copy="${NP.esc(x.value)}">${NP.icon('copy')}</span></td></tr>`).join('') || `<tr><td colspan="4"><div class="empty">${NP.t('Không có bản ghi')}</div></td></tr>`}
              </tbody></table></div>`;
          };
          $('#dRun').addEventListener('click', go);
          $('#dHost').addEventListener('keydown', (e) => e.key === 'Enter' && go());
        }
        if (t === 'trace') {
          const go = async (job) => {
            if (job) $('#tHost').value = job.params.host;
            const host = $('#tHost').value.trim(); if (!host) return;
            const btn = $('#tRun'); btn.disabled = true; btn.innerHTML = `${NP.icon('refresh', 'spin')}${NP.t('Đang trace…')}`;
            const body = $('#tBody'); body.innerHTML = '';
            try {
            await NP.api.traceroute(host, (h) => {
              if (!alive) return;
              const valid = h.rtt ? h.rtt.filter((x) => x != null) : [];
              const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
              const tr = document.createElement('tr');
              tr.style.animation = 'fadeIn .35s var(--ease) both';
              tr.innerHTML = `<td class="num">${h.hop}</td><td class="mono" style="font-size:12.5px">${h.ip}</td><td class="txt-2">${NP.esc(h.name)}</td>
                ${h.rtt ? h.rtt.map((x) => (x == null ? '<td class="num muted">*</td>' : `<td class="num">${x < 1 ? '<1' : x} ms</td>`)).join('') : '<td class="num muted">*</td><td class="num muted">*</td><td class="num muted">*</td>'}
                <td>${h.rtt ? `<div class="meter-track" style="height:6px"><div class="meter-fill" style="--c:var(--${NP.pingTone(avg)});width:${Math.min(100, avg / 0.6)}%"></div></div>` : '<span class="muted" style="font-size:12px">timeout</span>'}</td>`;
              body.appendChild(tr);
            }, job?.id);
            } catch (e) {
              body.insertAdjacentHTML('beforeend', `<tr><td colspan="7">${NP.emptyHTML('alert', NP.esc(e.message))}</td></tr>`);
            }
            btn.disabled = false; btn.innerHTML = `${NP.icon('route')}Trace`;
          };
          $('#tRun').addEventListener('click', () => go());
          $('#tHost').addEventListener('keydown', (e) => e.key === 'Enter' && go());
          if (job) go(job);
        }
      };
      const JOB_KIND = { ping: 'ping', trace: 'traceroute' };
      const showTab = (t, job) => {
        root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.t === t));
        bindPanel(t, job);
      };
      $('#toolTabs').addEventListener('click', async (e) => {
        const b = e.target.closest('.tab'); if (!b) return;
        const t = b.dataset.t;
        showTab(t);
        if (!JOB_KIND[t]) return;
        const jobs = await NP.api.activeJobs().catch(() => ({}));
        const job = jobs[JOB_KIND[t]];
        if (job && alive && root.querySelector('.tab.on')?.dataset.t === t) bindPanel(t, job);
      });
      // open the tab of a ping/traceroute still running (the most recently started one)
      const running = ['ping', 'trace'].filter((t) => active[JOB_KIND[t]]).sort((a, b) => active[JOB_KIND[b]].created - active[JOB_KIND[a]].created);
      showTab(running[0] || 'ping', running[0] ? active[JOB_KIND[running[0]]] : undefined);

      /* ---------------- actions ---------------- */
      const CMD = { flushdns: 'ipconfig /flushdns', renew: 'ipconfig /renew', release: 'ipconfig /release && ipconfig /renew', reconnect: 'netsh wlan disconnect / connect', resetWinsock: 'netsh winsock reset', diag: NP.t('NetPulse chẩn đoán') };
      root.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.a;
        if (['release', 'resetWinsock', 'reconnect'].includes(a) && !confirm(NP.t('Chạy "{x}"? Thao tác này có thể làm gián đoạn mạng vài giây.', { x: CMD[a] }))) return;
        const out = $('#actTerm');
        out.innerHTML = '';
        write(out, `> ${CMD[a]}`, 'p');
        b.style.pointerEvents = 'none'; b.style.opacity = 0.6;
        const runIt = async (elevate) => {
          let r;
          try { r = await NP.api.action(a, elevate); }
          catch (e) { r = { ok: false, output: e.message }; }
          if (!alive) return null;
          r.output.split('\n').forEach((l) => write(out, l, r.ok ? '' : 'er'));
          write(out, r.ok ? `✓ ${NP.t('Hoàn tất')}` : `✗ ${NP.t('Thất bại')}`, r.ok ? 'ok' : 'er');
          return r;
        };
        let r = await runIt(false);
        if (r && !r.ok && r.needsAdmin && confirm(NP.t('Lệnh này cần quyền Administrator. Chạy lại với quyền Admin? (Windows sẽ hiện hộp thoại UAC)'))) {
          write(out, '');
          write(out, '> (Administrator) ' + CMD[a], 'p');
          r = await runIt(true);
        }
        b.style.pointerEvents = ''; b.style.opacity = '';
        if (r) NP.toast(`${b.querySelector('b').textContent}: ${r.ok ? NP.t('thành công') : NP.t('thất bại')}`, r.ok ? 'good' : 'crit');
      }));

      return () => { alive = false; };
    },
  };
})();
