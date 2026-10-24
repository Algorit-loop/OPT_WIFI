/* Tổng quan — the at-a-glance page: now, capacity, Wi-Fi, quality, consumption */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};

  const kpi = (id, tone, icon, label, unit, foot) => `
    <div class="card lift kpi tone-${tone} c-3" id="${id}">
      <div class="kpi-top"><span class="ico">${NP.icon(icon)}</span>${label}</div>
      <div class="kpi-val"><span class="num">—</span><span class="unit">${unit}</span></div>
      <div class="kpi-foot">${foot}</div>
      <div class="spark"><canvas></canvas></div>
    </div>`;

  NP.pages.dashboard = {
    title: 'Tổng quan',
    sub: 'Trạng thái mạng, mức sử dụng so với khả năng tối đa',
    render() {
      return `
      <div class="grid">
        ${kpi('kDown', 'down', 'down', NP.t('Download hiện tại'), NP.rateUnitLabel(), `<span>${NP.t('Đỉnh 15 phút:')} <b class="mono" id="kDownPeak">—</b></span>`)}
        ${kpi('kUp', 'up', 'up', NP.t('Upload hiện tại'), NP.rateUnitLabel(), `<span>${NP.t('Đỉnh 15 phút:')} <b class="mono" id="kUpPeak">—</b></span>`)}
        ${kpi('kData', 'violet', 'database', NP.t('Dữ liệu hôm nay'), 'GB', '<span id="kDataFoot">—</span>')}
        ${kpi('kPing', 'good', 'timer', `Ping · ${NP.esc(NP.settings.pingTarget)}`, 'ms', '<span>Jitter <b class="mono" id="kJitter">—</b></span><span>·</span><span id="kPingTone" class="badge">—</span>')}

        <div class="card fill c-8">
          ${NP.cardHead(NP.t('Lưu lượng trực tiếp'), {
            icon: 'activity', sub: NP.t('2 phút gần nhất · cập nhật liên tục'),
            right: `<div class="legend"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span><span id="capLegend" style="display:none"><i class="dash" style="color:var(--cap)"></i><span id="capLegendTxt">${NP.t('Mức tối đa')}</span></span></div>
                    <label class="row-flex muted" style="font-size:12px;gap:8px;cursor:pointer">${NP.t('Mức tối đa')}<span class="switch"><input type="checkbox" id="capToggle"><span class="sl"></span></span></label>`,
          })}
          <div class="chart-box h-280"><canvas id="liveChart"></canvas></div>
        </div>

        <div class="card c-4">
          ${NP.cardHead(NP.t('Mức sử dụng băng thông'), { icon: 'gauge', sub: '<span id="utilSub">—</span>' })}
          <div class="gauge-wrap" id="utilGauge">
            ${NP.charts.gaugeSVG()}
            <div class="gauge-center"><div class="big"><span id="utilPct">—</span><span style="font-size:16px">%</span></div><div class="small">${NP.t('Download đang dùng')}</div></div>
          </div>
          <div id="utilMeters" style="margin-top:14px"></div>
        </div>

        <div class="card lift c-4" id="wifiCard">
          ${NP.cardHead(NP.t('Kết nối hiện tại'), { icon: 'wifi', right: `<a href="#/wifi" class="btn sm">${NP.t('Chi tiết')}</a>` })}
          <div id="wifiBody"><div class="skeleton" style="height:150px"></div></div>
        </div>

        <div class="card lift c-4">
          ${NP.cardHead(NP.t('Chất lượng kết nối'), { icon: 'target', sub: NP.t('60 giây gần nhất'), right: `<a href="#/quality" class="btn sm">${NP.t('Chi tiết')}</a>` })}
          <div class="row-flex" style="gap:18px;align-items:center;flex-wrap:nowrap">
            <div class="ring-wrap" id="qRing" style="width:130px;height:130px;flex-shrink:0">${NP.charts.ringSVG()}<div class="center"><b id="qScore">—</b><span>${NP.t('Điểm ổn định')}</span></div></div>
            <div style="flex:1;display:grid;gap:8px" id="qList"></div>
          </div>
        </div>

        <div class="card lift c-4">
          ${NP.cardHead(NP.t('Dung lượng đã đo'), { icon: 'database', right: `<a href="#/analytics" class="btn sm">${NP.t('Thống kê')}</a>` })}
          <div class="mini-stats" style="grid-template-columns:1fr 1fr">
            <div class="mini-stat"><div class="k">${NP.t('Từ khi agent chạy')}</div><div class="v" id="sessData">—</div></div>
            <div class="mini-stat"><div class="k">${NP.t('Tháng này (đã đo)')}</div><div class="v" id="monthData">—</div></div>
          </div>
          <div style="margin-top:16px" id="capMeter"></div>
        </div>

        <div class="card fill c-7">
          ${NP.cardHead(NP.t('Tiêu thụ 24 giờ qua'), {
            icon: 'chart', sub: NP.t('Dung lượng theo giờ · cột trống là chưa đo'),
            right: '<div class="legend"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span></div>',
          })}
          <div class="chart-box h-240"><canvas id="usage24"></canvas></div>
        </div>

        <div class="card c-5">
          ${NP.cardHead(NP.t('Sự kiện gần đây'), { icon: 'bell', right: `<a href="#/logs" class="btn sm">${NP.t('Xem tất cả')}</a>` })}
          <div class="timeline" id="evList"></div>
        </div>
      </div>`;
    },

    async mount(root) {
      const $ = (s) => root.querySelector(s);
      const down = NP.css('--down'), up = NP.css('--up'), cap = NP.css('--cap');
      const buf = NP.live.buffer;
      const N = 120;
      const recent = buf.slice(-N);
      let [wifi, network, capacity, usage, events, month] = await Promise.all([
        NP.api.getWifi(), NP.api.getNetwork(), NP.api.getCapacity(), NP.api.getUsage('24h'), NP.api.getEvents(), NP.api.getUsage('30d'),
      ]);
      if (!root.isConnected) return;
      const basis = () => NP.capacityBasis(capacity, wifi, network);

      /* sparks */
      const sparkD = NP.charts.spark($('#kDown canvas'), down, recent.slice(-40).map((s) => NP.toDisplayRate(s.down)));
      const sparkU = NP.charts.spark($('#kUp canvas'), up, recent.slice(-40).map((s) => NP.toDisplayRate(s.up)));
      const sparkP = NP.charts.spark($('#kPing canvas'), NP.css('--good'), recent.slice(-40).map((s) => s.ping));
      NP.charts.spark($('#kData canvas'), NP.css('--link'), usage.map((b) => b.observed === false ? null : (b.down + b.up) / 1024 ** 3));

      /* live chart */
      const capVal = () => (basis() ? NP.toDisplayRate(basis().down) : null);
      const chart = NP.charts.line($('#liveChart'), {
        labels: recent.map((s) => NP.fmtTime(s.ts)),
        series: [
          { label: 'Download', color: down, data: recent.map((s) => NP.toDisplayRate(s.down)) },
          { label: 'Upload', color: up, data: recent.map((s) => NP.toDisplayRate(s.up)) },
          { label: NP.t('Mức tối đa'), color: cap, data: [], fill: false, dash: [6, 5], width: 1.5 },
        ],
        yTitle: NP.rateUnitLabel(),
        tooltipValue: (v) => `${(+v).toFixed(v >= 100 ? 0 : 2)} ${NP.rateUnitLabel()}`,
      });
      $('#capToggle').addEventListener('change', (e) => {
        const on = e.target.checked && capVal() != null;
        if (e.target.checked && capVal() == null) NP.toast(NP.t('Chưa có mức tối đa — hãy chạy Speed test trong Công cụ mạng'), 'warn');
        chart.data.datasets[2].data = on ? chart.data.labels.map(() => capVal()) : [];
        chart.data.datasets[2].label = basis()?.label || NP.t('Mức tối đa');
        $('#capLegendTxt').textContent = basis()?.label || '';
        $('#capLegend').style.display = on ? '' : 'none';
        chart.update();
      });

      /* connection card (Wi-Fi or wired) */
      const drawConn = () => {
        if (wifi.connected) {
          const std = (wifi.standard || '').match(/^(Wi-Fi \d+)/);
          $('#wifiBody').innerHTML = `
            <div class="wifi-hero" style="gap:16px">
              <div class="wifi-radar" style="width:88px;height:88px"><div class="ring"></div><div class="ring" style="inset:14px"></div><div class="ring" style="inset:28px"></div><div class="sweep"></div><div class="core" style="inset:32px">${NP.icon('wifi')}</div></div>
              <div style="min-width:0">
                <div class="ssid" style="font-size:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${NP.esc(wifi.ssid || NP.t('(ẩn — cần quyền Location)'))}</div>
                <div class="row-flex" style="margin-top:4px"><span id="wBars">${NP.signalHTML(wifi.signal)}</span><span class="mono txt-2" style="font-size:12px"><span id="wSig">${NP.num(wifi.signal)}</span>% · ${NP.num(wifi.rssi)} dBm</span></div>
                <div class="meta">${wifi.band ? `<span class="badge info">${wifi.band}</span>` : ''}${std ? `<span class="badge violet">${std[1]}</span>` : ''}${wifi.channel ? `<span class="badge">CH ${wifi.channel}</span>` : ''}</div>
              </div>
            </div>
            <div class="mini-stats" style="margin-top:14px">
              <div class="mini-stat"><div class="k">Link ↓</div><div class="v">${NP.num(wifi.rxRate)}<small>Mbps</small></div></div>
              <div class="mini-stat"><div class="k">Link ↑</div><div class="v">${NP.num(wifi.txRate)}<small>Mbps</small></div></div>
              <div class="mini-stat"><div class="k">${NP.t('Đã kết nối')}</div><div class="v" style="font-size:15px" id="wUp">—</div></div>
            </div>`;
        } else if (network.interfaceName) {
          $('#wifiBody').innerHTML = `
            <div class="wifi-hero" style="gap:16px">
              <div class="wifi-radar" style="width:88px;height:88px"><div class="ring"></div><div class="ring" style="inset:14px"></div><div class="ring" style="inset:28px"></div><div class="core" style="inset:32px">${NP.icon('plug')}</div></div>
              <div style="min-width:0"><div class="ssid" style="font-size:19px">${NP.esc(network.interfaceName)}</div>
                <div class="muted" style="font-size:12px">${NP.esc(network.adapter || '')}</div>
                <div class="meta"><span class="badge info">${network.interfaceType === 'ethernet' ? NP.t('Có dây') : NP.esc(network.interfaceType)}</span></div></div>
            </div>
            <div class="mini-stats" style="margin-top:14px;grid-template-columns:1fr 1fr">
              <div class="mini-stat"><div class="k">${NP.t('Tốc độ liên kết')}</div><div class="v">${network.linkSpeed ? NP.fmtRate(network.linkSpeed, { unit: 'bits' }).text : '—'}</div></div>
              <div class="mini-stat"><div class="k">IPv4</div><div class="v mono" style="font-size:14px">${NP.esc(network.ipv4 || '—')}</div></div>
            </div>`;
        } else {
          $('#wifiBody').innerHTML = NP.emptyHTML('wifiOff', NP.t('Không có kết nối mạng nào đang hoạt động'));
        }
      };
      drawConn();

      /* 24h usage */
      const GBf = (b) => b / 1024 ** 3;
      const usageChart = NP.charts.bar($('#usage24'), {
        labels: usage.map((b) => b.label),
        series: [
          { label: 'Download', color: down, data: usage.map((b) => b.observed === false ? null : GBf(b.down)) },
          { label: 'Upload', color: up, data: usage.map((b) => b.observed === false ? null : GBf(b.up)) },
        ],
        stacked: true, yTitle: 'GB',
        tooltipValue: (v) => v == null ? NP.t('Chưa đo') : NP.fmtBytes(v * 1024 ** 3).text,
      });

      /* events */
      const drawEvents = () => {
        $('#evList').innerHTML = events.length ? events.slice(0, 6).map((e) => `
          <div class="ev"><span class="dot ${e.level}">${NP.icon({ connect: 'link', disconnect: 'unlink', roam: 'radio', high_latency: 'timer', packet_loss: 'alert', signal_drop: 'wifi', ip_change: 'hash', dns_change: 'server', speedtest: 'gauge', usage_alert: 'database', agent: 'cpu' }[e.type] || 'info')}</span>
            <div style="min-width:0"><div class="t">${NP.esc(e.title)}</div><div class="d" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${NP.esc(e.detail)}">${NP.esc(e.detail)}</div></div>
            <span class="time">${NP.timeAgo(e.ts)}</span></div>`).join('') : NP.emptyHTML('bell', NP.t('Chưa có sự kiện'));
      };
      drawEvents();
      const offEv = NP.bus.on('events', (list) => { events = [...list, ...events]; drawEvents(); });

      const yesterday = month[month.length - 2];

      const quality = () => {
        const w = buf.slice(-60);
        if (!w.length) return null;
        const ok = w.filter((s) => s.ping != null);
        const loss = ((w.length - ok.length) / w.length) * 100;
        if (!ok.length) return { avg: null, jit: null, loss, score: 0 };
        const avg = ok.reduce((a, s) => a + s.ping, 0) / ok.length;
        const jit = ok.reduce((a, s) => a + (s.jitter || 0), 0) / ok.length;
        const score = Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, avg - 20) * 0.4 - jit * 1.5 - loss * 8)));
        return { avg, jit, loss, score };
      };

      const util = (s) => {
        const b = basis();
        $('#utilSub').textContent = b ? NP.t('So với {x}', { x: NP.lcFirst(b.label) }) : NP.t('Chưa xác định được mức tối đa');
        if (!b) {
          $('#utilPct').textContent = '—';
          $('#utilMeters').innerHTML = `<div class="note">${NP.icon('info')}<span>${NP.t('Chạy <a href="#/tools">Speed test</a> để biết tốc độ Internet tối đa, hoặc nhập gói cước trong <a href="#/settings">Cài đặt</a>.')}</span></div>`;
          return;
        }
        const uPct = (s.down / b.down) * 100;
        $('#utilPct').textContent = uPct.toFixed(uPct < 10 ? 1 : 0);
        NP.charts.setGauge($('#utilGauge'), uPct, uPct > 85 ? NP.css('--crit') : uPct > 60 ? NP.css('--warn') : down);
        const planD = NP.settings.planDownMbps * 1e6;
        const linkD = wifi.connected && wifi.rxRate ? wifi.rxRate * 1e6 : network.linkSpeed;
        let html =
          NP.meter(`↓ / ${b.label}`, `<b>${NP.fmtRate(s.down).text}</b> / ${NP.fmtRate(b.down).text}`, uPct, down) +
          NP.meter(`↑ / ${b.label}`, `<b>${NP.fmtRate(s.up).text}</b> / ${NP.fmtRate(b.up).text}`, (s.up / b.up) * 100, up);
        if (b.source !== 'link' && linkD) html += NP.meter(`↓ / ${NP.t('Tốc độ liên kết')}`, `<b>${NP.fmtRate(s.down).text}</b> / ${NP.fmtRate(linkD).text}`, (s.down / linkD) * 100, NP.css('--link'));
        if (capacity && planD) html += NP.meter(NP.t('Internet đo / Gói cước'), `<b>${NP.fmtRate(capacity.down).text}</b> / ${NP.fmtRate(planD).text}`, (capacity.down / planD) * 100, NP.css('--good'));
        if (b.source !== 'speedtest') html += `<div class="note" style="margin-top:10px">${NP.icon('info')}<span>${NP.t('Chưa có kết quả speed test — đang so với {x}.', { x: NP.lcFirst(b.label) })} <a href="#/tools">${NP.t('Đo ngay')}</a></span></div>`;
        else html += `<div class="muted" style="font-size:11.5px;margin-top:8px">${NP.t('Speed test gần nhất:')} ${NP.timeAgo(capacity.ts)}</div>`;
        $('#utilMeters').innerHTML = html;
      };

      let tickN = 0;
      const update = (s) => {
        $('#kDown .num').textContent = NP.fmtRate(s.down, { fixed: NP.rateUnitLabel() }).value;
        $('#kUp .num').textContent = NP.fmtRate(s.up, { fixed: NP.rateUnitLabel() }).value;
        const w15 = buf.slice(-900);
        $('#kDownPeak').textContent = NP.fmtRate(Math.max(0, ...w15.map((x) => x.down))).text;
        $('#kUpPeak').textContent = NP.fmtRate(Math.max(0, ...w15.map((x) => x.up))).text;

        const today = (s.todayDown + s.todayUp) / 1024 ** 3;
        $('#kData .num').textContent = today.toFixed(today < 10 ? 2 : 1);
        const yd = yesterday ? (yesterday.down + yesterday.up) / 1024 ** 3 : 0;
        if (yd > 0.01) {
          const pct = ((today - yd) / yd) * 100;
          $('#kDataFoot').innerHTML = `<span class="delta ${pct > 0 ? 'neg' : 'pos'}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span> ${NP.t('so với dữ liệu đã đo hôm qua')}`;
        } else {
          $('#kDataFoot').innerHTML = `↓ ${NP.fmtBytes(s.todayDown).text} · ↑ ${NP.fmtBytes(s.todayUp).text}`;
        }

        $('#kPing .num').textContent = s.ping == null ? '—' : s.ping.toFixed(s.ping < 10 ? 1 : 0);
        $('#kJitter').textContent = NP.num(s.jitter, 1, ' ms');
        const tone = s.ping == null ? 'crit' : NP.pingTone(s.ping);
        const tEl = $('#kPingTone'); tEl.className = 'badge ' + tone; tEl.textContent = s.ping == null ? NP.t('Mất gói') : NP.toneLabel[tone];

        util(s);

        const sess = NP.fmtBytes(s.sessionDown + s.sessionUp);
        $('#sessData').innerHTML = `${sess.value}<small>${sess.unit}</small>`;
        const mt = NP.fmtBytes(s.monthDown + s.monthUp);
        $('#monthData').innerHTML = `${mt.value}<small>${mt.unit}</small>`;
        const capGB = NP.settings.monthlyCapGB;
        const usedGB = (s.monthDown + s.monthUp) / 1024 ** 3;
        $('#capMeter').innerHTML = capGB
          ? NP.meter(NP.t('Hạn mức tháng (đã đo)'), `<b>${usedGB.toFixed(1)} GB</b> / ${capGB} GB`, (usedGB / capGB) * 100, usedGB / capGB > 0.9 ? NP.css('--crit') : NP.css('--link'))
          : `<div class="note">${NP.icon('info')}<span>${NP.t('Chưa đặt hạn mức dung lượng tháng. Bạn có thể đặt trong <a href="#/settings">Cài đặt</a> để nhận cảnh báo khi sắp vượt.')}</span></div>`;

        if (wifi.connected) {
          const wUp = $('#wUp');
          if (wUp && wifi.connectedSince) wUp.textContent = NP.fmtDuration((Date.now() - wifi.connectedSince) / 1000);
          if (s.signal != null && $('#wSig')) { $('#wSig').textContent = s.signal; $('#wBars').innerHTML = NP.signalHTML(s.signal); }
        }

        if (tickN++ % 5 === 0) {
          const q = quality();
          if (q) {
            NP.countUp($('#qScore'), q.score);
            NP.charts.setRing($('#qRing'), q.score, q.score >= 80 ? NP.css('--good') : q.score >= 60 ? NP.css('--warn') : NP.css('--crit'));
            const row = (k, v, tone) => `<div class="row-flex" style="justify-content:space-between;font-size:12.5px"><span class="txt-2">${k}</span><span class="row-flex" style="gap:6px"><b class="mono">${v}</b>${tone ? `<span class="badge ${tone}" style="font-size:10px">${NP.toneLabel[tone]}</span>` : ''}</span></div>`;
            $('#qList').innerHTML =
              row(NP.t('Ping TB'), NP.num(q.avg, 0, ' ms'), q.avg == null ? 'crit' : NP.pingTone(q.avg)) +
              row('Jitter', NP.num(q.jit, 1, ' ms'), q.jit == null ? null : q.jit < 5 ? 'good' : q.jit < 15 ? 'warn' : 'crit') +
              row(NP.t('Mất gói'), `${q.loss.toFixed(1)}%`, q.loss < NP.settings.lossWarn ? 'good' : q.loss < 5 ? 'warn' : 'crit') +
              row(NP.t('Tín hiệu'), s.signal == null ? '—' : `${s.signal}%`, s.signal == null ? null : NP.signalTone(s.signal));
          }
        }

        NP.charts.push(chart, NP.fmtTime(s.ts), [NP.toDisplayRate(s.down), NP.toDisplayRate(s.up), $('#capToggle').checked && capVal() != null ? capVal() : undefined], N);
        NP.charts.push(sparkD, '', [NP.toDisplayRate(s.down)], 40);
        NP.charts.push(sparkU, '', [NP.toDisplayRate(s.up)], 40);
        NP.charts.push(sparkP, '', [s.ping], 40);
      };
      if (NP.live.last) update(NP.live.last);
      const off = NP.live.subscribe(update);

      // slow refresh: connection details, capacity (after a speed test), hourly usage
      const slow = setInterval(async () => {
        try {
          [wifi, network, capacity] = await Promise.all([NP.api.getWifi(), NP.api.getNetwork(), NP.api.getCapacity()]);
          if (!root.isConnected) return;
          drawConn();
          const u = await NP.api.getUsage('24h');
          usageChart.data.labels = u.map((b) => b.label);
          usageChart.data.datasets[0].data = u.map((b) => b.observed === false ? null : GBf(b.down));
          usageChart.data.datasets[1].data = u.map((b) => b.observed === false ? null : GBf(b.up));
          usageChart.update('none');
        } catch { /* agent offline — the bar shows it */ }
      }, 30000);
      return () => { off(); offEv(); clearInterval(slow); };
    },
  };
})();
