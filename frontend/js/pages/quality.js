/* Chất lượng kết nối — ping/latency, jitter, packet loss, stability score, anomalies */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};

  const tile = (id, tone, icon, label, unit) => `
    <div class="card lift kpi tone-${tone} c-3" id="${id}" style="min-height:120px">
      <div class="kpi-top"><span class="ico">${NP.icon(icon)}</span>${label}</div>
      <div class="kpi-val"><span class="num">0</span><span class="unit">${unit}</span></div>
      <div class="kpi-foot"></div>
    </div>`;

  NP.pages.quality = {
    title: 'Chất lượng kết nối',
    sub: 'Ping, độ trễ, jitter, mất gói và độ ổn định',
    render() {
      return `
      <div class="row-flex reveal" style="margin-bottom:18px">
        ${NP.seg('qRange', [['1h', NP.t('1 giờ')], ['24h', NP.t('24 giờ')], ['7d', NP.t('7 ngày')]], '1h')}
        <span class="spacer"></span>
        <span class="muted" style="font-size:12px">${NP.t('Mục tiêu đo:')} <b class="mono txt-2">${NP.esc(NP.settings.pingTarget)}</b> · ${NP.t('Ngưỡng cảnh báo')} ${NP.settings.pingWarn}/${NP.settings.pingCrit} ms</span>
      </div>
      <div class="grid">
        <div class="card lift c-3" style="display:flex;align-items:center;gap:16px">
          <div class="ring-wrap" id="qsRing" style="width:110px;height:110px;flex-shrink:0">${NP.charts.ringSVG()}<div class="center"><b id="qsScore" style="font-size:28px">0</b></div></div>
          <div><div class="txt-2" style="font-size:12.5px">${NP.t('Điểm ổn định')}</div><div style="font-size:18px;font-weight:700" id="qsLabel">—</div><div class="muted" style="font-size:12px" id="qsUptime"></div></div>
        </div>
        ${tile('qPing', 'down', 'timer', NP.t('Ping trung bình'), 'ms')}
        ${tile('qJit', 'violet', 'activity', NP.t('Jitter trung bình'), 'ms')}
        ${tile('qLoss', 'warn', 'alert', NP.t('Tỷ lệ mất gói'), '%')}

        <div class="card c-8">
          ${NP.cardHead(NP.t('Độ trễ theo thời gian'), {
            icon: 'timer', sub: NP.t('Vùng tô: khoảng min–max · đường: trung bình'),
            right: `<div class="legend"><span><i class="line" style="background:var(--down)"></i>${NP.t('Trung bình')}</span><span><i style="background:var(--down);opacity:.3"></i>Min–Max</span><span><i class="dash" style="color:var(--warn)"></i>${NP.t('Cảnh báo')}</span><span><i class="dash" style="color:var(--crit)"></i>${NP.t('Nghiêm trọng')}</span></div>`,
          })}
          <div class="chart-box h-320"><canvas id="qChart"></canvas></div>
        </div>
        <div class="card c-4">
          ${NP.cardHead(NP.t('Đa mục tiêu'), { icon: 'target', sub: NP.t('Ping song song tới nhiều điểm'), right: `<button class="btn sm" id="tgRefresh">${NP.icon('refresh')}</button>` })}
          <div id="targets"></div>
          <div class="note" style="margin-top:12px">${NP.icon('info')}<span>${NP.t('Ping gateway cao → vấn đề trong Wi-Fi/LAN. Gateway thấp nhưng Internet cao → vấn đề phía nhà mạng.')}</span></div>
        </div>

        <div class="card c-6">
          ${NP.cardHead('Jitter', { icon: 'activity', sub: NP.t('Độ dao động độ trễ — quan trọng với gọi video & game') })}
          <div class="chart-box h-200"><canvas id="jChart"></canvas></div>
        </div>
        <div class="card c-6">
          ${NP.cardHead(NP.t('Mất gói'), { icon: 'alert', sub: NP.t('% gói tin bị mất theo khoảng') })}
          <div class="chart-box h-200"><canvas id="lChart"></canvas></div>
        </div>

        <div class="card c-12">
          ${NP.cardHead(NP.t('Bất thường phát hiện'), { icon: 'bell', sub: NP.t('Các thời điểm vượt ngưỡng trong khoảng đã chọn'), right: '<span class="badge" id="anCount">0</span>' })}
          <div class="table-wrap tbl-scroll" style="max-height:300px"><table class="tbl">
            <thead><tr><th>${NP.t('Thời điểm')}</th><th>${NP.t('Loại')}</th><th class="num">${NP.t('Ping TB')}</th><th class="num">Ping max</th><th class="num">Jitter</th><th class="num">${NP.t('Mất gói')}</th><th class="num">${NP.t('Tín hiệu')}</th><th>${NP.t('Mức độ')}</th></tr></thead>
            <tbody id="anBody"></tbody></table></div>
        </div>
      </div>`;
    },

    async mount(root) {
      const $ = (s) => root.querySelector(s);
      const S = NP.settings;
      let range = '1h', charts = [];

      const load = async () => {
        charts.forEach((c) => c.destroy()); charts = [];
        const h = await NP.api.getQuality(range);
        if (!root.isConnected) return;
        const fmtL = (ts) => (range === '7d' ? NP.fmtDateTime(ts).slice(0, 11) : NP.fmtTime(ts, false));
        const labels = h.map((x) => fmtL(x.ts));
        const meas = h.filter((x) => x.loss != null);           // buckets where the agent measured
        const okB = meas.filter((x) => x.avg != null);
        const mean = (arr, k) => (arr.length ? arr.reduce((a, x) => a + x[k], 0) / arr.length : null);
        const avg = mean(okB, 'avg');
        const jit = mean(okB.filter((x) => x.jitter != null), 'jitter');
        const loss = mean(meas, 'loss');
        const has = meas.length > 0;
        const score = has ? Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, (avg ?? 1000) - 20) * 0.4 - (jit || 0) * 1.5 - loss * 8))) : null;
        const sTone = score == null ? 'warn' : score >= 80 ? 'good' : score >= 60 ? 'warn' : 'crit';
        const stepSeconds = { '1h': 60, '24h': 900, '7d': 7200 }[range];
        const coverage = Math.round(Math.min(100, h.reduce((sum, x) => sum + (x.sent || 0), 0) * 100 / (h.length * stepSeconds)));

        if (score == null) {
          $('#qsScore').textContent = '—';
          NP.charts.setRing($('#qsRing'), 0, NP.css('--muted'));
          $('#qsLabel').textContent = NP.t('Chưa có dữ liệu');
          $('#qsUptime').textContent = NP.t('Agent chưa đo trong khoảng này');
        } else {
          NP.countUp($('#qsScore'), score);
          NP.charts.setRing($('#qsRing'), score, NP.css('--' + sTone));
          $('#qsLabel').textContent = NP.t({ good: 'Ổn định', warn: 'Chập chờn', crit: 'Không ổn định' }[sTone]);
          const down = meas.filter((x) => x.loss >= 50).length;
          $('#qsUptime').innerHTML = NP.t('Uptime lúc đo {u}% · đo {c}% thời gian', { u: (100 - (down / meas.length) * 100).toFixed(2), c: coverage });
        }

        const setNum = (sel, v, d) => { if (v == null) { $(sel).textContent = '—'; $(sel).dataset.v = 0; } else NP.countUp($(sel), v, { digits: d }); };
        setNum('#qPing .num', avg, 1);
        const mins = okB.map((x) => x.min).filter((x) => x != null), maxs = okB.map((x) => x.max).filter((x) => x != null);
        $('#qPing .kpi-foot').innerHTML = avg == null ? NP.t('Chưa có dữ liệu') : `Min <b class="mono">${Math.min(...mins)}</b> · Max <b class="mono">${Math.max(...maxs)}</b> ms <span class="badge ${NP.pingTone(avg)}">${NP.toneLabel[NP.pingTone(avg)]}</span>`;
        setNum('#qJit .num', jit, 1);
        const jt = jit == null ? '' : jit < 5 ? 'good' : jit < 15 ? 'warn' : 'crit';
        $('#qJit .kpi-foot').innerHTML = jit == null ? NP.t('Chưa có dữ liệu') : `<span class="badge ${jt}">${NP.toneLabel[jt]}</span> ${NP.t('&lt; 5 ms là lý tưởng')}`;
        setNum('#qLoss .num', loss, 2);
        const lt = loss == null ? '' : loss < S.lossWarn ? 'good' : loss < 5 ? 'warn' : 'crit';
        $('#qLoss .kpi-foot').innerHTML = loss == null ? NP.t('Chưa có dữ liệu') : `<span class="badge ${lt}">${NP.toneLabel[lt]}</span> ${NP.t('{n} khoảng có mất gói', { n: meas.filter((x) => x.loss > 0).length })}`;

        const down = NP.css('--down');
        const pc = NP.charts.line($('#qChart'), {
          labels,
          series: [
            { label: 'Max', color: down, data: h.map((x) => x.max), fill: '+1', width: 0, alpha: 0.18 },
            { label: 'Min', color: down, data: h.map((x) => x.min), fill: false, width: 0 },
            { label: NP.t('Trung bình'), color: down, data: h.map((x) => x.avg), fill: false, width: 2 },
            { label: NP.t('Cảnh báo'), color: NP.css('--warn'), data: h.map(() => S.pingWarn), fill: false, dash: [5, 5], width: 1 },
            { label: NP.t('Nghiêm trọng'), color: NP.css('--crit'), data: h.map(() => S.pingCrit), fill: false, dash: [5, 5], width: 1 },
          ],
          yTitle: 'ms', tooltipValue: (v) => `${v} ms`, spanGaps: false,
        });
        // min–max band: fill dataset 0 down to dataset 1
        pc.data.datasets[0].fill = { target: 1 };
        pc.data.datasets[0].backgroundColor = NP.alpha(down, 0.16);
        pc.update('none');
        charts.push(pc);

        charts.push(NP.charts.line($('#jChart'), {
          labels, series: [{ label: 'Jitter', color: NP.css('--link'), data: h.map((x) => x.jitter) }],
          yTitle: 'ms', tooltipValue: (v) => `${v} ms`, spanGaps: false,
        }));
        charts.push(NP.charts.bar($('#lChart'), {
          labels, series: [{ label: NP.t('Mất gói'), color: NP.css('--warn'), data: h.map((x) => x.loss) }],
          yTitle: '%', tooltipValue: (v) => `${v}%`,
        }));

        const anomalies = meas.filter((x) => (x.max != null && x.max >= S.pingCrit) || (x.avg != null && x.avg >= S.pingWarn) || x.loss >= S.lossWarn || (x.signal != null && x.signal < S.signalWarn));
        $('#anCount').textContent = anomalies.length;
        $('#anBody').innerHTML = anomalies.length ? anomalies.slice().reverse().map((x) => {
          const kinds = [];
          if ((x.max != null && x.max >= S.pingCrit) || (x.avg != null && x.avg >= S.pingWarn)) kinds.push(NP.t('Độ trễ cao'));
          if (x.loss >= 100) kinds.push(NP.t('Mất kết nối'));
          else if (x.loss >= S.lossWarn) kinds.push(NP.t('Mất gói'));
          if (x.signal != null && x.signal < S.signalWarn) kinds.push(NP.t('Tín hiệu yếu'));
          const sev = (x.max != null && x.max >= S.pingCrit * 1.3) || x.loss >= 3 ? 'crit' : 'warn';
          return `<tr><td class="mono" style="font-size:12px">${NP.fmtDateTime(x.ts)}</td><td>${kinds.join(', ')}</td>
            <td class="num">${NP.num(x.avg, 1, ' ms')}</td><td class="num">${NP.num(x.max, 1, ' ms')}</td><td class="num">${NP.num(x.jitter, 1, ' ms')}</td><td class="num">${x.loss}%</td><td class="num">${NP.num(x.signal, 0, '%')}</td>
            <td><span class="badge ${sev}">${NP.icon(sev === 'crit' ? 'xCircle' : 'alert')}${sev === 'crit' ? NP.t('Nghiêm trọng') : NP.t('Cảnh báo')}</span></td></tr>`;
        }).join('') : `<tr><td colspan="8">${NP.emptyHTML('checkCircle', has ? NP.t('Không phát hiện bất thường') : NP.t('Chưa có dữ liệu đo trong khoảng này'))}</td></tr>`;
      };

      const loadTargets = async () => {
        let t;
        try { t = await NP.api.getTargets(); } catch { return; }
        if (!root.isConnected) return;
        const max = Math.max(1, ...t.map((x) => x.ping || 0)) * 1.2;
        $('#targets').innerHTML = t.map((x) => {
          const tone = x.ping == null ? 'crit' : NP.pingTone(x.ping);
          return `<div class="meter"><div class="meter-head"><span class="k"><b style="color:var(--text)">${NP.esc(x.name)}</b> <span class="mono muted" style="font-size:11px">${NP.esc(x.host)}</span></span>
            <span class="v">${x.ping == null ? `<span style="color:var(--crit)">${NP.t('không phản hồi')}</span>` : `<b>${x.ping}</b> ms · ±${x.jitter}`}${x.loss && x.ping != null ? ` · <span style="color:var(--crit)">${x.loss}% loss</span>` : ''}</span></div>
            <div class="meter-track" style="height:7px"><div class="meter-fill" style="--c:var(--${tone});width:${x.ping == null ? 100 : (x.ping / max) * 100}%"></div></div></div>`;
        }).join('') || NP.emptyHTML('target', NP.t('Không có mục tiêu'));
      };

      NP.bindSeg(root, 'qRange', (v) => { range = v; load(); });
      $('#tgRefresh').addEventListener('click', loadTargets);
      await Promise.all([load(), loadTargets()]);
      const t = setInterval(loadTargets, 10000);
      const t2 = setInterval(() => range === '1h' && load(), 60000);  // new minute bucket each minute
      return () => { clearInterval(t); clearInterval(t2); };
    },
  };
})();
