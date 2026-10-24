/* ==========================================================================
   Data layer
   --------------------------------------------------------------------------
   Pages only talk to NP.api. Two providers implement the same contract:

   - HttpProvider  : the local Windows agent (backend/), default.
   - MockProvider  : simulated data, only when the page is opened with ?demo.
   Endpoints (full list with schemas: /api/docs):
     GET  /api/status                 GET  /api/live?since=<ms> | ?n=<count>
     GET  /api/wifi                   POST /api/wifi/scan
     GET  /api/network                GET  /api/adapters
     GET  /api/capacity               GET  /api/speedtest/history
     GET  /api/usage?range=24h|7d|30d|12m          GET /api/usage/heatmap
     GET  /api/quality?range=1h|24h|7d             GET /api/quality/targets
     GET  /api/events?after=<id>      DELETE /api/events      POST /api/events/seen
     POST /api/tools/{speedtest,ping,traceroute}  → {job}  then GET /api/jobs/{id}
     GET  /api/jobs/active            → {kind: {id, params}} of jobs still running
     POST /api/tools/dns              POST /api/actions/{name}
     GET|PUT|DELETE /api/settings     DELETE /api/data        POST /api/shutdown
   POST/PUT/DELETE must send the header X-NetPulse: 1.

   All rates are bits/second, all volumes are bytes, all times are epoch ms;
   buckets with observed=false / null values mean "not measured", not zero.
   ========================================================================== */
(function () {
  const NP = window.NP;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MB = 1e6, GB = 1024 ** 3;

  /* ------------------------------------------------------------------ */
  function MockProvider() {
    const rnd = Math.random;
    const startedAt = Date.now();

    const wifi = {
      available: true,
      connected: true,
      interfaceName: 'Wi-Fi',
      ssid: 'HomeNet_5G',
      bssid: 'a4:2b:b0:7c:19:e2',
      band: '5 GHz',
      channel: 44,
      channelWidth: '80 MHz',
      standard: 'Wi-Fi 6 (802.11ax)',
      radioType: '802.11ax',
      authentication: 'WPA2-Personal',
      cipher: 'CCMP (AES)',
      signal: 84,
      rssi: -54,
      rxRate: 1201,     // Mbps, link rate negotiated with AP
      txRate: 960,
      profile: 'HomeNet_5G',
      connectionMode: 'Tự động kết nối',
      adapter: 'Intel(R) Wi-Fi 6 AX201 160MHz',
      driver: '23.60.0.10',
      mac: '3c:58:c2:1f:a0:7d',
      connectedSince: Date.now() - (3 * 3600 + 27 * 60) * 1000,
    };

    const network = {
      hostname: 'DESKTOP-DEMO',
      ipv4: '192.168.1.105',
      subnet: '255.255.255.0',
      gateway: '192.168.1.1',
      dns: ['192.168.1.1', '1.1.1.1', '8.8.8.8'],
      ipv6: 'fe80::9c1a:4e2f:7b3d:12a8%14',
      ipv6Global: '2402:800:6371:d1e5:9c1a:4e2f:7b3d:12a8',
      dhcp: true,
      dhcpServer: '192.168.1.1',
      leaseObtained: Date.now() - 5 * 3600e3,
      leaseExpires: Date.now() + 19 * 3600e3,
      publicIp: '113.161.xx.xx',
      isp: 'VNPT',
      mtu: 1500,
    };

    const adapters = [
      { name: 'Wi-Fi', desc: 'Intel(R) Wi-Fi 6 AX201 160MHz', type: 'Wireless', status: 'Up', speed: 1201e6, mac: '3C-58-C2-1F-A0-7D', ipv4: '192.168.1.105', rx: 48.2 * GB, tx: 6.1 * GB },
      { name: 'Ethernet', desc: 'Realtek PCIe 2.5GbE Family Controller', type: 'Ethernet', status: 'Disconnected', speed: 0, mac: '18-C0-4D-8A-22-01', ipv4: '—', rx: 0, tx: 0 },
      { name: 'vEthernet (WSL)', desc: 'Hyper-V Virtual Ethernet Adapter', type: 'Virtual', status: 'Up', speed: 10e9, mac: '00-15-5D-E4-11-30', ipv4: '172.24.160.1', rx: 0.3 * GB, tx: 0.2 * GB },
      { name: 'Bluetooth Network', desc: 'Bluetooth Device (PAN)', type: 'Bluetooth', status: 'Disconnected', speed: 0, mac: '3C-58-C2-1F-A0-7E', ipv4: '—', rx: 0, tx: 0 },
    ];

    let capacity = { down: 312e6, up: 118e6, ping: 9, at: Date.now() - 2 * 3600e3, server: 'VNPT HCM' };

    /* ---- traffic generator: idle browsing + occasional streaming / big downloads ---- */
    let mode = 'browse', modeLeft = 20, d = 4e6, u = 0.6e6;
    let sessionDown = 0, sessionUp = 0;
    let todayDown = 6.4 * GB, todayUp = 0.82 * GB;
    let lastTs = Date.now();
    function nextTraffic() {
      if (--modeLeft <= 0) {
        const r = rnd();
        mode = r < 0.55 ? 'browse' : r < 0.8 ? 'stream' : r < 0.93 ? 'download' : 'upload';
        modeLeft = 10 + Math.floor(rnd() * 40);
      }
      const target = {
        browse: [2e6 + rnd() * 10e6 * (rnd() < 0.15 ? 4 : 1), 0.3e6 + rnd() * 1.5e6],
        stream: [18e6 + rnd() * 14e6, 0.8e6 + rnd() * 1e6],
        download: [160e6 + rnd() * 130e6, 2e6 + rnd() * 3e6],
        upload: [6e6 + rnd() * 8e6, 50e6 + rnd() * 55e6],
      }[mode];
      d += (target[0] - d) * 0.45; u += (target[1] - u) * 0.45;
      return [Math.max(5e4, d * (0.9 + rnd() * 0.2)), Math.max(2e4, u * (0.9 + rnd() * 0.2))];
    }

    let ping = 12, sig = wifi.signal;
    function nextQuality() {
      const spike = rnd() < 0.04 ? 60 + rnd() * 140 : 0;
      ping = clamp(ping + (11 - ping) * 0.3 + (rnd() - 0.5) * 5, 6, 400);
      const p = ping + spike;
      sig = clamp(sig + (84 - sig) * 0.1 + (rnd() - 0.5) * 4, 20, 99);
      return { ping: +p.toFixed(1), jitter: +(Math.abs(rnd() - 0.5) * 4 + (spike ? spike / 6 : 0)).toFixed(1), loss: rnd() < 0.015 ? 1 : 0, signal: Math.round(sig) };
    }

    /* ---- historical series (stable via seeded RNG) ---- */
    const hourlyProfile = [0.25, 0.15, 0.1, 0.08, 0.07, 0.1, 0.25, 0.45, 0.55, 0.6, 0.62, 0.66, 0.7, 0.6, 0.58, 0.62, 0.7, 0.8, 0.95, 1, 0.98, 0.9, 0.7, 0.45];
    function usageBuckets(range) {
      const r = NP.rng(range.length * 977 + 13);
      const now = new Date();
      const out = [];
      if (range === '24h') {
        for (let i = 23; i >= 0; i--) {
          const t = new Date(now); t.setMinutes(0, 0, 0); t.setHours(t.getHours() - i);
          const f = hourlyProfile[t.getHours()] * (0.6 + r() * 0.8);
          const dn = f * 1.2 * GB, up = dn * (0.08 + r() * 0.1);
          out.push({ ts: +t, label: `${NP.pad(t.getHours())}h`, down: dn, up, avg: (dn * 8) / 3600 * (2 + r()), peak: 40e6 + f * 240e6 * r(), observed: true });
        }
      } else if (range === '7d' || range === '30d') {
        const n = range === '7d' ? 7 : 30;
        for (let i = n - 1; i >= 0; i--) {
          const t = new Date(now); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - i);
          const wk = [0, 6].includes(t.getDay()) ? 1.35 : 1;
          const dn = (7 + r() * 9) * wk * GB, up = dn * (0.07 + r() * 0.08);
          out.push({ ts: +t, label: `${NP.pad(t.getDate())}/${NP.pad(t.getMonth() + 1)}`, down: dn, up, avg: 6e6 + r() * 10e6, peak: 180e6 + r() * 120e6, observed: true });
        }
      } else {
        for (let i = 11; i >= 0; i--) {
          const t = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const dn = (220 + r() * 160) * GB, up = dn * (0.08 + r() * 0.06);
          out.push({ ts: +t, label: `T${t.getMonth() + 1}/${String(t.getFullYear()).slice(2)}`, down: dn, up, avg: 7e6 + r() * 8e6, peak: 250e6 + r() * 60e6, observed: true });
        }
      }
      // current period includes live counters
      if (range === '7d' || range === '30d') { out[out.length - 1].down = todayDown; out[out.length - 1].up = todayUp; }
      return out;
    }

    function heatmap() {
      const r = NP.rng(4242);
      return Array.from({ length: 7 }, (_, day) =>
        Array.from({ length: 24 }, (_, h) => {
          const wk = day >= 5 ? 1.3 : 1;
          return hourlyProfile[h] * wk * (0.55 + r() * 0.9) * 1.1 * GB;
        })
      );
    }

    function qualityHistory(range) {
      const cfg = { '1h': [60, 60e3], '24h': [96, 15 * 60e3], '7d': [84, 2 * 3600e3] }[range];
      const r = NP.rng(range.length * 31 + 7);
      const now = Date.now();
      let p = 12;
      return Array.from({ length: cfg[0] }, (_, i) => {
        p = clamp(p + (12 - p) * 0.3 + (r() - 0.5) * 6, 6, 300);
        const spike = r() < 0.06 ? 40 + r() * 120 : 0;
        const avg = p + spike * 0.5;
        return {
          ts: now - (cfg[0] - 1 - i) * cfg[1],
          avg: +avg.toFixed(1), min: +(avg * (0.6 + r() * 0.2)).toFixed(1), max: +(avg + 5 + spike).toFixed(1),
          jitter: +(1 + r() * 3 + spike / 8).toFixed(1),
          loss: r() < 0.08 ? +(r() * 3).toFixed(1) : 0, sent: cfg[1] / 1000,
          signal: Math.round(clamp(84 + (r() - 0.5) * 14 - (spike ? 10 : 0), 30, 99)),
        };
      });
    }

    const EVT = [
      ['connect', 'good', 'link', 'Kết nối Wi-Fi', () => `Đã kết nối tới ${wifi.ssid} (${wifi.band}, kênh ${wifi.channel})`],
      ['disconnect', 'crit', 'unlink', 'Mất kết nối', () => `Ngắt kết nối khỏi ${wifi.ssid} — lý do: tín hiệu yếu`],
      ['roam', 'info', 'radio', 'Chuyển điểm truy cập', () => 'BSSID a4:2b:b0:7c:19:e1 → a4:2b:b0:7c:19:e2'],
      ['high_latency', 'warn', 'timer', 'Độ trễ cao', () => `Ping tới ${NP.settings.pingTarget} đạt ${Math.round(150 + Math.random() * 200)} ms`],
      ['packet_loss', 'warn', 'alert', 'Mất gói', () => `Mất ${(1 + Math.random() * 6).toFixed(1)}% gói trong 1 phút`],
      ['signal_drop', 'warn', 'wifi', 'Tín hiệu giảm', () => `RSSI giảm xuống ${-70 - Math.round(Math.random() * 10)} dBm`],
      ['ip_change', 'info', 'hash', 'Thay đổi IP', () => 'DHCP cấp IP mới 192.168.1.105'],
      ['dns_change', 'info', 'server', 'Thay đổi DNS', () => 'DNS: 192.168.1.1, 1.1.1.1, 8.8.8.8'],
      ['speedtest', 'good', 'gauge', 'Speed test hoàn tất', () => `↓ ${Math.round(280 + Math.random() * 50)} Mbps · ↑ ${Math.round(100 + Math.random() * 25)} Mbps`],
      ['usage_alert', 'warn', 'database', 'Cảnh báo dung lượng', () => 'Đã dùng 80% hạn mức tháng'],
      ['agent', 'info', 'cpu', 'Agent khởi động', () => 'Local agent bắt đầu thu thập dữ liệu'],
    ];
    const events = (() => {
      const r = NP.rng(99);
      const list = [];
      let t = Date.now() - 60e3;
      for (let i = 0; i < 160; i++) {
        t -= (5 + r() * 120) * 60e3;
        const w = r();
        const e = EVT[w < 0.12 ? 0 : w < 0.2 ? 1 : w < 0.3 ? 2 : w < 0.5 ? 3 : w < 0.6 ? 4 : w < 0.7 ? 5 : w < 0.76 ? 6 : w < 0.8 ? 7 : w < 0.9 ? 8 : w < 0.95 ? 9 : 10];
        list.push({ id: 1000 - i, ts: t, type: e[0], level: e[1], icon: e[2], title: e[3], detail: e[4]() });
      }
      return list;
    })();

    return {
      name: 'demo',

      async getStatus() {
        return { online: true, agent: 'demo', version: 'demo', startedAt, interfaceType: 'wifi', name: wifi.ssid, capacity, eventSeq: events[0]?.id || 0, admin: false, dataDir: '—', dbPath: '—', dbSize: 0 };
      },

      /** One realtime tick. Backend: WS /ws/realtime pushes the same shape. */
      async sample() {
        const now = Date.now();
        const dt = Math.max(0.2, (now - lastTs) / 1000); lastTs = now;
        const [down, up] = nextTraffic();
        const q = nextQuality();
        sessionDown += (down / 8) * dt; sessionUp += (up / 8) * dt;
        todayDown += (down / 8) * dt; todayUp += (up / 8) * dt;
        return { ts: now, down, up, ...q, sessionDown, sessionUp, todayDown, todayUp, monthDown: todayDown + 260 * GB, monthUp: todayUp + 21 * GB };
      },
      async samples() { return { samples: [await this.sample()], eventSeq: events[0]?.id || 0, status: { online: true, name: wifi.ssid, interfaceType: 'wifi' } }; },
      async prefill(n) {
        const out = [];
        for (let i = 0; i < n; i++) { const s = await this.sample(); s.ts = Date.now() - (n - i) * 1000; out.push(s); }
        return { samples: out, eventSeq: events[0]?.id || 0 };
      },
      async getSettings() { return { ...NP.settings }; },
      async saveSettings(p) { return { ...NP.settings, ...p }; },
      async resetSettings() { return null; },
      async wipeData() { return { ok: true }; },
      async clearEvents() { events.length = 0; return { ok: true }; },

      async getWifi() { return { ...wifi, signal: Math.round(sig), rssi: Math.round(-100 + sig * 0.55) }; },
      async getNetwork() { return { ...network }; },
      async getAdapters() { return adapters.map((a) => ({ ...a })); },
      async getCapacity() { return { ...capacity }; },

      async scanWifi() {
        await sleep(1200);
        const r = Math.random;
        const base = [
          [wifi.ssid, wifi.bssid, '5 GHz', 44, 'WPA2-Personal', '802.11ax', 84],
          ['HomeNet', 'a4:2b:b0:7c:19:e0', '2.4 GHz', 6, 'WPA2-Personal', '802.11n', 78],
          ['TP-Link_A3F2', '50:c7:bf:a3:f2:11', '2.4 GHz', 1, 'WPA2-Personal', '802.11n', 61],
          ['Viettel_Fiber', 'e4:c3:2a:91:0b:5c', '5 GHz', 149, 'WPA3-Personal', '802.11ax', 52],
          ['FPT Telecom-8C12', '9c:a2:f4:8c:12:77', '2.4 GHz', 11, 'WPA2-Personal', '802.11ac', 44],
          ['Cafe_Free', '00:1e:58:22:4d:aa', '2.4 GHz', 6, 'Open', '802.11n', 33],
          ['DIRECT-7B-HP Printer', 'fa:da:0c:7b:00:01', '2.4 GHz', 11, 'WPA2-Personal', '802.11n', 28],
          ['Mesh_Node_2', 'a4:2b:b0:7c:19:e5', '5 GHz', 36, 'WPA2-Personal', '802.11ax', 66],
        ];
        return base.map(([ssid, bssid, band, channel, security, standard, s]) => {
          const signal = clamp(Math.round(s + (r() - 0.5) * 8), 5, 99);
          return { ssid, bssid, band, channel, security, standard, signal, rssi: Math.round(-100 + signal * 0.55), connected: bssid === wifi.bssid };
        });
      },

      async connectWifi(ssid, password) {
        await sleep(1500);
        if (ssid === 'Cafe_Free') return { ok: true };
        if (password == null) return { ok: false, needPassword: true };
        return password === 'wrongpass' ? { ok: false, error: 'Không kết nối được — sai mật khẩu hoặc tín hiệu quá yếu' } : { ok: true };
      },

      async getUsage(range = '24h') { return usageBuckets(range); },
      async getHeatmap() { return heatmap(); },
      async getQuality(range = '1h') { return qualityHistory(range); },
      async getTargets() {
        const r = Math.random;
        return [
          { name: 'Gateway', host: network.gateway, ping: +(1.5 + r() * 2).toFixed(1), jitter: +(r() * 0.8).toFixed(1), loss: 0 },
          { name: 'Cloudflare DNS', host: '1.1.1.1', ping: +(8 + r() * 6).toFixed(1), jitter: +(0.5 + r() * 2).toFixed(1), loss: 0 },
          { name: 'Google DNS', host: '8.8.8.8', ping: +(22 + r() * 10).toFixed(1), jitter: +(1 + r() * 3).toFixed(1), loss: r() < 0.2 ? 1 : 0 },
          { name: 'Singapore (AWS)', host: 'ec2.ap-southeast-1', ping: +(38 + r() * 14).toFixed(1), jitter: +(2 + r() * 4).toFixed(1), loss: 0 },
        ];
      },
      async getEvents(after = 0) { return events.filter((e) => e.id > after); },
      async activeJobs() { return {}; },
      async getSpeedHistory() {
        const r = NP.rng(321);
        return Array.from({ length: 14 }, (_, i) => ({
          ts: Date.now() - (13 - i) * 12 * 3600e3,
          down: (270 + r() * 60) * MB, up: (100 + r() * 25) * MB, ping: +(8 + r() * 6).toFixed(0), server: 'VNPT HCM',
        }));
      },

      /* ---------------- tools ---------------- */
      async speedTest(onProgress) {
        const res = { ping: 0, jitter: 0, down: 0, up: 0 };
        onProgress({ phase: 'ping', progress: 0 });
        for (let i = 0; i < 10; i++) { await sleep(120); res.ping = +(8 + Math.random() * 5).toFixed(0); onProgress({ phase: 'ping', progress: (i + 1) / 10, ping: res.ping }); }
        res.jitter = +(0.8 + Math.random() * 2).toFixed(1);
        const ramp = async (phase, target) => {
          let v = 0, sum = 0;
          for (let i = 0; i < 50; i++) {
            await sleep(90);
            v += (target * (0.85 + Math.random() * 0.25) - v) * 0.18;
            sum += v;
            onProgress({ phase, progress: (i + 1) / 50, value: v });
          }
          return sum / 50 * 1.12;
        };
        res.down = await ramp('download', 300e6 + Math.random() * 40e6);
        res.up = await ramp('upload', 112e6 + Math.random() * 15e6);
        capacity = { down: res.down, up: res.up, ping: res.ping, at: Date.now(), server: 'VNPT HCM' };
        onProgress({ phase: 'done', progress: 1 });
        return res;
      },

      async ping(host, count, onLine) {
        onLine(`Pinging ${host} with 32 bytes of data:`, 'dim');
        const times = [];
        for (let i = 0; i < count; i++) {
          await sleep(550);
          if (Math.random() < 0.04) { onLine('Request timed out.', 'er'); continue; }
          const t = Math.round((host.startsWith('192.168') ? 2 : 10) + Math.random() * 12);
          times.push(t);
          onLine(`Reply from ${host}: bytes=32 time=${t}ms TTL=${host.startsWith('192.168') ? 64 : 57}`, 'ok');
        }
        const lost = count - times.length;
        onLine('');
        onLine(`Ping statistics for ${host}:`, 'p');
        onLine(`    Packets: Sent = ${count}, Received = ${times.length}, Lost = ${lost} (${Math.round((lost / count) * 100)}% loss)`);
        if (times.length) onLine(`    Minimum = ${Math.min(...times)}ms, Maximum = ${Math.max(...times)}ms, Average = ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms`);
        return { times, lost };
      },

      async dns(host, type) {
        await sleep(300 + Math.random() * 300);
        const recs = {
          A: [{ type: 'A', value: '142.250.199.78', ttl: 179 }, { type: 'A', value: '142.250.66.46', ttl: 179 }],
          AAAA: [{ type: 'AAAA', value: '2404:6800:4005:81a::200e', ttl: 300 }],
          MX: [{ type: 'MX', value: '10 smtp.' + host, ttl: 3600 }],
          NS: [{ type: 'NS', value: 'ns1.' + host, ttl: 86400 }, { type: 'NS', value: 'ns2.' + host, ttl: 86400 }],
          TXT: [{ type: 'TXT', value: '"v=spf1 include:_spf.' + host + ' ~all"', ttl: 3600 }],
          CNAME: [{ type: 'CNAME', value: 'edge.' + host + '.cdn.net', ttl: 600 }],
        }[type] || [];
        return { server: network.dns[0], time: Math.round(8 + Math.random() * 30), records: recs, error: null };
      },

      async traceroute(host, onHop) {
        const hops = [
          ['192.168.1.1', 'router.local'], ['100.64.0.1', '—'], ['113.171.36.1', 'static.vnpt.vn'],
          ['113.171.5.18', 'static.vnpt.vn'], ['*', '*'], ['72.14.213.110', '—'], ['108.170.250.33', '—'], ['142.250.199.78', host],
        ];
        let base = 1;
        for (let i = 0; i < hops.length; i++) {
          await sleep(420);
          base += i === 0 ? 0 : 2 + Math.random() * 6;
          const [ip, name] = hops[i];
          onHop({ hop: i + 1, ip, name, rtt: ip === '*' ? null : [0, 1, 2].map(() => +(base + Math.random() * 3).toFixed(0)) });
        }
      },

      async action(name) {
        await sleep(900 + Math.random() * 900);
        const out = {
          flushdns: 'Windows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.',
          renew: 'Windows IP Configuration\n\nWireless LAN adapter Wi-Fi:\n   IPv4 Address. . . . . . : 192.168.1.105\n   Default Gateway . . . . : 192.168.1.1',
          release: 'Windows IP Configuration\n\nWireless LAN adapter Wi-Fi:\n   IPv4 Address released.',
          reconnect: `Disconnection request was completed successfully.\nConnection request was completed successfully for ${wifi.ssid}.`,
          resetWinsock: 'Successfully reset the Winsock Catalog.\nYou must restart the computer in order to complete the reset.',
          diag: 'Đã chạy chẩn đoán: Gateway OK · DNS OK · Internet OK · Không phát hiện sự cố.',
        }[name] || 'OK';
        return { ok: true, output: out };
      },
    };
  }

  /* ------------------------------------------------------------------ */
  function HttpProvider(base = '') {
    const req = async (method, path, body) => {
      const r = await fetch(base + path, {
        method,
        headers: { 'X-NetPulse': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        let detail;
        try { detail = (await r.json()).detail; } catch { /* not JSON */ }
        const e = new Error(detail || `HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      return r.json();
    };
    const get = (p) => req('GET', p);
    /** Poll a background job until done, handing each increment to onUpdate. */
    const pollJob = async (id, onUpdate) => {
      let line = 0, item = 0;
      for (;;) {
        const j = await get(`/api/jobs/${id}?line=${line}&item=${item}`);
        line += j.lines.length; item += j.items.length;
        onUpdate(j);
        if (j.done) return j;
        await sleep(250);
      }
    };
    let lastTs = 0;

    return {
      name: 'agent',
      getStatus: () => get('/api/status'),
      async prefill(n) {
        const r = await get(`/api/live?n=${n}`);
        if (r.samples.length) lastTs = r.samples[r.samples.length - 1].ts;
        return r;
      },
      async samples() {
        const r = await get(`/api/live?since=${lastTs}`);
        if (r.samples.length) lastTs = r.samples[r.samples.length - 1].ts;
        return r;
      },
      getWifi: () => get('/api/wifi'),
      getNetwork: () => get('/api/network'),
      getAdapters: () => get('/api/adapters'),
      getCapacity: () => get('/api/capacity'),
      scanWifi: () => req('POST', '/api/wifi/scan'),
      connectWifi: (ssid, password) => req('POST', '/api/wifi/connect', { ssid, password }),
      getUsage: (range = '24h') => get(`/api/usage?range=${range}`),
      getHeatmap: () => get('/api/usage/heatmap'),
      getQuality: (range = '1h') => get(`/api/quality?range=${range}`),
      getTargets: () => get('/api/quality/targets'),
      getEvents: (after = 0) => get(`/api/events?after=${after}`),
      clearEvents: () => req('DELETE', '/api/events'),
      getSpeedHistory: () => get('/api/speedtest/history'),

      /* Tools run as agent jobs that outlive the page. Pass jobId (from activeJobs) to re-attach
         to one already running: polling from 0 replays its output so far, then follows it live. */
      activeJobs: () => get('/api/jobs/active'),
      async speedTest(onProgress, jobId) {
        const job = jobId || (await req('POST', '/api/tools/speedtest')).job;
        const j = await pollJob(job, (x) => x.items.forEach((p) => p.phase && p.phase !== 'done' && onProgress(p)));
        if (j.error) throw new Error(j.error);
        onProgress({ phase: 'done', progress: 1 });
        return j.result;
      },
      async ping(host, count, onLine, jobId) {
        const job = jobId || (await req('POST', '/api/tools/ping', { host, count })).job;
        const j = await pollJob(job, (x) => x.lines.forEach((l) => onLine(l.text, l.cls)));
        return j.result;
      },
      async traceroute(host, onHop, jobId) {
        const job = jobId || (await req('POST', '/api/tools/traceroute', { host })).job;
        const j = await pollJob(job, (x) => x.items.forEach(onHop));
        if (j.error) throw new Error(j.error);
        return j.result;
      },
      dns: (host, type) => req('POST', '/api/tools/dns', { host, type }),
      action: (name, elevate = false) => req('POST', `/api/actions/${name}`, { elevate }),

      getSettings: () => get('/api/settings'),
      saveSettings: (patch) => req('PUT', '/api/settings', patch),
      markSeen: (id) => req('POST', '/api/events/seen', { id }),
      resetSettings: () => req('DELETE', '/api/settings'),
      wipeData: () => req('DELETE', '/api/data'),
    };
  }

  /* ------------------------------------------------------------------ */
  /* The agent writes its messages (event log, tool output, errors) in Vietnamese and stores them
     that way. Translate them on the way in, so pages always receive the current UI language. */
  function localize(api) {
    const tx = (s) => NP.tx(s);
    const out = {};
    for (const [k, fn] of Object.entries(api)) {
      out[k] = typeof fn !== 'function' ? fn : async (...args) => {
        try { return await fn.apply(api, args); }
        catch (e) { if (e && typeof e.message === 'string') e.message = tx(e.message); throw e; }
      };
    }
    const map = (k, f) => { const g = out[k]; out[k] = async (...a) => f(await g(...a)); };
    map('getEvents', (l) => l.map((e) => ({ ...e, title: tx(e.title), detail: tx(e.detail) })));
    map('action', (r) => ({ ...r, output: tx(r.output) }));
    map('dns', (r) => ({ ...r, error: tx(r.error) }));
    map('scanWifi', (l) => l.map((x) => ({ ...x, ssid: x.hidden ? tx(x.ssid) : x.ssid })));
    map('connectWifi', (r) => ({ ...r, error: tx(r.error) }));
    map('getAdapters', (l) => l.map((a) => ({ ...a, type: tx(a.type) })));
    map('getTargets', (l) => l.map((t) => ({ ...t, name: tx(t.name) })));
    map('getWifi', (w) => ({ ...w, error: tx(w.error), connectionMode: tx(w.connectionMode) }));
    const ping = out.ping;
    out.ping = (host, count, onLine, jobId) => ping(host, count, (l, c) => onLine(tx(l), c), jobId);
    return out;
  }

  NP.demo = /[?&]demo\b/.test(location.search);
  NP.api = localize(NP.demo ? MockProvider() : HttpProvider());
})();
