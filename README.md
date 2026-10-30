# NetPulse — Local Network Monitor

Trung tâm giám sát mạng cá nhân chạy trên localhost (Windows): lưu lượng thời gian thực, Wi-Fi,
chất lượng kết nối, thống kê lịch sử, log sự kiện và công cụ mạng. Yêu cầu gốc: [info.md](info.md).
Đặc tả đầy đủ từng chức năng: [DAC_TA.md](DAC_TA.md).

## Yêu cầu

- Windows 10/11 x64. Mới kiểm thử trên Windows 11 build 26100, card Wi-Fi Intel AX211; cấu hình khác chưa kiểm thử.
- Python 3.10+ (đã kiểm tra với 3.11), khi cài nhớ tick **Add python.exe to PATH**.
- Git (để clone và cập nhật).
- Có Internet ở lần cài đầu (`pip` tải thư viện).

## Cài đặt

```bat
git clone <url-repo> OPT_WIFI
cd OPT_WIFI
setup.bat
start.bat
```

Mở http://127.0.0.1:8765 (`start.bat` tự mở trình duyệt).

## Cập nhật

```bat
stop.bat
git pull
setup.bat
start.bat
```

Chạy lại `setup.bat` để cài thư viện mới nếu `backend/requirements.txt` thay đổi. Dữ liệu trong `data/`
không nằm trong git nên được giữ nguyên khi pull.

## Chạy

| Việc | Cách |
|---|---|
| Lần đầu / cài thư viện | `setup.bat` (tự chạy khi gọi `start.bat` lần đầu) |
| Chạy có cửa sổ console | `start.bat` → mở http://127.0.0.1:8765 |
| Chạy nền, không cửa sổ | `start-hidden.vbs` |
| Dừng | `stop.bat` (hoặc đóng cửa sổ console) |
| Xem giao diện với dữ liệu mô phỏng | http://127.0.0.1:8765/?demo |

Agent phải đang chạy thì mới ghi được lịch sử.

## Mọi thứ nằm trong thư mục này

```
OPT_WIFI/
  .venv/        thư viện Python (fastapi, uvicorn, psutil, dnspython) — tạo bởi setup.bat, không dùng pip cache
  data/         netpulse.db (SQLite), settings.json, logs/, tmp/
  backend/      agent (Python)
  frontend/     giao diện (HTML/CSS/JS thuần, Chart.js lưu cục bộ — chạy được khi mất mạng)
```

Không ghi registry, không tạo service, không đặt gì vào Startup, không dùng localStorage của trình duyệt.
**Xoá thư mục `OPT_WIFI` là gỡ sạch**, trừ hai điều: Python của hệ thống chỉ được dùng để tạo `.venv` và không bị thay đổi; và khi bạn
dùng nút **Kết nối** với một mạng mới, Windows lưu hồ sơ Wi-Fi (kèm mật khẩu, do Windows mã hoá) giống như khi kết nối trong Settings.
Hồ sơ đó nằm ngoài thư mục này; xoá bằng `netsh wlan delete profile name="<tên mạng>"` hoặc trong Settings → Network & internet → Wi-Fi → Manage known networks.

## Dữ liệu lấy từ đâu

| Dữ liệu | Nguồn |
|---|---|
| Lưu lượng ↓/↑ | `psutil` byte counters của giao diện có default route, mỗi `refreshMs` (mặc định 1 s) |
| Wi-Fi (SSID, BSSID, chuẩn, kênh, độ rộng kênh, RSSI, tốc độ liên kết, bảo mật), quét mạng xung quanh | Native WiFi API `wlanapi.dll` (ctypes) — không phụ thuộc ngôn ngữ Windows |
| IP, subnet, gateway, DNS, DHCP lease, adapter, driver | PowerShell `Get-NetAdapter`, `Win32_NetworkAdapterConfiguration`, `Get-NetRoute` → JSON, làm mới mỗi 30 s |
| Ping / jitter / mất gói | `IcmpSendEcho` (iphlpapi) tới mục tiêu cấu hình, mỗi 1 s — không cần admin |
| IP public, ISP, vị trí | `speed.cloudflare.com/meta`, mỗi 30 phút (tắt được trong Cài đặt) |
| Speed test | Cloudflare (`speed.cloudflare.com`): latency = TCP handshake; 6 luồng download/upload × 10 s, bỏ 2 s đầu (TCP slow start) |

Ba loại "tốc độ" được tách bạch trên giao diện: **đang dùng thực tế** (counters) · **Internet đo được**
(speed test) · **tốc độ liên kết** Wi-Fi/Ethernet. "Mức tối đa" trên biểu đồ ưu tiên: speed test →
gói cước (nhập trong Cài đặt) → tốc độ liên kết.

## Lưu trữ

- `traffic_min`, `quality_min`: chi tiết theo phút, giữ theo `retentionDays` (mặc định 90 ngày)
- `traffic_hour`: tổng theo giờ, giữ 3 năm (dùng cho thống kê ngày/tháng/năm). Khoảng agent không chạy là **chưa đo**, không được tính là 0 GB hoặc mất Internet.
- Tổng tháng và cảnh báo hạn mức chỉ tính dung lượng **đã đo khi agent chạy**; nếu dùng mạng lúc agent tắt, số liệu có thể thấp hơn số nhà mạng tính.
- `events`, `speedtests`

## Sự kiện tự động ghi log

Kết nối / mất / chuyển Wi-Fi, roaming (đổi BSSID), mất Internet (5 ping liên tiếp) và khôi phục,
độ trễ cao (TB 10 s ≥ ngưỡng nghiêm trọng), mất gói (≥ 3 gói & ≥ ngưỡng %/phút), tín hiệu yếu (> 10 s),
đổi IP / gateway / DNS / giao diện chính, speed test, vượt 80% / 100% hạn mức tháng, agent khởi động
(ghi rõ khoảng không thu thập kể từ lần chạy trước, kể cả khi đã dừng bình thường).

## Bảo mật

Agent chỉ lắng nghe `127.0.0.1`. Request phải có Host là localhost (chống DNS rebinding); các lệnh thay
đổi trạng thái (POST/PUT/DELETE) phải có header `X-NetPulse: 1`, nên trang web lạ không gọi được. Host
nhập vào công cụ được kiểm tra trước khi dùng. Lệnh cần quyền Administrator (vd. `ipconfig /flushdns`
trên một số máy, `netsh winsock reset`) chỉ chạy qua hộp thoại UAC khi bạn đồng ý.

## API

Tài liệu tự sinh: http://127.0.0.1:8765/api/docs. Các endpoint chính: `/api/status`, `/api/live`,
`/api/wifi`, `/api/wifi/scan`, `/api/wifi/connect`, `/api/wifi/switch`, `/api/network`, `/api/adapters`, `/api/usage?range=24h|7d|30d|12m`,
`/api/usage/heatmap`, `/api/quality?range=1h|24h|7d`, `/api/quality/targets`, `/api/events`,
`/api/speedtest/history`, `/api/tools/{speedtest,ping,traceroute,dns}`, `/api/jobs/{id}`, `/api/jobs/active`,
`/api/actions/{flushdns,renew,release,reconnect,disconnect,resetWinsock,diag}`, `/api/settings`, `/api/data`.

## Lưu ý

- Windows 11 24H2+: cần bật **Settings → Privacy & security → Location → Let desktop apps access your
  location** để đọc tên Wi-Fi và quét mạng xung quanh (giao diện sẽ nhắc nếu thiếu).
- Mỗi speed test tốn khoảng 100–500 MB dữ liệu; đo tự động mặc định tắt.
- Muốn agent tự chạy cùng Windows: tạo shortcut tới `start-hidden.vbs` trong thư mục Startup
  (`shell:startup`). Không làm sẵn vì việc này ghi ra ngoài thư mục `OPT_WIFI`.
