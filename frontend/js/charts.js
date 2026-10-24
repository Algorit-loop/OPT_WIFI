/* Chart helpers: theme-aware Chart.js defaults, crosshair, HTML tooltip, SVG gauges */
(function () {
  const NP = window.NP;
  const C = {};
  NP.charts = C;

  C.applyTheme = () => {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11;
    Chart.defaults.color = NP.css('--muted');
    Chart.defaults.borderColor = NP.css('--grid');
    Chart.defaults.animation.duration = NP.settings.animations ? 700 : 0;
  };

  /* Vertical crosshair on hover (line/area charts) */
  const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const a = chart.tooltip?.getActiveElements?.();
      if (!a || !a.length || chart.config.type !== 'line') return;
      const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = NP.alpha(NP.css('--text-2'), 0.45);
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.restore();
    },
  };
  if (window.Chart) Chart.register(crosshair);

  /* HTML tooltip — rows: [{color, label, value}] */
  C.externalTooltip = (titleFn, rowsFn) => (ctx) => {
    const { chart, tooltip } = ctx;
    const host = chart.canvas.parentNode;
    let el = host.querySelector('.ctip');
    if (!el) { el = document.createElement('div'); el.className = 'ctip'; host.appendChild(el); }
    if (tooltip.opacity === 0) { el.style.opacity = 0; return; }
    const pts = tooltip.dataPoints || [];
    if (!pts.length) return;
    const rows = rowsFn(pts);
    el.innerHTML = `<div class="tt">${titleFn(pts)}</div>` +
      rows.map((r) => `<div class="row"><i style="background:${r.color}"></i><span>${r.label}</span><span class="vv">${r.value}</span></div>`).join('');
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = tooltip.caretX + 14, y = tooltip.caretY - h / 2;
    if (x + w > host.clientWidth) x = tooltip.caretX - w - 14;
    y = Math.max(0, Math.min(host.clientHeight - h, y));
    el.style.opacity = 1;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.left = '0'; el.style.top = '0';
  };

  const gradient = (color, a1 = 0.32, a2 = 0) => (ctx) => {
    const { chart } = ctx;
    const area = chart.chartArea;
    if (!area) return NP.alpha(color, a1 / 2);
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, NP.alpha(color, a1)); g.addColorStop(1, NP.alpha(color, a2));
    return g;
  };
  C.gradient = gradient;

  const baseScales = (yTitle, extra = {}) => ({
    x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 18 }, ...(extra.x || {}) },
    y: {
      beginAtZero: true, border: { display: false }, grid: { color: NP.css('--grid') },
      ticks: { maxTicksLimit: 5, padding: 8 },
      title: yTitle ? { display: true, text: yTitle, color: NP.css('--muted'), font: { size: 10.5 } } : undefined,
      ...(extra.y || {}),
    },
  });
  C.baseScales = baseScales;

  /** Area/line chart. series: [{label, color, data, fill?, dash?, width?}] */
  C.line = (canvas, { labels = [], series, yTitle, tooltipTitle, tooltipValue, scales = {}, stepped, spanGaps = true } = {}) => {
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label, data: s.data, borderColor: s.color, borderWidth: s.width ?? 2,
          backgroundColor: s.fill === false ? 'transparent' : gradient(s.color, s.alpha ?? 0.28),
          fill: s.fill !== false, tension: 0.35, pointRadius: 0, pointHoverRadius: s.dash ? 0 : 5,
          pointHoverBorderWidth: 2, pointHoverBorderColor: NP.css('--panel-solid'), pointHoverBackgroundColor: s.color,
          borderDash: s.dash || [], stepped: stepped || false, order: s.order ?? 0, spanGaps,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: C.externalTooltip(
              tooltipTitle || ((p) => p[0].label),
              (pts) => pts.filter((p) => p.raw != null).map((p) => ({ color: p.dataset.borderColor, label: p.dataset.label, value: tooltipValue ? tooltipValue(p.raw, p) : p.formattedValue }))
            ),
          },
        },
        scales: baseScales(yTitle, scales),
      },
    });
  };

  /** Bar chart. series: [{label, color, data}] — stacked optional */
  C.bar = (canvas, { labels, series, yTitle, stacked = false, tooltipValue, tooltipTitle, horizontal = false } = {}) => {
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label, data: s.data, backgroundColor: s.color, hoverBackgroundColor: s.hover || s.color,
          borderRadius: stacked ? 3 : 4, borderSkipped: stacked ? false : 'start',
          borderColor: NP.css('--panel-solid'), borderWidth: stacked ? { top: 2 } : 0,
          maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.9,
        })),
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: C.externalTooltip(tooltipTitle || ((p) => p[0].label), (pts) => pts.map((p) => ({ color: p.dataset.backgroundColor, label: p.dataset.label, value: tooltipValue ? tooltipValue(p.raw, p) : p.formattedValue }))),
          },
        },
        scales: { ...baseScales(yTitle), x: { ...baseScales(yTitle).x, stacked }, y: { ...baseScales(yTitle).y, stacked } },
      },
    });
  };

  /** Tiny sparkline for KPI tiles */
  C.spark = (canvas, color, data) => new Chart(canvas, {
    type: 'line',
    data: { labels: data.map((_, i) => i), datasets: [{ data, borderColor: color, borderWidth: 1.5, fill: true, backgroundColor: gradient(color, 0.22), tension: 0.4, pointRadius: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
      layout: { padding: 0 },
    },
  });

  /** Push a point and trim to max length, then redraw without animation */
  C.push = (chart, label, values, max) => {
    chart.data.labels.push(label);
    chart.data.datasets.forEach((ds, i) => { if (values[i] !== undefined) ds.data.push(values[i]); });
    while (chart.data.labels.length > max) chart.data.labels.shift();
    chart.data.datasets.forEach((ds) => { while (ds.data.length > max) ds.data.shift(); });
    chart.update('none');
  };

  /* ---------- SVG arc gauge (240° sweep) ---------- */
  const R = 90, CX = 110, CY = 110, SWEEP = 240, START = 150;
  const polar = (deg, r = R) => { const a = (deg * Math.PI) / 180; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
  const arcPath = (from, to, r = R) => {
    const [x1, y1] = polar(from, r), [x2, y2] = polar(to, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const ARC_LEN = (2 * Math.PI * R * SWEEP) / 360;

  C.gaugeSVG = ({ ticks = [0, 25, 50, 75, 100], suffix = '%' } = {}) => {
    const tickEls = ticks.map((t) => {
      const deg = START + (SWEEP * t) / 100;
      const [x1, y1] = polar(deg, R + 12), [x2, y2] = polar(deg, R + 6), [lx, ly] = polar(deg, R + 22);
      return `<line class="tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="tick-label" x="${lx}" y="${ly + 3}" text-anchor="middle">${t}${suffix}</text>`;
    }).join('');
    return `<svg class="gauge" viewBox="-10 -10 240 200">
      <path class="track" d="${arcPath(START, START + SWEEP)}" stroke-width="14"/>
      <path class="bar" d="${arcPath(START, START + SWEEP)}" stroke-width="14" stroke-dasharray="${ARC_LEN}" stroke-dashoffset="${ARC_LEN}"/>
      ${tickEls}
    </svg>`;
  };
  C.setGauge = (root, pct, color) => {
    const bar = root.querySelector('.bar');
    if (!bar) return;
    const p = Math.max(0, Math.min(100, pct));
    bar.style.strokeDashoffset = ARC_LEN * (1 - p / 100);
    bar.style.stroke = color;
  };

  /* ---------- Score ring ---------- */
  C.ringSVG = (r = 62, w = 12) => {
    const len = 2 * Math.PI * r;
    return `<svg width="100%" height="100%" viewBox="0 0 150 150"><circle class="rt" cx="75" cy="75" r="${r}" stroke-width="${w}"/><circle class="rb" cx="75" cy="75" r="${r}" stroke-width="${w}" stroke-dasharray="${len}" stroke-dashoffset="${len}"/></svg>`;
  };
  C.setRing = (root, pct, color, r = 62) => {
    const len = 2 * Math.PI * r, el = root.querySelector('.rb');
    el.style.stroke = color;
    requestAnimationFrame(() => (el.style.strokeDashoffset = len * (1 - pct / 100)));
  };
})();
