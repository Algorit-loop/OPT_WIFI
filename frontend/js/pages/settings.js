/* Cài đặt — sampling, thresholds, ISP plan, appearance, data */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};

  const row = (title, desc, ctl) => `<div class="setting-row"><div class="txt"><b>${NP.t(title)}</b><span>${NP.t(desc)}</span></div><div class="ctl">${ctl}</div></div>`;
  const select = (key, opts) => `<select class="select" data-k="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(NP.settings[key]) === String(v) ? 'selected' : ''}>${NP.t(l)}</option>`).join('')}</select>`;
  const range = (key, min, max, step, unit) => `<div class="row-flex" style="width:100%;flex-wrap:nowrap"><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${NP.settings[key]}"><b class="mono" style="min-width:64px;text-align:right" data-out="${key}">${NP.settings[key]} ${unit}</b></div>`;
  const number = (key, unit, min = 0) => `<div class="input-group" style="width:100%"><input class="input mono" type="number" min="${min}" data-k="${key}" value="${NP.settings[key]}"><span class="muted" style="align-self:center;font-size:12px;min-width:36px">${unit}</span></div>`;
  const toggle = (key) => `<label class="switch"><input type="checkbox" data-k="${key}" ${NP.settings[key] ? 'checked' : ''}><span class="sl"></span></label>`;

  NP.pages.settings = {
    title: 'Cài đặt',
    sub: 'Tần suất cập nhật, ngưỡng cảnh báo, lưu trữ và giao diện',
    render() {
      const S = NP.settings;
      return `
      <div class="grid">
        <div class="stack c-7">
          <div class="card">
            ${NP.cardHead(NP.t('Thu thập dữ liệu'), { icon: 'cpu' })}
            ${row('Tần suất cập nhật', 'Khoảng thời gian giữa mỗi lần lấy mẫu lưu lượng', select('refreshMs', [[500, '0.5 giây'], [1000, '1 giây'], [2000, '2 giây'], [5000, '5 giây']]))}
            ${row('Mục tiêu Ping', 'Host dùng để đo độ trễ liên tục', `<input class="input mono" data-k="pingTarget" value="${NP.esc(S.pingTarget)}">`)}
            ${row('Thời gian lưu dữ liệu', 'Dữ liệu chi tiết theo phút & log cũ hơn sẽ bị xoá (thống kê theo giờ giữ 3 năm)', select('retentionDays', [[7, '7 ngày'], [30, '30 ngày'], [90, '90 ngày'], [180, '180 ngày'], [365, '1 năm']]))}
            ${row('Speed test tự động', 'Định kỳ đo lại tốc độ Internet tối đa (mỗi lần tốn ~100–500 MB)', select('autoSpeedtest', [['off', 'Tắt'], ['6h', 'Mỗi 6 giờ'], ['daily', 'Mỗi ngày']]))}
            ${row('Tra cứu IP public & nhà mạng', 'Hỏi speed.cloudflare.com mỗi 30 phút để biết IP public, ISP', toggle('publicIpLookup'))}
          </div>
          <div class="card">
            ${NP.cardHead(NP.t('Ngưỡng cảnh báo'), { icon: 'bell' })}
            ${row('Ping — cảnh báo', 'Vượt mức này được đánh dấu vàng', range('pingWarn', 20, 300, 5, 'ms'))}
            ${row('Ping — nghiêm trọng', 'Vượt mức này được đánh dấu đỏ', range('pingCrit', 50, 600, 10, 'ms'))}
            ${row('Mất gói', 'Tỷ lệ mất gói tối đa chấp nhận được', range('lossWarn', 0.5, 10, 0.5, '%'))}
            ${row('Tín hiệu Wi-Fi yếu', 'Cảnh báo khi chất lượng tín hiệu thấp hơn', range('signalWarn', 10, 80, 5, '%'))}
            ${row('Hạn mức dung lượng tháng', 'Chỉ tính lưu lượng đã đo khi agent chạy; 0 = không giới hạn', number('monthlyCapGB', 'GB'))}
            ${row('Thông báo trên màn hình', 'Hiện thông báo khi có sự kiện cảnh báo', toggle('notify'))}
          </div>
        </div>

        <div class="stack c-5">
          <div class="card">
            ${NP.cardHead(NP.t('Gói cước Internet'), { icon: 'globe', sub: NP.t('So sánh tốc độ đo được với cam kết · 0 = chưa đặt') })}
            ${row('Download cam kết', 'Theo hợp đồng nhà mạng', number('planDownMbps', 'Mbps'))}
            ${row('Upload cam kết', 'Nhiều gói có upload bằng download', number('planUpMbps', 'Mbps'))}
          </div>
          <div class="card">
            ${NP.cardHead(NP.t('Giao diện'), { icon: 'palette' })}
            ${row('Ngôn ngữ', 'Ngôn ngữ hiển thị của giao diện', NP.seg('setLang', [['vi', 'Tiếng Việt'], ['en', 'English']], NP.lang))}
            ${row('Chế độ', 'Sáng hoặc tối', NP.seg('setTheme', [['dark', NP.t('Tối')], ['light', NP.t('Sáng')]], S.theme))}
            ${row('Màu nhấn', 'Màu chủ đạo của giao diện', `<div class="swatches">${[['cyan', '#22d3ee'], ['violet', '#a78bfa'], ['emerald', '#34d399'], ['pink', '#f472b6']].map(([k, c]) => `<span class="swatch ${S.accent === k ? 'on' : ''}" data-accent="${k}" style="background:${c}" title="${k}"></span>`).join('')}</div>`)}
            ${row('Đơn vị tốc độ', 'Bit (Mbps) hay Byte (MB/s)', NP.seg('setUnit', [['bits', 'Mbps'], ['bytes', 'MB/s']], S.unit))}
            ${row('Hiệu ứng chuyển động', 'Tắt nếu máy chậm', toggle('animations'))}
          </div>
          <div class="card">
            ${NP.cardHead('Local Agent', { icon: 'server', right: `<button class="btn sm" id="agentRefresh">${NP.icon('refresh')}</button>` })}
            <div id="agentInfo"><div class="skeleton" style="height:160px"></div></div>
          </div>
          <div class="card">
            ${NP.cardHead(NP.t('Dữ liệu'), { icon: 'database' })}
            <div class="row-flex">
              <button class="btn" id="setExport">${NP.icon('download')}${NP.t('Xuất cài đặt')}</button>
              <button class="btn" id="setReset">${NP.icon('refresh')}${NP.t('Khôi phục mặc định')}</button>
              <button class="btn danger" id="setWipe">${NP.icon('trash')}${NP.t('Xoá lịch sử')}</button>
            </div>
            <div class="muted" style="font-size:12px;margin-top:12px">${NP.t('Toàn bộ dữ liệu nằm trong thư mục <span class="mono">OPT_WIFI\\data</span>. Xoá thư mục OPT_WIFI là xoá sạch ứng dụng.')}</div>
          </div>
        </div>
      </div>`;
    },

    mount(root) {
      const drawAgent = async () => {
        let st;
        try { st = await NP.api.getStatus(); } catch { return; }
        if (!root.isConnected) return;
        root.querySelector('#agentInfo').innerHTML =
          NP.spec(NP.t('Chế độ'), NP.demo ? `<span class="badge warn">${NP.t('Demo (dữ liệu mô phỏng)')}</span>` : `<span class="badge good">${NP.t('Agent · dữ liệu thật')}</span>`) +
          NP.spec(NP.t('Phiên bản'), NP.esc(st.version)) +
          NP.spec(NP.t('Đang chạy'), NP.fmtDuration((Date.now() - st.startedAt) / 1000) + (st.pid ? ` · PID ${st.pid}` : '')) +
          NP.spec(NP.t('Địa chỉ'), `<span class="mono">${location.origin}</span>`) +
          NP.spec(NP.t('Quyền Administrator'), st.admin ? `<span class="badge good">${NP.t('Có')}</span>` : `<span class="badge">${NP.t('Không')}</span> <span class="muted">${NP.t('(sẽ hỏi UAC khi cần)')}</span>`) +
          NP.spec(NP.t('Thư mục dữ liệu'), `<span class="mono" style="font-size:11.5px">${NP.esc(st.dataDir)}</span>`, { copy: st.dataDir }) +
          NP.spec(NP.t('Dung lượng database'), NP.fmtBytes(st.dbSize || 0).text) +
          NP.spec(NP.t('Tài liệu API'), NP.demo ? '—' : '<a href="/api/docs" target="_blank">/api/docs</a>');
      };
      drawAgent();
      root.querySelector('#agentRefresh').addEventListener('click', drawAgent);
      let saveT;
      const saved = () => { clearTimeout(saveT); saveT = setTimeout(() => NP.toast(NP.t('Đã lưu cài đặt'), 'good', 1400), 350); };

      root.querySelectorAll('[data-k]').forEach((el) => {
        const key = el.dataset.k;
        // sliders update live; text/number fields save on commit so half-typed values never reach the agent
        const ev = el.type === 'range' ? 'input' : 'change';
        el.addEventListener(ev, () => {
          let v = el.type === 'checkbox' ? el.checked : el.value;
          if (typeof NP.settings[key] === 'number') v = parseFloat(v) || 0;
          if (el.type === 'range') {
            const out = root.querySelector(`[data-out="${key}"]`);
            out.textContent = `${v} ${out.textContent.split(' ')[1]}`;
          }
          NP.saveSettings({ [key]: v });
          if (key === 'animations') NP.charts.applyTheme();
          saved();
        });
      });

      NP.bindSeg(root, 'setLang', (v) => NP.applyLang(v));
      NP.bindSeg(root, 'setTheme', (v) => { NP.saveSettings({ theme: v }); NP.applyTheme(); saved(); });
      NP.bindSeg(root, 'setUnit', (v) => { NP.saveSettings({ unit: v }); saved(); });
      root.querySelectorAll('[data-accent]').forEach((s) => s.addEventListener('click', () => {
        root.querySelectorAll('[data-accent]').forEach((x) => x.classList.toggle('on', x === s));
        NP.saveSettings({ accent: s.dataset.accent }); NP.applyTheme(); saved();
      }));

      root.querySelector('#setExport').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(NP.settings, null, 2)], { type: 'application/json' }));
        a.download = 'netpulse-settings.json'; a.click(); URL.revokeObjectURL(a.href);
      });
      root.querySelector('#setReset').addEventListener('click', async () => {
        if (!confirm(NP.t('Khôi phục toàn bộ cài đặt về mặc định?'))) return;
        const lang = NP.lang; // the display language is not part of "reset to defaults"
        await NP.resetSettings(); NP.saveSettings({ lang }); NP.applyTheme(); NP.rerender();
        NP.toast(NP.t('Đã khôi phục cài đặt mặc định'), 'good');
      });
      root.querySelector('#setWipe').addEventListener('click', async () => {
        if (!confirm(NP.t('Xoá toàn bộ lịch sử: thống kê lưu lượng, chất lượng, log sự kiện và kết quả speed test? Không thể hoàn tác.'))) return;
        try {
          await NP.api.wipeData();
          NP.toast(NP.t('Đã xoá toàn bộ lịch sử'), 'warn');
          drawAgent();
        } catch (e) { NP.toast(NP.t('Không xoá được: ') + NP.esc(e.message), 'crit'); }
      });
    },
  };
})();
