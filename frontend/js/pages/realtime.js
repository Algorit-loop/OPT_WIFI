/* Thời gian thực — live traffic with selectable window, utilization gauges, live signal & ping */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};

  NP.pages.realtime = {
    title: 'Thời gian thực',
    sub: 'Lưu lượng mạng theo từng giây, so sánh với khả năng tối đa',
    render() {
      const u = NP.rateUnitLabel();
      return `
      <div class="grid">
        <div class="card c-12">
          ${NP.cardHead(NP.t('Lưu lượng mạng'), {
            icon: 'activity', sub: `<span class="row-flex" style="gap:6px"><span class="live-dot" id="rtDot"></span><span id="rtState">${NP.t('Đang ghi nhận')}</span></span>`,
            right: `<div class="legend"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span><span id="rtCapLg" style="display:none"><i class="dash" style="color:var(--cap)"></i><span id="rtCapTxt">${NP.t('Mức tối đa')} ↓</span></span></div>
              <label class="row-flex muted" style="font-size:12px;gap:8px;cursor:pointer">${NP.t('Mức tối đa')}<span class="switch"><input type="checkbox" id="rtCap"><span class="sl"></span></span></label>
              ${NP.seg('rtWin', [['60', NP.t('60 giây')], ['300', NP.t('5 phút')], ['900', NP.t('15 phút')]], '300')}`,
          })}
          <div class="chart-box h-360"><canvas id="rtChart"></canvas></div>
        </div>

        <div class="card lift c-3">
          ${NP.cardHead('Download', { icon: 'down', sub: '<span class="gSub">—</span>' })}
          <div class="gauge-wrap" id="gDown">${NP.charts.gaugeSVG()}
            <div class="gauge-center"><div class="big" id="gDownV">0</div><div class="small">${u}</div></div></div>
        </div>
        <div class="card lift c-3">
          ${NP.cardHead('Upload', { icon: 'up', sub: '<span class="gSub">—</span>' })}
          <div class="gauge-wrap" id="gUp">${NP.charts.gaugeSVG()}
            <div class="gauge-center"><div class="big" id="gUpV">0</div><div class="small">${u}</div></div></div>
        </div>
        <div class="card c-6">
          ${NP.cardHead(NP.t('Thống kê trong cửa sổ'), { icon: 'layers', sub: NP.t('Theo khoảng thời gian đang chọn') })}
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th></th><th class="num">${NP.t('Hiện tại')}</th><th class="num">${NP.t('Trung bình')}</th><th class="num">${NP.t('Cao nhất')}</th><th class="num">${NP.t('Thấp nhất')}</th><th class="num">${NP.t('Đã truyền')}</th></tr></thead>
            <tbody id="rtStats"></tbody></table></div>
        </div>

        <div class="card c-12">
          ${NP.cardHead(NP.t('Ba loại "tốc độ" khác nhau'), { icon: 'info', sub: NP.t('Vì sao con số đang dùng thường nhỏ hơn nhiều so với tốc độ Wi-Fi hiển thị') })}
          <div class="grid" id="threeSpeeds" style="gap:14px"></div>
        </div>

        <div class="card c-6">
          ${NP.cardHead(NP.t('Cường độ tín hiệu'), { icon: 'wifi', sub: NP.t('Phần trăm chất lượng tín hiệu Wi-Fi'), right: '<span class="mono txt-2" id="rtSig">—</span>' })}
          <div class="chart-box h-200"><canvas id="rtSigChart"></canvas></div>
        </div>
        <div class="card c-6">
          ${NP.cardHead(NP.t('Độ trễ (Ping)'), { icon: 'timer', sub: NP.t('Tới {x}', { x: NP.esc(NP.settings.pingTarget) }), right: '<span class="mono txt-2" id="rtPing">—</span>' })}
          <div class="chart-box h-200"><canvas id="rtPingChart"></canvas></div>
        </div>
      </div>`;
    },

    async mount(root) {
      const $ = (s) => root.querySelector(s);
      const down = NP.css('--down'), up = NP.css('--up'), cap = NP.css('--cap');
      const [capacity, wifi, network] = await Promise.all([NP.api.getCapacity(), NP.api.getWifi(), NP.api.getNetwork()]);
      if (!root.isConnected) return;
      let win = 300;
      const unit = NP.rateUnitLabel();
      const basis = NP.capacityBasis(capacity, wifi, network);
      const capV = basis ? NP.toDisplayRate(basis.down) : null;
      root.querySelectorAll('.gSub').forEach((el) => (el.textContent = basis ? `% ${NP.lcFirst(basis.label)}` : NP.t('Chưa có mức tối đa')));
      $('#rtCapTxt').textContent = basis ? `${basis.label} ↓` : '';

      const slice = () => NP.live.buffer.slice(-win);
      const fmtV = (v) => `${(+v).toFixed(v >= 100 ? 0 : 2)} ${unit}`;

      const chart = NP.charts.line($('#rtChart'), {
        labels: [], series: [
          { label: 'Download', color: down, data: [] },
          { label: 'Upload', color: up, data: [] },
          { label: basis ? basis.label : NP.t('Mức tối đa'), color: cap, data: [], fill: false, dash: [6, 5], width: 1.5 },
        ],
        yTitle: unit, tooltipValue: fmtV,
      });
      const sigChart = NP.charts.line($('#rtSigChart'), {
        labels: [], series: [{ label: NP.t('Tín hiệu'), color: NP.css('--good'), data: [] }], spanGaps: false,
        yTitle: '%', tooltipValue: (v) => `${v}%`, scales: { y: { min: 0, max: 100 } },
      });
      const pingChart = NP.charts.line($('#rtPingChart'), {
        labels: [], series: [{ label: 'Ping', color: NP.css('--accent-2') || '#818cf8', data: [] }], spanGaps: false,
        yTitle: 'ms', tooltipValue: (v) => `${v} ms`,
      });

      const reload = () => {
        const s = slice();
        const labels = s.map((x) => NP.fmtTime(x.ts));
        chart.data.labels = labels;
        chart.data.datasets[0].data = s.map((x) => NP.toDisplayRate(x.down));
        chart.data.datasets[1].data = s.map((x) => NP.toDisplayRate(x.up));
        chart.data.datasets[2].data = $('#rtCap').checked && capV != null ? s.map(() => capV) : [];
        chart.update('none');
        const s2 = NP.live.buffer.slice(-120);
        sigChart.data.labels = s2.map((x) => NP.fmtTime(x.ts)); sigChart.data.datasets[0].data = s2.map((x) => x.signal); sigChart.update('none');
        pingChart.data.labels = s2.map((x) => NP.fmtTime(x.ts)); pingChart.data.datasets[0].data = s2.map((x) => x.ping); pingChart.update('none');
      };

      NP.bindSeg(root, 'rtWin', (v) => { win = +v; reload(); });
      $('#rtCap').addEventListener('change', (e) => {
        if (e.target.checked && capV == null) NP.toast(NP.t('Chưa có mức tối đa — hãy chạy Speed test trong Công cụ mạng'), 'warn');
        $('#rtCapLg').style.display = e.target.checked && capV != null ? '' : 'none';
        reload();
      });

      const stats = () => {
        const s = slice();
        if (!s.length) return;
        const row = (name, key, color) => {
          const arr = s.map((x) => x[key]);
          const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
          // bytes = rate × time between consecutive samples
          let bytes = 0;
          for (let i = 1; i < s.length; i++) bytes += (s[i][key] / 8) * Math.min(10, (s[i].ts - s[i - 1].ts) / 1000);
          return `<tr><td><span class="row-flex" style="gap:8px"><i style="width:9px;height:9px;border-radius:3px;background:${color}"></i>${name}</span></td>
            <td class="num">${NP.fmtRate(arr.at(-1)).text}</td><td class="num">${NP.fmtRate(avg).text}</td>
            <td class="num">${NP.fmtRate(Math.max(...arr)).text}</td><td class="num">${NP.fmtRate(Math.min(...arr)).text}</td>
            <td class="num">${NP.fmtBytes(bytes).text}</td></tr>`;
        };
        $('#rtStats').innerHTML = row('Download', 'down', down) + row('Upload', 'up', up);
      };

      const three = (s) => {
        const link = (wifi.connected && wifi.rxRate ? wifi.rxRate * 1e6 : network.linkSpeed) || 0;
        const ref = Math.max(link, capacity?.down || 0, s.down, 1);
        const card = (title, desc, val, pct, color, icon) => `
          <div class="c-4 mini-stat" style="padding:16px">
            <div class="row-flex" style="gap:8px;margin-bottom:6px"><span style="color:${color};display:inline-flex">${NP.icon(icon)}</span><b style="font-size:13px">${title}</b></div>
            <div class="v" style="font-size:24px">${val}</div>
            <div class="meter-track" style="margin:10px 0 8px;height:6px"><div class="meter-fill" style="--c:${color};width:${Math.max(1, pct)}%"></div></div>
            <div class="muted" style="font-size:12px">${desc}</div>
          </div>`;
        $('#threeSpeeds').innerHTML =
          card(NP.t('Đang sử dụng thực tế'), NP.t('Lưu lượng máy bạn đang thực sự tải xuống ngay lúc này.'), NP.fmtRate(s.down).text, (s.down / ref) * 100, down, 'activity') +
          (capacity
            ? card(NP.t('Internet đo được'), NP.t('Tốc độ tối đa tới Internet theo speed test gần nhất ({x}).', { x: NP.timeAgo(capacity.ts) }), NP.fmtRate(capacity.down).text, (capacity.down / ref) * 100, cap, 'globe')
            : card(NP.t('Internet đo được'), NP.t('Chưa có speed test. Vào <a href="#/tools">Công cụ mạng</a> để đo tốc độ Internet tối đa.'), '—', 0, cap, 'globe')) +
          card(wifi.connected ? NP.t('Liên kết Wi-Fi (link rate)') : NP.t('Tốc độ liên kết'), NP.t('Tốc độ giữa máy và router. Đây là trần lý thuyết, không phải tốc độ Internet.'), link ? NP.fmtRate(link).text : '—', link ? (link / ref) * 100 : 0, NP.css('--link'), wifi.connected ? 'wifi' : 'plug');
      };

      reload(); stats();
      if (NP.live.last) three(NP.live.last);
      let n = 0;
      const update = (s) => {
        NP.charts.push(chart, NP.fmtTime(s.ts), [NP.toDisplayRate(s.down), NP.toDisplayRate(s.up), $('#rtCap').checked && capV != null ? capV : undefined], win);
        NP.charts.push(sigChart, NP.fmtTime(s.ts), [s.signal], 120);
        NP.charts.push(pingChart, NP.fmtTime(s.ts), [s.ping], 120);
        const dp = basis ? (s.down / basis.down) * 100 : 0, upct = basis ? (s.up / basis.up) * 100 : 0;
        $('#gDownV').textContent = NP.toDisplayRate(s.down).toFixed(1);
        $('#gUpV').textContent = NP.toDisplayRate(s.up).toFixed(1);
        NP.charts.setGauge($('#gDown'), dp, down);
        NP.charts.setGauge($('#gUp'), upct, up);
        $('#rtSig').textContent = s.signal == null ? '—' : `${s.signal}%`;
        $('#rtPing').textContent = s.ping == null ? NP.t('mất gói') : `${s.ping} ms`;
        if (n++ % 2 === 0) { stats(); three(s); }
      };
      if (NP.live.last) update(NP.live.last);
      const off = NP.live.subscribe(update);
      const stateTimer = setInterval(() => {
        $('#rtDot').className = 'live-dot' + (NP.live.paused ? ' paused' : '');
        $('#rtState').textContent = NP.live.paused ? NP.t('Đã tạm dừng') : NP.t('Đang ghi nhận');
      }, 500);
      return () => { off(); clearInterval(stateTimer); };
    },
  };
})();
