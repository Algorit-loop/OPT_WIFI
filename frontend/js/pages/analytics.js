/* Thống kê & Xu hướng — consumption per hour/day/month, heatmap, speed-test history, insights */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};
  const GB = 1024 ** 3;
  const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const RANGE_LABEL = { '24h': '24 giờ qua', '7d': '7 ngày qua', '30d': '30 ngày qua', '12m': '12 tháng qua' };
  const day = (d) => NP.t(DAYS[d]);
  const rangeLabel = (r) => NP.t(RANGE_LABEL[r]);
  // bucket labels come from the agent: "T3/26" = month 3 of 2026
  const bucketLabel = (l) => (NP.lang === 'en' ? String(l).replace(/^T(\d+)\/(\d+)$/, (_, m, y) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} '${y}`) : l);

  const kpi = (id, tone, icon, label) => `
    <div class="card lift kpi tone-${tone} c-3" id="${id}" style="min-height:112px">
      <div class="kpi-top"><span class="ico">${NP.icon(icon)}</span>${label}</div>
      <div class="kpi-val"><span class="num">0</span><span class="unit"></span></div>
      <div class="kpi-foot"></div>
    </div>`;

  NP.pages.analytics = {
    title: 'Thống kê & Xu hướng',
    sub: 'Chỉ tính dữ liệu trong lúc agent chạy; khoảng không đo được để trống',
    render() {
      return `
      <div class="row-flex reveal" style="margin-bottom:18px">
        ${NP.seg('anRange', [['24h', NP.t('24 giờ')], ['7d', NP.t('7 ngày')], ['30d', NP.t('30 ngày')], ['12m', NP.t('12 tháng')]], '7d')}
        <span class="spacer"></span>
        <button class="btn sm" id="anExport">${NP.icon('download')}${NP.t('Xuất CSV')}</button>
      </div>
      <div class="grid">
        ${kpi('aDown', 'down', 'down', NP.t('Tổng download'))}
        ${kpi('aUp', 'up', 'up', NP.t('Tổng upload'))}
        ${kpi('aAvg', 'violet', 'activity', NP.t('Tốc độ trung bình'))}
        ${kpi('aPeak', 'warn', 'zap', NP.t('Tốc độ cao nhất'))}

        <div class="card c-8">
          ${NP.cardHead(NP.t('Dung lượng tiêu thụ'), {
            icon: 'chart', sub: '<span id="anSub"></span>',
            right: `<div class="legend"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span></div>${NP.seg('anMode', [['stack', NP.t('Chồng')], ['group', NP.t('Nhóm')]], 'stack')}`,
          })}
          <div class="chart-box h-320"><canvas id="anChart"></canvas></div>
        </div>
        <div class="card c-4">
          ${NP.cardHead(NP.t('Nhận định nhanh'), { icon: 'sparkles', sub: NP.t('Tự động tính từ dữ liệu') })}
          <div id="anInsights"></div>
        </div>

        <div class="card c-8">
          ${NP.cardHead(NP.t('Bản đồ nhiệt sử dụng'), {
            icon: 'calendar', sub: NP.t('Trung bình theo giờ trong tuần (4 tuần gần nhất) · ô xám là chưa đo'),
            right: '<div class="heat-scale" id="heatScale"></div>',
          })}
          <div class="heatmap" id="heat"></div>
        </div>
        <div class="card c-4">
          ${NP.cardHead(NP.t('Lịch sử Speed test'), {
            icon: 'gauge', sub: NP.t('Tốc độ Internet đo được theo thời gian'),
          })}
          <div class="legend" style="margin-bottom:8px"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span><span id="stPlanLg"><i class="dash" style="color:var(--good)"></i>${NP.t('Gói cước')}</span></div>
          <div class="chart-box h-240"><canvas id="stChart"></canvas></div>
          <div id="stTable" style="margin-top:10px"></div>
        </div>

        <div class="card c-12">
          ${NP.cardHead(NP.t('Bảng dữ liệu'), { icon: 'list', sub: NP.t('Chi tiết theo từng khoảng') })}
          <div class="table-wrap tbl-scroll" style="max-height:360px"><table class="tbl">
            <thead><tr><th>${NP.t('Khoảng')}</th><th class="num">Download</th><th class="num">Upload</th><th class="num">${NP.t('Tổng')}</th><th class="num">${NP.t('Tốc độ TB')}</th><th class="num">${NP.t('Tốc độ cao nhất')}</th><th style="width:30%">${NP.t('Tỷ trọng')}</th></tr></thead>
            <tbody id="anTable"></tbody></table></div>
        </div>
      </div>`;
    },

    async mount(root) {
      const $ = (s) => root.querySelector(s);
      const down = NP.css('--down'), up = NP.css('--up');
      let range = '7d', mode = 'stack', data = [], chart = null;

      const setKpi = (id, value, digits, unit, foot) => {
        NP.countUp($(`#${id} .num`), value, { digits });
        $(`#${id} .unit`).textContent = unit;
        $(`#${id} .kpi-foot`).innerHTML = foot;
      };

      const drawChart = () => {
        if (chart) chart.destroy();
        chart = NP.charts.bar($('#anChart'), {
          labels: data.map((b) => bucketLabel(b.label)),
          series: [
            { label: 'Download', color: down, data: data.map((b) => b.observed === false ? null : b.down / GB) },
            { label: 'Upload', color: up, data: data.map((b) => b.observed === false ? null : b.up / GB) },
          ],
          stacked: mode === 'stack', yTitle: 'GB', tooltipValue: (v) => v == null ? NP.t('Chưa đo') : NP.fmtBytes(v * GB).text,
        });
      };

      const load = async () => {
        data = await NP.api.getUsage(range);
        if (!root.isConnected) return;
        const tD = data.reduce((a, b) => a + b.down, 0), tU = data.reduce((a, b) => a + b.up, 0);
        const peakB = data.reduce((m, b) => (b.peak > m.peak ? b : m), data[0]);
        const fd = NP.fmtBytes(tD), fu = NP.fmtBytes(tU);
        setKpi('aDown', +fd.value, 1, fd.unit, rangeLabel(range));
        setKpi('aUp', +fu.value, 1, fu.unit, tD ? `${NP.t('Tỷ lệ ↑/↓:')} <b class="mono">${((tU / tD) * 100).toFixed(1)}%</b>` : rangeLabel(range));
        const act = data.filter((b) => b.avg > 0);
        const avgA = act.length ? act.reduce((a, b) => a + b.avg, 0) / act.length : 0;
        const fa = NP.fmtRate(avgA, { fixed: NP.rateUnitLabel() });
        setKpi('aAvg', +fa.value, 1, fa.unit, NP.t('Trung bình khi có lưu lượng (> 0.2 Mbps)'));
        const fp = NP.fmtRate(peakB.peak, { fixed: NP.rateUnitLabel() });
        setKpi('aPeak', +fp.value, 0, fp.unit, peakB.peak ? `${NP.t('Lúc')} <b class="mono">${bucketLabel(peakB.label)}</b>` : NP.t('Chưa có dữ liệu'));
        $('#anSub').textContent = rangeLabel(range);
        drawChart();

        // Empty periods are unknown, not zero usage. Observed zero-traffic periods remain valid.
        const totals = data.map((b) => b.down + b.up);
        const measured = data.map((b, i) => b.observed === false ? null : i).filter((i) => i != null);
        const measuredTotals = measured.map((i) => totals[i]);
        const item = (icon, color, title, text) => `<div class="ev" style="grid-template-columns:30px 1fr"><span class="dot" style="background:${NP.alpha(color, 0.12)};color:${color}">${NP.icon(icon)}</span><div><div class="t">${title}</div><div class="d">${text}</div></div></div>`;
        if (measured.length < 2) {
          $('#anInsights').innerHTML = `<div class="timeline">${item('clock', NP.css('--accent'), NP.t('Đang thu thập dữ liệu'),
            NP.t({ '24h': 'Agent ghi lưu lượng mỗi phút. Cần dữ liệu ở ít nhất 2 giờ để phân tích xu hướng.', '12m': 'Agent ghi lưu lượng mỗi phút. Cần dữ liệu ở ít nhất 2 tháng để phân tích xu hướng.' }[range] || 'Agent ghi lưu lượng mỗi phút. Cần dữ liệu ở ít nhất 2 ngày để phân tích xu hướng.'))}</div>`;
        } else {
          const maxI = measured.reduce((best, i) => totals[i] > totals[best] ? i : best);
          const minI = measured.reduce((best, i) => totals[i] < totals[best] ? i : best);
          const mean = measuredTotals.reduce((a, b) => a + b, 0) / measuredTotals.length;
          const half = Math.floor(measuredTotals.length / 2);
          const first = measuredTotals.slice(0, half).reduce((a, b) => a + b, 0) / half;
          const second = measuredTotals.slice(half).reduce((a, b) => a + b, 0) / (measuredTotals.length - half);
          const trend = first > 0 ? ((second - first) / first) * 100 : null;
          const unitWord = NP.t({ '24h': 'giờ', '7d': 'ngày', '30d': 'ngày', '12m': 'tháng' }[range]);
          $('#anInsights').innerHTML = `<div class="timeline">` +
            (trend == null ? '' : item('trend', trend > 0 ? NP.css('--warn') : NP.css('--good'), NP.t(trend >= 0 ? 'Lưu lượng ghi nhận tăng {p}%' : 'Lưu lượng ghi nhận giảm {p}%', { p: Math.abs(trend).toFixed(0) }), NP.t('So sánh hai nửa của {n} {u} có đo.', { n: measured.length, u: unitWord }))) +
            item('zap', NP.css('--accent'), `${NP.t('Cao nhất:')} ${bucketLabel(data[maxI].label)}`, NP.t('Đã ghi {x} trong khoảng có đo.', { x: NP.fmtBytes(totals[maxI]).text })) +
            item('moon', NP.css('--link'), `${NP.t('Thấp nhất:')} ${bucketLabel(data[minI].label)}`, NP.t('Đã ghi {x} trong khoảng có đo.', { x: NP.fmtBytes(totals[minI]).text })) +
            item('database', NP.css('--up'), NP.t('Trung bình {x}/{u} có đo', { x: NP.fmtBytes(mean).text, u: unitWord }), NP.t('Tổng {x}; {n} khoảng không có dữ liệu. Khoảng có đo cũng có thể chưa đủ thời gian.', { x: NP.fmtBytes(tD + tU).text, n: data.length - measured.length })) +
            `</div>`;
        }

        // table
        const maxT = Math.max(1, ...totals);
        $('#anTable').innerHTML = data.slice().reverse().map((b) => {
          if (b.observed === false) return `<tr><td><b>${bucketLabel(b.label)}</b></td><td colspan="6" class="txt-2">${NP.t('Không có dữ liệu: agent không chạy hoặc chưa đo')}</td></tr>`;
          const t = b.down + b.up;
          return `<tr><td><b>${bucketLabel(b.label)}</b></td><td class="num">${NP.fmtBytes(b.down).text}</td><td class="num">${NP.fmtBytes(b.up).text}</td><td class="num"><b>${NP.fmtBytes(t).text}</b></td>
            <td class="num">${NP.fmtRate(b.avg).text}</td><td class="num">${NP.fmtRate(b.peak).text}</td>
            <td><div class="meter-track" style="height:6px;display:flex;gap:2px;background:none">
              <div style="height:100%;border-radius:4px;width:${(b.down / maxT) * 100}%;background:${down}"></div>
              <div style="height:100%;border-radius:4px;width:${(b.up / maxT) * 100}%;background:${up}"></div></div></td></tr>`;
        }).join('') || `<tr><td colspan="7">${NP.emptyHTML('database', NP.t('Chưa có dữ liệu trong khoảng này'))}</td></tr>`;
      };

      NP.bindSeg(root, 'anRange', (v) => { range = v; load(); });
      NP.bindSeg(root, 'anMode', (v) => { mode = v; drawChart(); });
      $('#anExport').addEventListener('click', () => {
        const rows = [['period_start', 'label', 'observed', 'download_bytes', 'upload_bytes', 'avg_bps', 'peak_bps'], ...data.map((b) => [new Date(b.ts).toISOString(), b.label, b.observed !== false, ...(b.observed === false ? ['', '', '', ''] : [Math.round(b.down), Math.round(b.up), Math.round(b.avg), Math.round(b.peak)])])];
        const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `netpulse-usage-${range}.csv`; a.click();
        URL.revokeObjectURL(a.href);
        NP.toast(NP.t('Đã xuất file CSV'), 'good');
      });

      /* heatmap — sequential single hue */
      const hm = await NP.api.getHeatmap();
      const max = Math.max(1, ...hm.flat().filter((v) => v != null));
      const accent = NP.css('--accent');
      const cell = (v) => v == null ? 'var(--panel-solid)' : NP.alpha(accent, 0.06 + (v / max) * 0.88);
      let html = '<div></div>' + Array.from({ length: 24 }, (_, h) => `<div class="hh">${h % 3 === 0 ? h : ''}</div>`).join('');
      hm.forEach((row, d) => {
        html += `<div class="hl">${day(d)}</div>` + row.map((v, h) => `<div class="cell" style="background:${cell(v)}" title="${day(d)} ${NP.pad(h)}:00–${NP.pad(h)}:59 · ${v == null ? NP.t('chưa đo') : NP.t('trung bình') + ' ' + NP.fmtBytes(v).text}"></div>`).join('');
      });
      $('#heat').innerHTML = html;
      $('#heatScale').innerHTML = NP.t('Ít') + [0.1, 0.3, 0.5, 0.7, 0.95].map((p) => `<span style="background:${NP.alpha(accent, 0.06 + p * 0.88)}"></span>`).join('') + NP.t('Nhiều');

      /* speed test history */
      const st = await NP.api.getSpeedHistory();
      if (!root.isConnected) return;
      const plan = NP.settings.planDownMbps;
      if (!plan) $('#stPlanLg').style.display = 'none';
      if (!st.length) {
        $('#stChart').parentNode.innerHTML = NP.emptyHTML('gauge', NP.t('Chưa có lần speed test nào.<br><a href="#/tools">Chạy speed test</a> hoặc bật đo tự động trong Cài đặt.'));
      } else NP.charts.line($('#stChart'), {
        labels: st.map((x) => NP.fmtDateTime(x.ts).slice(0, 5)),
        series: [
          { label: 'Download', color: down, data: st.map((x) => NP.toDisplayRate(x.down)), alpha: 0.18 },
          { label: 'Upload', color: up, data: st.map((x) => NP.toDisplayRate(x.up)), alpha: 0.14 },
          ...(plan ? [{ label: NP.t('Gói cước'), color: NP.css('--good'), data: st.map(() => NP.toDisplayRate(plan * 1e6)), fill: false, dash: [6, 5], width: 1.5 }] : []),
        ],
        yTitle: NP.rateUnitLabel(), tooltipValue: (v) => `${(+v).toFixed(0)} ${NP.rateUnitLabel()}`,
        tooltipTitle: (p) => NP.fmtDateTime(st[p[0].dataIndex].ts),
      });

      await load();
    },
  };
})();
