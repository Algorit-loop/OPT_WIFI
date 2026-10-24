/* Wi-Fi & Mạng — specs of the connected Wi-Fi, IP configuration, adapters, nearby networks */
(function () {
  const NP = window.NP;
  NP.pages = NP.pages || {};

  const rssiLabel = (dbm) => (dbm == null ? ['—', ''] : dbm >= -50 ? [NP.t('Xuất sắc'), 'good'] : dbm >= -60 ? [NP.t('Tốt'), 'good'] : dbm >= -70 ? [NP.t('Trung bình'), 'warn'] : [NP.t('Yếu'), 'crit']);
  const rssiPos = (dbm) => Math.max(0, Math.min(100, ((dbm + 90) / 60) * 100)); // -90..-30 dBm
  const locationNote = () => `<div class="note">${NP.icon('lock')}<span>${NP.t('Windows 11 yêu cầu quyền <b>Vị trí (Location)</b> để ứng dụng desktop đọc tên Wi-Fi/BSSID và quét mạng xung quanh.')}
    ${NP.t('Mở <b>Settings → Privacy &amp; security → Location</b>, bật <i>Location services</i> và <i>Let desktop apps access your location</i>.')}</span></div>`;

  NP.pages.wifi = {
    title: 'Wi-Fi & Mạng',
    sub: 'Thông số kỹ thuật Wi-Fi và cấu hình mạng hiện tại',
    render() {
      return `
      <div class="grid">
        <div class="card c-12" id="wHero"><div class="skeleton" style="height:140px"></div></div>
        <div class="card c-6">
          ${NP.cardHead(NP.t('Thông số kỹ thuật Wi-Fi'), { icon: 'radio', sub: 'Native WiFi API (wlanapi)' })}
          <div class="specs one" id="wSpecs"></div>
        </div>
        <div class="card c-6">
          ${NP.cardHead(NP.t('Cấu hình mạng'), { icon: 'server', sub: `<span id="nSub">${NP.t('Giao diện chính')}</span>`, right: `<button class="btn sm" id="nRefresh" title="${NP.t('Làm mới')}">${NP.icon('refresh')}</button>` })}
          <div class="specs one" id="nSpecs"></div>
        </div>
        <div class="card c-5">
          ${NP.cardHead(NP.t('Mật độ kênh'), { icon: 'chart', sub: NP.t('Số điểm phát (BSS) trên mỗi kênh'), right: NP.seg('chBand', [['2.4 GHz', '2.4 GHz'], ['5 GHz', '5 GHz'], ['6 GHz', '6 GHz']], '2.4 GHz') })}
          <div class="chart-box h-280"><canvas id="chChart"></canvas></div>
          <div class="note" style="margin-top:12px" id="chNote">${NP.icon('info')}<span>${NP.t('Đang quét…')}</span></div>
        </div>
        <div class="card c-7">
          ${NP.cardHead(NP.t('Mạng Wi-Fi xung quanh'), { icon: 'scan', sub: `<span id="scanInfo">${NP.t('Chưa quét')}</span>`, right: `<button class="btn sm" id="scanBtn">${NP.icon('refresh')}${NP.t('Quét lại')}</button>` })}
          <div class="table-wrap tbl-scroll" style="max-height:420px"><table class="tbl">
            <thead><tr><th>SSID</th><th>${NP.t('Tín hiệu')}</th><th>${NP.t('Băng tần')}</th><th class="num">${NP.t('Kênh')}</th><th class="num">${NP.t('Độ rộng')}</th><th>${NP.t('Chuẩn')}</th><th>${NP.t('Bảo mật')}</th></tr></thead>
            <tbody id="scanBody"><tr><td colspan="7"><div class="skeleton" style="height:180px"></div></td></tr></tbody></table></div>
        </div>
        <div class="card c-12">
          ${NP.cardHead(NP.t('Card mạng (Adapters)'), { icon: 'plug', sub: NP.t('Tất cả giao diện mạng trên máy · lưu lượng tính từ lúc khởi động Windows') })}
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>${NP.t('Tên')}</th><th>${NP.t('Mô tả')}</th><th>${NP.t('Loại')}</th><th>${NP.t('Trạng thái')}</th><th class="num">${NP.t('Tốc độ')}</th><th>MAC</th><th>IPv4</th><th class="num">${NP.t('Đã nhận')}</th><th class="num">${NP.t('Đã gửi')}</th></tr></thead>
            <tbody id="adBody"></tbody></table></div>
        </div>
      </div>`;
    },

    async mount(root) {
      const $ = (s) => root.querySelector(s);
      let [w, n, ads] = await Promise.all([NP.api.getWifi(), NP.api.getNetwork(), NP.api.getAdapters()]);
      if (!root.isConnected) return;

      const drawHero = () => {
        if (!w.available) {
          $('#wHero').innerHTML = NP.emptyHTML('wifiOff', `${NP.t('Máy không có card Wi-Fi hoặc dịch vụ WLAN AutoConfig không chạy.')}${w.error ? `<br><span class="mono" style="font-size:11px">${NP.esc(w.error)}</span>` : ''}`) +
            (n.interfaceName ? `<div class="note" style="max-width:520px;margin:0 auto">${NP.icon('plug')}<span>${NP.t('Đang dùng')} <b>${NP.esc(n.interfaceName)}</b> (${NP.esc(n.adapter || n.interfaceType)}).</span></div>` : '');
          return;
        }
        if (!w.connected) {
          $('#wHero').innerHTML = `<div class="wifi-hero"><div class="wifi-radar"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="core" style="background:var(--muted);box-shadow:none">${NP.icon('wifiOff')}</div></div>
            <div><div class="ssid">${NP.t('Wi-Fi chưa kết nối')}</div><div class="muted">${NP.esc(w.adapter || '')} · ${NP.t('trạng thái:')} ${NP.esc(w.state || '—')}</div>
            ${n.interfaceName ? `<div class="meta"><span class="badge info">${NP.t('Đang dùng')} ${NP.esc(n.interfaceName)}</span></div>` : ''}</div></div>` +
            (w.locationBlocked ? `<div style="margin-top:14px">${locationNote()}</div>` : '');
          return;
        }
        const [rl, rt] = rssiLabel(w.rssi);
        $('#wHero').innerHTML = `
          <div class="wifi-hero">
            <div class="wifi-radar"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="sweep"></div><div class="core">${NP.icon('wifi')}</div></div>
            <div style="flex:1;min-width:0">
              <div class="row-flex"><span class="badge good"><span class="live-dot" style="width:6px;height:6px"></span>${NP.t('Đã kết nối')}</span>${w.connectedSince ? `<span class="muted" style="font-size:12px">${NP.t('từ')} ${NP.fmtDateTime(w.connectedSince)}</span>` : ''}</div>
              <div class="ssid" style="margin-top:6px">${NP.esc(w.ssid || NP.t('(ẩn)'))}</div>
              <div class="meta">
                ${w.band ? `<span class="badge info">${w.band}</span>` : ''}${w.standard ? `<span class="badge violet">${w.standard}</span>` : ''}
                ${w.channel ? `<span class="badge">${NP.t('Kênh')} ${w.channel}${w.channelWidth ? ' · ' + w.channelWidth : ''}</span>` : ''}${w.authentication ? `<span class="badge">${NP.icon('lock')}${NP.esc(w.authentication)}</span>` : ''}
              </div>
              <div style="margin-top:16px;max-width:520px">
                <div class="meter-head"><span class="k">RSSI <b class="mono" id="hRssi" style="color:var(--text)">${NP.num(w.rssi, 0, ' dBm')}</b> · <span class="badge ${rt}" id="hRssiLbl">${rl}</span></span><span class="v muted">-90 dBm → -30 dBm</span></div>
                <div class="meter-track" style="height:8px;background:linear-gradient(90deg, var(--crit), var(--warn) 40%, var(--good) 70%);opacity:.9;overflow:visible">
                  <div id="rssiMark" style="position:absolute;top:-4px;left:${w.rssi == null ? 0 : rssiPos(w.rssi)}%;width:4px;height:16px;border-radius:2px;background:var(--text);box-shadow:0 0 10px var(--text);transform:translateX(-50%);transition:left .8s var(--ease)"></div>
                </div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 10px">
              <div id="hSigBars">${NP.signalHTML(w.signal, 'lg')}</div>
              <div style="font-size:28px;font-weight:800" id="hSig">${NP.num(w.signal, 0, '%')}</div>
              <div class="muted" style="font-size:11.5px">${NP.t('Chất lượng tín hiệu')}</div>
            </div>
          </div>
          ${w.locationBlocked ? `<div style="margin-top:14px">${locationNote()}</div>` : ''}
          <div class="divider"></div>
          <div class="row-flex" style="justify-content:space-between">
            <div class="mini-stats" style="grid-template-columns:repeat(4,minmax(110px,1fr));flex:1;max-width:720px">
              <div class="mini-stat"><div class="k">Link ↓ (Rx)</div><div class="v" id="hRx">${NP.num(w.rxRate)}<small>Mbps</small></div></div>
              <div class="mini-stat"><div class="k">Link ↑ (Tx)</div><div class="v" id="hTx">${NP.num(w.txRate)}<small>Mbps</small></div></div>
              <div class="mini-stat"><div class="k">${NP.t('Độ rộng kênh')}</div><div class="v">${w.channelWidth ? w.channelWidth.split(' ')[0] : '—'}<small>MHz</small></div></div>
              <div class="mini-stat"><div class="k">${NP.t('Thời gian kết nối')}</div><div class="v" style="font-size:16px" id="hUp">—</div></div>
            </div>
            <div class="row-flex">
              <button class="btn" data-act="reconnect">${NP.icon('refresh')}${NP.t('Kết nối lại')}</button>
              <button class="btn danger" data-act="disconnect">${NP.icon('unlink')}${NP.t('Ngắt kết nối')}</button>
            </div>
          </div>`;
        bindActions();
      };

      const drawSpecs = () => {
        if (!w.connected) {
          $('#wSpecs').innerHTML = [
            ['Card Wi-Fi', w.adapter, 'cpu'], ['Driver', w.driver ? `${w.driver}${w.driverProvider ? ' · ' + w.driverProvider : ''}` : null, 'cpu'],
            ['MAC máy', w.mac, 'hash', w.mac], ['Trạng thái', w.state, 'info'],
          ].map(([k, v, i, c]) => NP.spec(NP.t(k), NP.esc(v ?? '—'), { icon: i, copy: c })).join('');
          return;
        }
        const std = w.apStandard && w.apStandard !== w.standard
          ? `${NP.esc(w.standard || '—')} <span class="muted">(${NP.t('AP hỗ trợ')} ${NP.esc(w.apStandard)})</span>`
          : NP.esc(w.standard || '—');
        $('#wSpecs').innerHTML = [
          ['Tên mạng (SSID)', w.ssid, 'wifi', w.ssid],
          ['BSSID (MAC router)', w.bssid, 'hash', w.bssid],
          ['Chuẩn Wi-Fi đang dùng', std, 'radio', null, true],
          ['Loại sóng (Radio type)', w.radioType, 'radio'],
          ['Băng tần', w.band ? `${w.band}${w.frequency ? ` · ${w.frequency} MHz` : ''}` : null, 'layers'],
          ['Kênh', w.channel ? `${w.channel}${w.channelWidth ? ` (${w.channelWidth})` : ''}` : null, 'layers'],
          ['Xác thực', w.authentication, 'shield'],
          ['Mã hoá', w.cipher, 'lock'],
          ['Tốc độ nhận / gửi', `${NP.num(w.rxRate)} / ${NP.num(w.txRate)} Mbps`, 'zap'],
          ['Tín hiệu', `${NP.num(w.signal, 0, '%')} · ${NP.num(w.rssi, 0, ' dBm')}`, 'activity'],
          ['Card Wi-Fi', w.adapter, 'cpu'],
          ['Driver', w.driver ? `${w.driver}${w.driverProvider ? ' · ' + w.driverProvider : ''}` : null, 'cpu'],
          ['MAC máy', w.mac, 'hash', w.mac],
          ['Profile', w.profile ? `${w.profile}${w.connectionMode ? ' · ' + w.connectionMode : ''}` : null, 'list'],
        ].map(([k, v, i, c, rich]) => NP.spec(NP.t(k), rich ? v : NP.esc(v ?? '—'), { icon: i, copy: c })).join('');
      };

      const drawNet = () => {
        $('#nSub').textContent = n.interfaceName ? `${n.interfaceName} · ${NP.t('cập nhật')} ${NP.fmtTime(n.updatedAt)}` : NP.t('Không có giao diện chính');
        if (!n.interfaceName) { $('#nSpecs').innerHTML = NP.emptyHTML('unlink', NP.t('Không có giao diện mạng nào có default gateway')); return; }
        const lease = (t) => (t ? `${NP.fmtDateTime(t)} <span class="muted">(${t > Date.now() ? NP.t('còn {x}', { x: NP.fmtDuration((t - Date.now()) / 1000) }) : NP.t('đã hết')})</span>` : null);
        $('#nSpecs').innerHTML = [
          ['Hostname', n.hostname, 'monitor', n.hostname],
          ['Giao diện', `${n.interfaceName}${n.adapter ? ' — ' + n.adapter : ''}`, 'plug'],
          ['IPv4', n.ipv4, 'hash', n.ipv4],
          ['Subnet mask', n.subnet, 'hash'],
          ['Default gateway', n.gateway, 'route', n.gateway],
          ['DNS servers', n.dns.length ? n.dns.map(NP.esc).join('<br>') : null, 'server', n.dns.join(', '), true],
          ['IPv6 (link-local)', n.ipv6, 'hash', n.ipv6],
          ['IPv6 (global)', n.ipv6Global, 'globe', n.ipv6Global],
          ['DHCP', n.dhcp == null ? null : n.dhcp ? `${NP.t('Bật')}${n.dhcpServer ? ' · server ' + n.dhcpServer : ''}` : NP.t('Tắt (IP tĩnh)'), 'refresh'],
          ['Lease nhận lúc', n.leaseObtained ? NP.fmtDateTime(n.leaseObtained) : null, 'clock'],
          ['Lease hết hạn', lease(n.leaseExpires), 'clock', null, true],
          ['IP public', n.publicIp, 'globe', n.publicIp],
          ['Nhà mạng (ISP)', n.isp || (NP.settings.publicIpLookup ? null : NP.t('Tắt tra cứu trong Cài đặt')), 'globe'],
          ['Vị trí (theo IP)', n.location, 'globe'],
          ['MTU', n.mtu, 'layers'],
        ].map(([k, v, i, c, rich]) => NP.spec(NP.t(k), rich ? v ?? '—' : NP.esc(v ?? '—'), { icon: i, copy: c || undefined })).join('');
      };

      const drawAdapters = () => {
        $('#adBody').innerHTML = ads.map((a) => {
          const upA = a.status === 'Up';
          return `<tr><td><b>${NP.esc(a.name)}</b> ${a.primary ? `<span class="badge info">${NP.t('Chính')}</span>` : ''}</td><td class="txt-2">${NP.esc(a.desc)}</td><td><span class="badge">${NP.esc(a.type)}</span></td>
            <td><span class="badge ${upA ? 'good' : ''}">${upA ? NP.t('Hoạt động') : a.status === 'Disabled' ? NP.t('Tắt') : NP.t('Ngắt')}</span></td>
            <td class="num">${a.speed && upA ? NP.fmtRate(a.speed, { unit: 'bits' }).text : '—'}</td><td class="mono" style="font-size:12px">${NP.esc(a.mac || '—')}</td>
            <td class="mono" style="font-size:12px">${NP.esc(a.ipv4)}</td><td class="num">${a.rx ? NP.fmtBytes(a.rx).text : '—'}</td><td class="num">${a.tx ? NP.fmtBytes(a.tx).text : '—'}</td></tr>`;
        }).join('') || `<tr><td colspan="9">${NP.emptyHTML('plug', NP.t('Không đọc được danh sách card mạng'))}</td></tr>`;
      };

      /* nearby scan + channel density */
      let nets = [], band = w.band && ['2.4 GHz', '5 GHz', '6 GHz'].includes(w.band) ? w.band : '2.4 GHz', chChart = null;
      root.querySelectorAll('#chBand button').forEach((b) => b.classList.toggle('on', b.dataset.v === band));
      const CHANS = {
        '2.4 GHz': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        '5 GHz': [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
        '6 GHz': [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93],
      };
      const drawChannels = () => {
        const inBand = nets.filter((x) => x.band === band);
        const extra = inBand.map((x) => x.channel).filter((c) => !CHANS[band].includes(c));
        const chans = [...new Set([...CHANS[band], ...extra])].sort((a, b) => a - b);
        const mineCh = band === w.band ? w.channel : null;
        const others = chans.map((c) => inBand.filter((x) => x.channel === c && !x.connected).length);
        const mine = chans.map((c) => (c === mineCh ? 1 : 0));
        if (chChart) chChart.destroy();
        chChart = NP.charts.bar($('#chChart'), {
          labels: chans.map(String),
          series: [
            { label: NP.t('Điểm phát khác'), color: NP.alpha(NP.css('--cap'), 0.6), data: others },
            { label: NP.t('Mạng của bạn'), color: NP.css('--accent'), data: mine },
          ],
          stacked: true, yTitle: NP.t('Số BSS'), tooltipTitle: (p) => `${NP.t('Kênh')} ${p[0].label}`,
        });
        chChart.options.scales.y.ticks.stepSize = 1;
        chChart.update();
        let note;
        if (!nets.length) note = NP.t('Chưa có dữ liệu quét.');
        else if (band === w.band && mineCh) {
          // 2.4 GHz channels overlap ±4; 5/6 GHz only exact-channel conflicts matter (ignoring bonding)
          const overlap = inBand.filter((x) => !x.connected && (band === '2.4 GHz' ? Math.abs(x.channel - mineCh) < 5 : x.channel === mineCh));
          const strong = overlap.filter((x) => x.rssi > -75).length;
          note = NP.t(band === '2.4 GHz'
            ? 'Kênh {ch} của bạn có <b>{n}</b> điểm phát khác trùng/chồng lấn ({s} điểm mạnh hơn -75 dBm).'
            : 'Kênh {ch} của bạn có <b>{n}</b> điểm phát khác dùng chung ({s} điểm mạnh hơn -75 dBm).', { ch: mineCh, n: overlap.length, s: strong }) + ' ' +
            (strong >= 2
              ? NP.t(band === '2.4 GHz' ? 'Nhiễu đáng kể — cân nhắc đổi kênh trong cài đặt router (1, 6 hoặc 11) hoặc dùng băng 5 GHz.' : 'Nhiễu đáng kể — cân nhắc đổi kênh trong cài đặt router.')
              : NP.t('Mức nhiễu thấp — kênh đang dùng khá tốt.'));
        } else note = NP.t('Băng {b} có {n} điểm phát xung quanh.', { b: band, n: inBand.length });
        $('#chNote').innerHTML = `${NP.icon('info')}<span>${note}</span>`;
      };
      const scan = async () => {
        const btn = $('#scanBtn');
        if (!w.available) {
          $('#scanBody').innerHTML = `<tr><td colspan="7">${NP.emptyHTML('wifiOff', NP.t('Không có card Wi-Fi để quét'))}</td></tr>`;
          drawChannels();
          return;
        }
        btn.disabled = true; btn.innerHTML = `${NP.icon('refresh', 'spin')}${NP.t('Đang quét…')}`;
        try {
          nets = await NP.api.scanWifi();
        } catch (e) {
          if (!root.isConnected) return;
          $('#scanBody').innerHTML = `<tr><td colspan="7">${e.status === 403 ? locationNote() : NP.emptyHTML('alert', NP.t('Quét thất bại: ') + NP.esc(e.message))}</td></tr>`;
          btn.disabled = false; btn.innerHTML = `${NP.icon('refresh')}${NP.t('Quét lại')}`;
          return;
        }
        if (!root.isConnected) return;
        btn.disabled = false; btn.innerHTML = `${NP.icon('refresh')}${NP.t('Quét lại')}`;
        const ssids = new Set(nets.map((x) => x.ssid)).size;
        $('#scanInfo').textContent = NP.t('{n} điểm phát · {s} mạng · {t}', { n: nets.length, s: ssids, t: NP.fmtTime(Date.now()) });
        $('#scanBody').innerHTML = nets.length ? nets.map((x) => `
          <tr><td><b>${NP.esc(x.ssid)}</b> ${x.connected ? `<span class="badge good">${NP.t('Đang dùng')}</span>` : ''}<div class="muted mono" style="font-size:11px">${x.bssid}</div></td>
          <td><span class="row-flex" style="gap:8px;flex-wrap:nowrap">${NP.signalHTML(x.signal)}<span class="mono" style="font-size:12px">${x.signal}% · ${x.rssi} dBm</span></span></td>
          <td><span class="badge ${x.band === '2.4 GHz' ? '' : 'info'}">${x.band || '—'}</span></td><td class="num">${x.channel ?? '—'}</td><td class="num">${x.width ? x.width + ' MHz' : '—'}</td>
          <td class="txt-2" title="${NP.esc(x.standard || '')}" style="white-space:nowrap">${NP.esc((x.standard || x.radioType || '—').replace(/ \(.*\)$/, ''))}</td><td>${x.security === 'Open' ? `<span class="badge crit">${NP.t('Mở')}</span>` : `<span class="txt-2">${NP.esc(x.security)}</span>`}</td></tr>`).join('')
          : `<tr><td colspan="7">${NP.emptyHTML('scan', NP.t('Không thấy mạng nào'))}</td></tr>`;
        drawChannels();
      };
      $('#scanBtn').addEventListener('click', scan);
      NP.bindSeg(root, 'chBand', (v) => { band = v; drawChannels(); });

      function bindActions() {
        root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
          const act = b.dataset.act;
          if (act === 'disconnect' && !confirm(NP.t('Ngắt kết nối Wi-Fi "{x}"? Máy sẽ mất mạng cho tới khi kết nối lại.', { x: w.ssid }))) return;
          b.disabled = true;
          NP.toast(act === 'reconnect' ? NP.t('Đang kết nối lại…') : NP.t('Đang ngắt kết nối…'), 'info', 1500);
          try {
            const r = await NP.api.action(act);
            NP.toast(r.ok ? (act === 'reconnect' ? NP.t('Đã gửi lệnh kết nối lại {x}', { x: NP.esc(w.ssid) }) : NP.t('Đã ngắt kết nối Wi-Fi')) : `${NP.t('Thất bại:')} ${NP.esc(r.output)}`, r.ok ? 'good' : 'crit', 5000);
          } catch (e) { NP.toast(NP.t('Lỗi: ') + NP.esc(e.message), 'crit'); }
          b.disabled = false;
        }));
      }

      drawHero(); drawSpecs(); drawNet(); drawAdapters(); scan();

      $('#nRefresh').addEventListener('click', async () => {
        [n, ads] = await Promise.all([NP.api.getNetwork(), NP.api.getAdapters()]);
        drawNet(); drawAdapters();
        NP.toast(NP.t('Đã làm mới cấu hình mạng'), 'good', 1500);
      });

      const off = NP.live.subscribe((s) => {
        if (!w.connected) return;
        if (s.signal != null) {
          $('#hSig').textContent = `${s.signal}%`;
          $('#hSigBars').innerHTML = NP.signalHTML(s.signal, 'lg');
        }
        if (w.connectedSince) $('#hUp').textContent = NP.fmtDuration((Date.now() - w.connectedSince) / 1000);
      });
      // Wi-Fi details (RSSI, rates, roaming) every 3 s; redraw everything if the connection changed
      const t = setInterval(async () => {
        try {
          const nw = await NP.api.getWifi();
          if (!root.isConnected) return;
          const changed = nw.connected !== w.connected || nw.bssid !== w.bssid;
          w = nw;
          if (changed) { n = await NP.api.getNetwork(); drawHero(); drawSpecs(); drawNet(); return; }
          if (w.connected && w.rssi != null) {
            const [rl, rt] = rssiLabel(w.rssi);
            $('#hRssi').textContent = `${w.rssi} dBm`;
            const lbl = $('#hRssiLbl'); lbl.className = 'badge ' + rt; lbl.textContent = rl;
            $('#rssiMark').style.left = `${rssiPos(w.rssi)}%`;
            $('#hRx').innerHTML = `${NP.num(w.rxRate)}<small>Mbps</small>`;
            $('#hTx').innerHTML = `${NP.num(w.txRate)}<small>Mbps</small>`;
          }
        } catch { /* offline */ }
      }, 3000);
      return () => { off(); clearInterval(t); };
    },
  };
})();
