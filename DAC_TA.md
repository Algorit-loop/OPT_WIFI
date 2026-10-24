# NetPulse — Tài liệu đặc tả

| | |
|---|---|
| **Sản phẩm** | NetPulse — Local Network Monitoring & Analytics Dashboard |
| **Phiên bản** | 1.0.0 |
| **Nền tảng** | Windows 10/11, chạy trên localhost (`http://127.0.0.1:8765`) |
| **Yêu cầu gốc** | [info.md](info.md) |
| **Hướng dẫn nhanh** | [README.md](README.md) |
| **Trạng thái** | Hoàn thiện, chờ review |

---

## Mục lục

1. [Tổng quan: đã làm những gì](#1-tổng-quan-đã-làm-những-gì)
2. [Cài đặt và vận hành](#2-cài-đặt-và-vận-hành)
3. [Các khái niệm cần hiểu trước](#3-các-khái-niệm-cần-hiểu-trước)
4. [Chức năng chi tiết theo từng trang](#4-chức-năng-chi-tiết-theo-từng-trang)
5. [Agent (backend) hoạt động như thế nào](#5-agent-backend-hoạt-động-như-thế-nào)
6. [Sự kiện tự động ghi log](#6-sự-kiện-tự-động-ghi-log)
7. [API](#7-api)
8. [Bảo mật](#8-bảo-mật)
9. [Dữ liệu nào rời khỏi máy](#9-dữ-liệu-nào-rời-khỏi-máy)
10. [Đối chiếu với yêu cầu gốc](#10-đối-chiếu-với-yêu-cầu-gốc)
11. [Kiểm thử đã thực hiện](#11-kiểm-thử-đã-thực-hiện)
12. [Giới hạn đã biết và hướng phát triển](#12-giới-hạn-đã-biết-và-hướng-phát-triển)
13. [Xử lý sự cố](#13-xử-lý-sự-cố)

---

## 1. Tổng quan: đã làm những gì

### 1.1 Mục tiêu

Xây dựng một trung tâm giám sát mạng cá nhân chạy trên máy tính, trả lời được các câu hỏi:

- Tôi **đang dùng bao nhiêu** băng thông, và **tối đa có thể dùng bao nhiêu**?
- Wi-Fi đang kết nối có **thông số kỹ thuật** gì (chuẩn, băng tần, kênh, tín hiệu, tốc độ liên kết)?
- **Cấu hình mạng** hiện tại là gì (IP, DNS, gateway, DHCP)?
- Kết nối có **ổn định** không (ping, jitter, mất gói)? Khi nào bị chập chờn?
- Tôi đã **tiêu thụ bao nhiêu dữ liệu** theo giờ / ngày / tuần / tháng?
- Đã có **sự kiện** gì xảy ra (mất mạng, đổi IP, tín hiệu yếu…)?
- Khi có vấn đề, có **công cụ** gì để kiểm tra và xử lý nhanh?

### 1.2 Hai giai đoạn đã thực hiện

**Giai đoạn 1 — Giao diện.** Dashboard dạng web, tông tối kiểu công nghệ, có hiệu ứng động, gồm 8 trang. Ở giai đoạn này giao diện chạy bằng dữ liệu mô phỏng để duyệt thiết kế.

**Giai đoạn 2 — Agent và dữ liệu thật.**
- Viết một chương trình Python chạy nền ("agent") đọc dữ liệu mạng **trực tiếp từ Windows**.
- Lưu lịch sử vào SQLite.
- Cung cấp API cho giao diện.
- Nối toàn bộ 8 trang vào dữ liệu thật.
- Dữ liệu mô phỏng vẫn giữ lại, nhưng chỉ hiện khi mở với `?demo`.

### 1.3 Kiến trúc

```
┌──────────────────────────── Trình duyệt ────────────────────────────┐
│  frontend/  (HTML + CSS + JavaScript thuần, Chart.js lưu cục bộ)      │
│  8 trang · gọi API mỗi giây · không lưu gì trong trình duyệt          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP, chỉ 127.0.0.1:8765
┌───────────────────────────────▼──────────────────────────────────────┐
│  backend/  NetPulse Agent (Python · FastAPI · uvicorn)                │
│                                                                       │
│  Collector (4 luồng nền)          Tools (chạy theo yêu cầu)           │
│  ├ traffic: bộ đếm byte, 1 s      ├ Speed test (Cloudflare)           │
│  ├ ping:    ICMP, 1 s             ├ Ping · Traceroute · DNS           │
│  ├ wifi:    WLAN API, 2 s         └ Thao tác Windows + chẩn đoán      │
│  └ slow:    cấu hình mạng 30 s,                                       │
│             IP public 30 phút, dọn dữ liệu, cảnh báo                  │
│                                │                                      │
│                    data/netpulse.db (SQLite) · data/settings.json     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
        Windows: wlanapi.dll · iphlpapi.dll · PowerShell · ipconfig/netsh
```

### 1.4 Công nghệ sử dụng

| Thành phần | Công nghệ | Lý do chọn |
|---|---|---|
| Giao diện | HTML/CSS/JS thuần, không cần build | Đơn giản, không cài Node.js |
| Biểu đồ | Chart.js 4 (lưu trong `frontend/vendor`) | Vẫn hiển thị được khi mất Internet, điều quan trọng với một công cụ giám sát mạng |
| Server | FastAPI + uvicorn | Nhẹ, có tài liệu API tự sinh |
| Bộ đếm lưu lượng | `psutil` | Đọc byte counters của card mạng |
| Thông tin Wi-Fi | Native WiFi API (`wlanapi.dll`) qua `ctypes` | Không phụ thuộc ngôn ngữ Windows, nhanh hơn chạy `netsh` |
| Ping, traceroute | `IcmpSendEcho` (`iphlpapi.dll`) qua `ctypes` | Không cần quyền admin, không phụ thuộc ngôn ngữ |
| Cấu hình mạng | PowerShell → JSON | Đầy đủ thông tin, không phụ thuộc ngôn ngữ |
| DNS lookup | `dnspython` | Hỗ trợ đủ loại bản ghi (MX, TXT, NS…) |
| Lưu trữ | SQLite (chế độ WAL) | Một file duy nhất, không cần cài database |

### 1.5 Cấu trúc thư mục

```
OPT_WIFI/
├─ info.md                yêu cầu gốc
├─ README.md              hướng dẫn nhanh
├─ DAC_TA.md              tài liệu này
├─ setup.bat              tạo .venv và cài thư viện
├─ start.bat              chạy agent có cửa sổ console
├─ start-hidden.vbs       chạy agent nền, không cửa sổ
├─ stop.bat               dừng agent êm
├─ .venv/                 thư viện Python (tạo bởi setup.bat)
├─ data/                  (tạo khi chạy)
│  ├─ netpulse.db         toàn bộ lịch sử
│  ├─ settings.json       cài đặt
│  ├─ logs/agent.log      log của agent (tự xoay vòng, tối đa ~8 MB)
│  └─ tmp/                file tạm khi chạy lệnh với quyền admin
├─ backend/
│  ├─ run.py              điểm khởi chạy
│  ├─ requirements.txt
│  └─ netpulse/
│     ├─ main.py          API + phục vụ giao diện
│     ├─ collector.py     thu thập nền + phát hiện sự kiện
│     ├─ db.py            lược đồ SQLite + truy vấn thống kê
│     ├─ netconfig.py     đọc cấu hình mạng qua PowerShell
│     ├─ speedtest.py     speed test
│     ├─ tools.py         ping, traceroute, DNS, thao tác, chẩn đoán
│     ├─ config.py        đường dẫn + cài đặt + kiểm tra hợp lệ
│     ├─ util.py
│     └─ winapi/
│        ├─ wlan.py       Native WiFi API
│        └─ icmp.py       ICMP echo
└─ frontend/
   ├─ index.html
   ├─ css/styles.css
   ├─ vendor/chart.umd.min.js
   └─ js/
      ├─ app.js           khung ứng dụng, điều hướng, vòng cập nhật
      ├─ api.js           lớp dữ liệu (agent thật / demo)
      ├─ charts.js        biểu đồ, đồng hồ đo, vòng điểm
      ├─ utils.js         định dạng, cài đặt, thông báo
      ├─ i18n.js          song ngữ Việt / Anh (NP.t, NP.tx, từ điển EN)
      ├─ icons.js
      └─ pages/           dashboard, realtime, wifi, quality,
                          analytics, logs, tools, settings
```

### 1.6 Nguyên tắc "tự chứa trong một thư mục"

Mọi thứ ứng dụng tạo ra đều nằm trong `OPT_WIFI`:

- Thư viện Python nằm trong `.venv/`. Cài với `PIP_NO_CACHE_DIR=1` nên pip không để lại cache ở thư mục người dùng.
- Dữ liệu, cài đặt, log nằm trong `data/`.
- Không ghi registry, không tạo Windows service, không đặt gì vào thư mục Startup.
- Giao diện **không** dùng `localStorage`/`sessionStorage` của trình duyệt. Mọi trạng thái (kể cả mốc "sự kiện đã xem") lưu trong database của agent.

> **Xoá thư mục `OPT_WIFI` là gỡ sạch ứng dụng.** Ngoại lệ duy nhất là Python của hệ thống: nó được dùng để tạo `.venv` nhưng không bị thay đổi.

---

## 2. Cài đặt và vận hành

### 2.1 Yêu cầu

- Windows 10 hoặc 11.
- Python 3.10 trở lên đã cài trên máy (đã kiểm tra với 3.11.9).
- Windows 11 24H2 trở lên: bật quyền **Location** cho ứng dụng desktop để đọc được tên Wi-Fi (xem [mục 13](#13-xử-lý-sự-cố)).

### 2.2 Các script

| Script | Làm gì | Khi nào dùng |
|---|---|---|
| `setup.bat` | Tạo `.venv`, cài 4 thư viện từ `backend/requirements.txt`. Chạy lại bao nhiêu lần cũng được. | Lần đầu, hoặc khi `.venv` bị hỏng/xoá. `start.bat` tự gọi nếu chưa có `.venv`. |
| `start.bat` | Chạy agent kèm cửa sổ console, tự mở trình duyệt. Đóng cửa sổ là dừng agent. | Khi muốn thấy agent đang chạy, hoặc để xem lỗi. |
| `start-hidden.vbs` | Chạy agent nền bằng `pythonw`, không có cửa sổ. | Dùng hằng ngày: để agent ghi lịch sử liên tục. |
| `stop.bat` | Gửi lệnh dừng êm tới agent. | Khi chạy bằng `start-hidden.vbs`. |

**Ví dụ:** sáng bật máy, nhấp đúp `start-hidden.vbs`, rồi mở `http://127.0.0.1:8765` bất cứ lúc nào để xem. Tối muốn tắt thì chạy `stop.bat`.

### 2.3 Hành vi khi chạy

- **Chạy khi đã có một agent khác:** `start.bat` không khởi động agent thứ hai. Nó chỉ mở trình duyệt tới agent đang chạy.
- **Dừng êm** (`stop.bat` hoặc Ctrl+C): agent ghi nốt phút dữ liệu đang dở vào database và đánh dấu "tắt bình thường".
- **Dừng đột ngột** (mất điện, kill tiến trình): lần khởi động sau, agent ghi sự kiện trung tính cho biết khoảng không thu thập dữ liệu, vì cũng có thể máy đã tắt bình thường.
- **Agent không chạy:** không có dữ liệu nào được ghi. Biểu đồ thống kê để trống khoảng đó; đây là “chưa đo”, không phải 0 GB hay mất Internet. Dừng bình thường nhiều giờ rồi mở lại cũng được ghi nhận là khoảng không thu thập.

### 2.4 Chế độ demo

Mở `http://127.0.0.1:8765/?demo` để xem giao diện với **dữ liệu mô phỏng**. Góc trên hiện huy hiệu vàng `DEMO DATA`. Chế độ này dùng để xem thử giao diện khi chưa có lịch sử. Các thao tác trong chế độ demo không tác động lên máy.

---

## 3. Các khái niệm cần hiểu trước

### 3.1 Ba loại "tốc độ" — khác nhau thế nào

Đây là điểm dễ nhầm nhất, nên NetPulse tách riêng cả ba và hiển thị cạnh nhau ở trang Thời gian thực.

| Loại | Ý nghĩa | Lấy từ đâu | Ví dụ trên máy đã test |
|---|---|---|---|
| **Đang sử dụng thực tế** | Lưu lượng máy đang thật sự truyền ngay lúc này | Bộ đếm byte của card mạng | 2–5 Mbps khi lướt web |
| **Internet đo được** | Tốc độ tối đa thực tế tới Internet | Speed test | ↓ 93 Mbps / ↑ 90 Mbps |
| **Tốc độ liên kết** (link rate) | Tốc độ giữa máy và router. Đây là trần lý thuyết, **không phải** tốc độ Internet. | Wi-Fi API hoặc card Ethernet | 270 Mbps (Wi-Fi 4, 40 MHz) |

**Ví dụ diễn giải:** link rate 270 Mbps nhưng speed test chỉ được 93 Mbps, nghĩa là nút thắt nằm ở gói cước hoặc nhà mạng chứ không phải Wi-Fi. Ngược lại, nếu link rate chỉ 50 Mbps trong khi gói cước 300 Mbps, thì Wi-Fi mới là nút thắt (tín hiệu yếu, chuẩn cũ, hoặc kênh bị nhiễu).

### 3.2 "Mức tối đa" dùng để so sánh

Các đồng hồ đo "% đang dùng" và đường "Mức tối đa" trên biểu đồ chọn mốc so sánh theo thứ tự ưu tiên:

1. **Kết quả speed test gần nhất** — chính xác nhất.
2. **Gói cước** nhập trong Cài đặt — nếu chưa từng chạy speed test.
3. **Tốc độ liên kết** Wi-Fi hoặc Ethernet — nếu chưa có cả hai mục trên.

Giao diện luôn ghi rõ đang so với mốc nào. Ví dụ: "So với internet đo được", hoặc "Chưa có kết quả speed test — đang so với tốc độ liên kết Wi-Fi. Đo ngay".

### 3.3 Giao diện mạng chính

Máy có thể có nhiều card mạng (Wi-Fi, Ethernet, card ảo của Hyper-V/WSL, Bluetooth…). NetPulse chọn **giao diện chính** là card có *default route* với metric thấp nhất và đang ở trạng thái "Up". Đó chính là card Windows đang dùng để ra Internet. Lưu lượng, IP, DNS hiển thị đều là của card này.

**Ví dụ:** đang dùng Wi-Fi rồi cắm dây mạng, Windows ưu tiên Ethernet. NetPulse tự chuyển sang đo Ethernet và ghi sự kiện "Đổi giao diện mạng chính: Wi-Fi → Ethernet".

### 3.4 Đơn vị

- **Tốc độ:** mặc định **Mbps** (megabit/giây). Đổi được sang **MB/s** trong Cài đặt (1 MB/s = 8 Mbps).
- **Dung lượng:** B, KB, MB, GB, TB (hệ 1024).

### 3.5 Điểm ổn định (0–100)

Dùng ở trang Tổng quan (60 giây gần nhất) và trang Chất lượng (theo khoảng thời gian chọn):

```
Điểm = 100 − max(0, ping_TB − 20) × 0.4 − jitter × 1.5 − %mất_gói × 8      (giới hạn 0..100)
```

| Điểm | Nhãn |
|---|---|
| ≥ 80 | Ổn định |
| 60–79 | Chập chờn |
| < 60 | Không ổn định |

**Ví dụ:** ping 28 ms, jitter 2 ms, mất 0% → 100 − 3.2 − 3 − 0 ≈ **94**, "Ổn định". Nếu ping 60 ms, jitter 15 ms, mất 3% → 100 − 16 − 22.5 − 24 ≈ **38**, "Không ổn định".

### 3.6 Ngưỡng màu sắc

| Chỉ số | Xanh (Tốt) | Vàng (Trung bình) | Đỏ (Kém) |
|---|---|---|---|
| Ping | < ngưỡng cảnh báo (mặc định 80 ms) | 80–149 ms | ≥ ngưỡng nghiêm trọng (150 ms) hoặc mất gói |
| Jitter | < 5 ms | 5–14 ms | ≥ 15 ms |
| Mất gói | < ngưỡng (1%) | 1–4.9% | ≥ 5% |
| Tín hiệu Wi-Fi | ≥ 70% | ≥ ngưỡng tín hiệu yếu (50%) | < 50% |
| RSSI | ≥ −60 dBm (≥ −50: "Xuất sắc") | −61 đến −70 dBm | < −70 dBm ("Yếu") |

Các ngưỡng ping, mất gói, tín hiệu chỉnh được trong Cài đặt. Màu sắc trên giao diện và các sự kiện cảnh báo của agent dùng cùng một bộ ngưỡng.

---

## 4. Chức năng chi tiết theo từng trang

### 4.1 Khung chung (mọi trang)

| Thành phần | Chức năng |
|---|---|
| **Thanh bên trái** | Menu 8 trang chia 3 nhóm (Giám sát / Phân tích / Hệ thống). Trên điện thoại, menu thu vào nút ☰. |
| **Huy hiệu đỏ ở "Lịch sử & Log"** | Số sự kiện **Cảnh báo/Nghiêm trọng chưa xem**. Mở trang Log là đánh dấu đã xem. |
| **Ô "Local Agent"** (dưới thanh bên) | Trạng thái agent (chấm xanh = đang kết nối), phiên bản, tần suất cập nhật, thời gian agent đã chạy. |
| **Viên thông tin trên cùng** | Tên mạng đang dùng (SSID hoặc tên card), tốc độ ↓/↑ hiện tại. Chấm đỏ khi mất Internet. |
| **Nút ⏸ Tạm dừng** | Dừng cập nhật **trên giao diện** để xem kỹ biểu đồ. Agent vẫn tiếp tục ghi dữ liệu. |
| **Nút ☀/☾** | Đổi giao diện sáng/tối. |
| **Thanh đỏ "Mất kết nối với NetPulse Agent"** | Hiện khi giao diện không gọi được agent (agent bị tắt). Tự kết nối lại khi agent chạy lại. |
| **Màn hình "Không kết nối được tới Agent"** | Hiện nếu mở trang khi agent chưa chạy. Có nút Thử lại, nút xem bản demo, và tự thử lại mỗi 5 giây. |
| **Thông báo nổi** (góc phải dưới) | Hiện khi có sự kiện mới loại cảnh báo, nghiêm trọng, kết nối, hoặc speed test xong (tắt được trong Cài đặt). |
| **Hiệu ứng** | Thẻ nổi lên và có vệt sáng theo chuột khi hover; các phần tử hiện dần khi chuyển trang; số đếm tăng dần; radar Wi-Fi quay. Tắt được trong Cài đặt. |

### 4.2 Trang Tổng quan

**Mục đích:** nhìn một lần biết ngay tình trạng mạng: đang dùng bao nhiêu, so với tối đa ra sao, Wi-Fi thế nào, có ổn định không, đã tiêu thụ bao nhiêu.

| Thẻ | Hiển thị | Hoạt động |
|---|---|---|
| **Download / Upload hiện tại** | Tốc độ tức thời, đỉnh trong 15 phút, biểu đồ nhỏ 40 giây gần nhất | Cập nhật mỗi giây |
| **Dữ liệu hôm nay** | Tổng ↓+↑ từ 0 giờ hôm nay | So % với cả ngày hôm qua (khi hôm qua có dữ liệu). Chưa có dữ liệu hôm qua thì hiện ↓/↑ riêng. |
| **Ping** | Độ trễ tới mục tiêu ping (mặc định 1.1.1.1), jitter, nhãn chất lượng | Hiện "Mất gói" khi gói ping vừa rồi không có phản hồi |
| **Lưu lượng trực tiếp** | Biểu đồ vùng ↓/↑ của 2 phút gần nhất | Công tắc **Mức tối đa** vẽ thêm đường nét đứt ở mức tối đa ([mục 3.2](#32-mức-tối-đa-dùng-để-so-sánh)) để thấy mình đang dùng bao nhiêu phần |
| **Mức sử dụng băng thông** | Đồng hồ % download đang dùng; các thanh: ↓ và ↑ so với mức tối đa, ↓ so với tốc độ liên kết, Internet đo được so với gói cước | Đồng hồ chuyển vàng khi > 60%, đỏ khi > 85% |
| **Kết nối hiện tại** | Wi-Fi: SSID, cột sóng, %, dBm, băng tần, chuẩn, kênh, link ↓/↑, thời gian đã kết nối. Ethernet: tên card, tốc độ liên kết, IPv4. | Nút "Chi tiết" sang trang Wi-Fi & Mạng |
| **Chất lượng kết nối** | Vòng điểm ổn định, ping TB, jitter, mất gói, tín hiệu của 60 giây gần nhất | Tính lại mỗi 5 giây |
| **Tiêu thụ dữ liệu** | Từ khi agent chạy, tháng này, thanh hạn mức tháng (nếu có đặt) | Thanh hạn mức chuyển đỏ khi > 90% |
| **Tiêu thụ 24 giờ qua** | Cột chồng ↓/↑ theo từng giờ | Làm mới mỗi 30 giây |
| **Sự kiện gần đây** | 6 sự kiện mới nhất | Sự kiện mới tự xuất hiện |

**Khi nào dùng:** mở hằng ngày để kiểm tra nhanh.

**Ví dụ:**
- Video bị giật. Mở Tổng quan thấy Download đang 85 Mbps, đồng hồ 91% (đỏ). Nghĩa là đường truyền đang bị dùng gần hết. Kiểm tra xem máy có đang tải gì nền không (Windows Update, OneDrive…).
- Download chỉ 3 Mbps nhưng ping đỏ 300 ms, điểm ổn định 40. Vấn đề không nằm ở băng thông mà ở chất lượng đường truyền. Xem tiếp trang Chất lượng kết nối.

### 4.3 Trang Thời gian thực

**Mục đích:** theo dõi chi tiết lưu lượng từng giây và hiểu sự khác nhau giữa ba loại tốc độ.

| Thành phần | Mô tả |
|---|---|
| **Biểu đồ lưu lượng** | ↓/↑ theo từng giây. Chọn cửa sổ **60 giây / 5 phút / 15 phút**. Rê chuột để xem giá trị chính xác từng thời điểm. Công tắc Mức tối đa như ở Tổng quan. Dòng trạng thái "Đang ghi nhận / Đã tạm dừng". |
| **Đồng hồ Download / Upload** | Tốc độ hiện tại và % so với mức tối đa |
| **Thống kê trong cửa sổ** | Với ↓ và ↑: hiện tại, trung bình, cao nhất, thấp nhất, **dung lượng đã truyền** trong cửa sổ đang chọn |
| **Ba loại "tốc độ" khác nhau** | Ba thẻ đặt cạnh nhau: đang dùng thực tế / Internet đo được / tốc độ liên kết, có thanh so sánh tương đối và lời giải thích |
| **Cường độ tín hiệu** | % tín hiệu Wi-Fi trong 2 phút gần nhất |
| **Độ trễ (Ping)** | Ping từng giây trong 2 phút gần nhất. Gói bị mất hiện thành khoảng trống. |

**Khi nào dùng:**
- Khi đang tải file lớn, muốn biết tốc độ thực.
- Khi muốn xem một ứng dụng dùng bao nhiêu băng thông: bật ứng dụng rồi quan sát.
- Khi muốn kiểm tra tín hiệu thay đổi thế nào khi di chuyển laptop sang phòng khác.

**Ví dụ:** chọn cửa sổ 5 phút, xem một video 4K. Bảng thống kê cho thấy trung bình 25 Mbps, đã truyền 940 MB, tức video 4K tốn khoảng 11 GB mỗi giờ.

### 4.4 Trang Wi-Fi & Mạng

**Mục đích:** xem toàn bộ thông số kỹ thuật của Wi-Fi và cấu hình mạng, quét các mạng xung quanh để chọn kênh tốt.

**a) Thẻ đầu trang (Wi-Fi đang kết nối)**
- Tên mạng, thời điểm bắt đầu kết nối (đọc từ nhật ký WLAN của Windows), băng tần, chuẩn Wi-Fi, kênh và độ rộng kênh, kiểu bảo mật.
- Thanh **RSSI** từ −90 đến −30 dBm, có vạch vị trí hiện tại và nhãn Xuất sắc / Tốt / Trung bình / Yếu.
- Cột sóng lớn và % chất lượng tín hiệu.
- Link Rx/Tx, độ rộng kênh, thời gian đã kết nối.
- Nút **Kết nối lại** và **Ngắt kết nối** (ngắt có hỏi xác nhận).
- Tự cập nhật mỗi 3 giây. Khi roaming sang điểm phát khác, toàn bộ thẻ vẽ lại.
- Các trạng thái khác cũng được xử lý: Wi-Fi chưa kết nối, đang dùng Ethernet, máy không có card Wi-Fi, thiếu quyền Location (hiện hướng dẫn bật).

**b) Thông số kỹ thuật Wi-Fi**

| Trường | Ý nghĩa |
|---|---|
| SSID, BSSID | Tên mạng; địa chỉ MAC của điểm phát đang kết nối |
| Chuẩn Wi-Fi đang dùng | Chuẩn thực tế đang thương lượng (vd. Wi-Fi 4). Nếu router hỗ trợ chuẩn cao hơn thì hiện thêm "(AP hỗ trợ Wi-Fi 6)" — gợi ý card hoặc cấu hình đang giới hạn. |
| Radio type | 802.11n/ac/ax… |
| Băng tần, kênh | 2.4/5/6 GHz, tần số MHz, số kênh, độ rộng kênh (20/40/80/160 MHz) |
| Xác thực, mã hoá | WPA2-Personal, WPA3… / CCMP (AES), GCMP… |
| Tốc độ nhận/gửi, tín hiệu | Link rate; % và dBm |
| Card Wi-Fi, Driver, MAC máy, Profile | Thông tin phần cứng và hồ sơ kết nối |

Có nút sao chép cạnh các giá trị như BSSID, MAC.

**c) Cấu hình mạng** (của giao diện chính)
- Hostname, tên card, IPv4, subnet, gateway, DNS.
- IPv6 link-local và global.
- DHCP (bật/tắt, máy chủ DHCP), lease nhận lúc / hết hạn (kèm "còn …").
- IP public, nhà mạng, vị trí theo IP, MTU.
- Nút làm mới.

**d) Mạng Wi-Fi xung quanh**
- Bấm **Quét lại**: agent ra lệnh cho card Wi-Fi quét, chờ khoảng 3.5 giây rồi trả về danh sách mọi điểm phát.
- Mỗi điểm phát gồm: SSID (mạng ẩn hiện "(mạng ẩn)"), BSSID, tín hiệu % và dBm, băng tần, kênh, độ rộng kênh, chuẩn, bảo mật.
- Mạng không mật khẩu được đánh dấu đỏ "Mở".

**e) Mật độ kênh**
- Biểu đồ số điểm phát trên mỗi kênh, chọn băng 2.4 / 5 / 6 GHz. Kênh của bạn tô màu riêng.
- Kèm nhận xét tự động:
  - Ở **2.4 GHz** các kênh chồng lấn nhau, nên tính mọi điểm phát cách kênh của bạn dưới 5 kênh. Ở 5/6 GHz chỉ tính điểm phát trùng kênh.
  - Nếu có từ 2 điểm phát mạnh hơn −75 dBm trên vùng đó, NetPulse khuyên đổi kênh. Ở 2.4 GHz gợi ý kênh 1, 6, 11 hoặc chuyển sang 5 GHz.

**f) Card mạng (Adapters)**
- Danh sách mọi card: tên (card chính có nhãn "Chính"), mô tả, loại (Wireless/Ethernet/Bluetooth/Virtual), trạng thái, tốc độ liên kết, MAC, IPv4.
- Byte đã nhận/gửi, tính từ lúc khởi động Windows.

**Khi nào dùng:** cần biết IP để cấu hình thiết bị khác; kiểm tra máy đang ở 2.4 hay 5 GHz; nghi bị nhiễu kênh; muốn biết DHCP lease còn bao lâu.

**Ví dụ (máy đã test):** đang dùng `ZONEHOME P404` ở 2.4 GHz kênh 9, link 270 Mbps. Quét thấy 4 điểm phát khác chồng lấn kênh, nhưng đều yếu hơn −75 dBm nên NetPulse đánh giá "mức nhiễu thấp". Nếu router có băng 5 GHz, chuyển sang băng đó sẽ có link rate cao hơn nhiều.

### 4.5 Trang Chất lượng kết nối

**Mục đích:** đánh giá độ ổn định đường truyền theo thời gian, tìm ra thời điểm chập chờn.

Chọn khoảng thời gian: **1 giờ** (mỗi điểm = 1 phút), **24 giờ** (mỗi điểm = 15 phút), **7 ngày** (mỗi điểm = 2 giờ).

| Thành phần | Mô tả |
|---|---|
| **Điểm ổn định** | Vòng điểm theo công thức ở [mục 3.5](#35-điểm-ổn-định-0100); **Uptime** = % khoảng có đo không bị mất ≥ 50% gói; **độ phủ đo** ≈ số gói ping đã thử / số giây trong khoảng chọn |
| **Ping / Jitter / Mất gói trung bình** | Kèm min, max ping và số khoảng có mất gói |
| **Độ trễ theo thời gian** | Đường ping trung bình, vùng tô dải min–max, hai đường nét đứt ở ngưỡng cảnh báo và nghiêm trọng. Khoảng agent không chạy để trống. |
| **Đa mục tiêu** | Ping song song (4 gói mỗi mục tiêu) tới: **Gateway** (router), **DNS chính** (nếu khác các mục khác), **Cloudflare 1.1.1.1**, **Google 8.8.8.8**. Tự làm mới mỗi 10 giây. |
| **Jitter, Mất gói** | Hai biểu đồ riêng |
| **Bất thường phát hiện** | Bảng các khoảng vượt ngưỡng: độ trễ cao, mất gói, mất kết nối (100% mất), tín hiệu yếu. Mỗi dòng có mức Cảnh báo hoặc Nghiêm trọng. |

**Cách đọc mục "Đa mục tiêu":** đây là công cụ khoanh vùng sự cố.

| Gateway | Internet (1.1.1.1/8.8.8.8) | Kết luận |
|---|---|---|
| Thấp (1–5 ms) | Thấp | Bình thường |
| **Cao / mất gói** | Cao | Sự cố trong **Wi-Fi/LAN**: sóng yếu, nhiễu, router quá tải |
| Thấp | **Cao / mất gói** | Sự cố phía **nhà mạng** hoặc tuyến ra Internet |

**Ví dụ:** gọi Zoom hay bị đứng lúc 21 giờ. Chọn 24 giờ thấy jitter vọt lên 25 ms quanh 20h45–22h00, bảng Bất thường có các dòng "Độ trễ cao". Mục Đa mục tiêu lúc đó cho thấy Gateway vẫn 2 ms trong khi 1.1.1.1 lên 120 ms. Kết luận: nghẽn phía nhà mạng giờ cao điểm, không phải do Wi-Fi trong nhà.

### 4.6 Trang Thống kê & Xu hướng

**Mục đích:** biết đã tiêu thụ bao nhiêu dữ liệu, dùng nhiều vào lúc nào, xu hướng tăng hay giảm.

Chọn khoảng: **24 giờ** (theo giờ), **7 ngày**, **30 ngày** (theo ngày), **12 tháng** (theo tháng).

| Thành phần | Mô tả |
|---|---|
| **Tổng download / upload** | Trong khoảng đã chọn, kèm tỷ lệ ↑/↓ |
| **Tốc độ trung bình** | Chỉ tính những giây **có lưu lượng** (> 0.2 Mbps) để con số có nghĩa, không bị kéo xuống bởi lúc máy để không |
| **Tốc độ cao nhất** | Đỉnh tức thời trong khoảng và thời điểm xảy ra |
| **Dung lượng tiêu thụ** | Biểu đồ cột ↓/↑, chọn kiểu **Chồng** hoặc **Nhóm** |
| **Nhận định nhanh** | Tự động tính trên những khoảng có đo: xu hướng lưu lượng ghi nhận, cao nhất, thấp nhất, trung bình theo khoảng. Khoảng không đo bị loại khỏi phép tính. Không ước tính dung lượng cả tháng từ dữ liệu chỉ ghi khi agent chạy. Khi dữ liệu chưa đủ 2 khoảng thì hiện "Đang thu thập dữ liệu". |
| **Bản đồ nhiệt sử dụng** | Lưới 7 ngày × 24 giờ: dung lượng trung bình ở mỗi khung giờ trong tuần, tính trên 28 ngày gần nhất. Ô càng đậm là càng dùng nhiều. Rê chuột xem số liệu. |
| **Lịch sử Speed test** | Đường ↓/↑ của các lần speed test, kèm đường gói cước nếu đã nhập trong Cài đặt |
| **Bảng dữ liệu** | Từng khoảng: download, upload, tổng, tốc độ TB, cao nhất, thanh tỷ trọng |
| **Xuất CSV** | Tải file `netpulse-usage-<khoảng>.csv` với các cột: thời điểm bắt đầu, nhãn, `observed`, byte ↓, byte ↑, tốc độ TB, tốc độ đỉnh (bps); khoảng chưa đo để trống các cột số |

**Khi nào dùng:** gói cước có giới hạn dung lượng; muốn biết mình dùng mạng nhiều nhất vào lúc nào; so sánh các tháng.

**Ví dụ:** xem 30 ngày, thấy "Trung bình 9.2 GB/ngày có đo". Những ngày agent không chạy được đánh dấu chưa đo. Bản đồ nhiệt đậm nhất ở 20–23 giờ các ngày cuối tuần. Nếu đặt hạn mức 250 GB, cảnh báo 80% dựa trên lưu lượng đã ghi nhận và có thể thấp hơn số liệu nhà mạng.

### 4.7 Trang Lịch sử & Log

**Mục đích:** xem lại mọi sự kiện đã xảy ra với kết nối mạng.

| Thành phần | Mô tả |
|---|---|
| **4 thẻ đếm** | Số sự kiện Thông tin / Thành công / Cảnh báo / Nghiêm trọng. Bấm vào thẻ để lọc theo mức đó. |
| **Sự kiện theo ngày** | Cột chồng số sự kiện mỗi ngày trong 7 ngày, chia theo mức độ |
| **Tìm kiếm** | Lọc theo nội dung, từ khoá được tô sáng |
| **Lọc mức độ, lọc loại** | 11 loại sự kiện ([mục 6](#6-sự-kiện-tự-động-ghi-log)) |
| **Bảng** | Thời gian, mức độ, loại, sự kiện, chi tiết; 20 dòng mỗi trang, có phân trang |
| **CSV** | Xuất các sự kiện đang lọc (UTF-8 có BOM để Excel đọc đúng tiếng Việt) |
| **Xoá log** | Xoá toàn bộ sự kiện trong database (có xác nhận) |

Sự kiện mới tự xuất hiện khi đang mở trang. Log giữ theo "Thời gian lưu dữ liệu" (mặc định 90 ngày).

**Ví dụ:** sáng thấy máy mất mạng lúc đêm. Lọc "Nghiêm trọng" thấy: *02:14 Mất kết nối Internet — Ping 1.1.1.1 thất bại liên tục. Wi-Fi vẫn kết nối — sự cố có thể ở router hoặc nhà mạng*, rồi *02:31 Internet đã khôi phục sau 17 phút gián đoạn*.

### 4.8 Trang Công cụ mạng

**a) Speed Test**
- Bấm **GO**. Bài đo lần lượt qua ba pha:
  1. **Ping** — 10 lần bắt tay TCP tới máy chủ.
  2. **Download** — 10 giây, 6 luồng song song.
  3. **Upload** — 10 giây, 6 luồng song song.
- Trong lúc đo: kim đồng hồ (thang phi tuyến 0–1000 Mbps để cả mạng chậm lẫn mạng nhanh đều dễ đọc), số đo tức thời, biểu đồ tốc độ, tên máy chủ.
- Kết quả: Ping, Jitter, Download, Upload. Kết quả được lưu và **trở thành "mức tối đa"** cho mọi biểu đồ; đồng thời ghi sự kiện "Speed test hoàn tất".
- Khi chưa đo, các ô hiện kết quả lần gần nhất.
- Máy chủ: mạng lưới Cloudflare, tự chọn điểm gần nhất (lúc test là Singapore).
- Mỗi lần đo tốn khoảng **100–500 MB** dữ liệu (tuỳ tốc độ mạng). Chỉ chạy một bài đo tại một thời điểm.
- **Khi nào dùng:** sau khi đổi gói cước, đổi router; khi nghi nhà mạng không cung cấp đủ tốc độ; định kỳ để cập nhật "mức tối đa".
- **Ví dụ:** gói cước 100 Mbps, speed test được 93/90 Mbps (đạt 93% cam kết, bình thường). Nếu chỉ được 40 Mbps lúc dùng Wi-Fi, hãy đo lại khi cắm dây để biết lỗi ở Wi-Fi hay nhà mạng.

**b) Ping**
- Nhập host hoặc IP, chọn 4 / 10 / 20 lần. Có nút nhanh: gateway, 1.1.1.1, 8.8.8.8, google.com.
- Kết quả hiện như lệnh `ping` của Windows, cộng thêm **jitter**.
- **Ví dụ:** ping `192.168.0.1` (router) 20 lần thấy time 2–3 ms, 0% mất: kết nối Wi-Fi tới router tốt.

**c) DNS Lookup**
- Nhập tên miền, chọn loại bản ghi: A, AAAA, MX, NS, TXT, CNAME, SOA, PTR (PTR nhập IP để tra ngược).
- Hiện DNS server đã dùng, thời gian phản hồi, danh sách bản ghi kèm TTL (có nút sao chép).
- Báo lỗi rõ ràng: "Tên miền không tồn tại (NXDOMAIN)", "Hết thời gian chờ DNS server".
- **Ví dụ:** web không vào được. Tra `A` của tên miền: nếu ra NXDOMAIN hoặc timeout thì sự cố ở DNS, thử "Xoá cache DNS" hoặc đổi DNS.

**d) Traceroute**
- Lần theo từng chặng (tối đa 30) từ máy tới đích. Mỗi chặng 3 lần đo.
- Hiện IP, tên (tra ngược), 3 giá trị RTT và thanh màu độ trễ. Chặng không phản hồi hiện `*`. Kết quả hiện dần theo từng chặng.
- **Ví dụ (máy đã test):** tới `1.1.1.1` mất 12 chặng: router nhà 2 ms → router modem nhà mạng 1 ms → … → `1.1.1.1` 28 ms. Nếu độ trễ nhảy vọt ở một chặng giữa đường, đó là nơi gây chậm.

**e) Thao tác nhanh** — kết quả lệnh hiện trong ô terminal bên dưới.

| Thao tác | Lệnh thực tế | Dùng khi | Lưu ý |
|---|---|---|---|
| Xoá cache DNS | `ipconfig /flushdns` | Web vừa đổi máy chủ mà máy vẫn vào địa chỉ cũ; lỗi phân giải tên | Trên máy đã test cần quyền admin |
| Làm mới IP | `ipconfig /renew "<card chính>"` | Mất IP, IP dạng 169.254.x.x | |
| Kết nối lại Wi-Fi | `netsh wlan disconnect` rồi `connect` với profile hiện tại | Wi-Fi "có kết nối nhưng không có Internet" | Có hỏi xác nhận; mạng gián đoạn vài giây |
| Chẩn đoán | Kiểm tra lần lượt: giao diện mạng → Wi-Fi → ping gateway → phân giải DNS → ping 1.1.1.1 → truy cập web HTTP | Không biết mạng hỏng ở đâu | Đưa ra kết luận bằng lời (xem ví dụ dưới) |
| Cấp lại IP | `ipconfig /release` rồi `/renew` | Xung đột IP, đổi mạng mà IP cũ còn kẹt | Luôn renew ngay sau release để máy không bị mất IP; có hỏi xác nhận |
| Reset Winsock | `netsh winsock reset` | Lỗi mạng do phần mềm (VPN, antivirus) làm hỏng stack mạng | Cần quyền admin và khởi động lại máy |

**Quyền Administrator:** nếu lệnh thất bại do thiếu quyền, giao diện hỏi "Chạy lại với quyền Admin?". Đồng ý thì Windows hiện hộp thoại **UAC**; agent chạy lệnh ở chế độ nâng quyền và lấy kết quả về. Bấm huỷ ở UAC thì giao diện báo "Đã huỷ". Agent không bao giờ tự nâng quyền khi chưa được đồng ý.

**Ví dụ kết quả Chẩn đoán:**
```
[OK ] Giao diện mạng — Wi-Fi (wifi)
[OK ] Wi-Fi — ZONEHOME P404 · 94% · -38 dBm
[OK ] Gateway 192.168.0.1 — 2 ms
[OK ] Phân giải DNS — www.google.com → 142.251.154.119 (28 ms)
[OK ] Ping Internet (1.1.1.1) — 30 ms
[OK ] Truy cập web (HTTP) — 204 · 92 ms

Kết luận: kết nối hoạt động bình thường, không phát hiện sự cố.
```

Các kết luận có thể gặp:
- Sự cố trong mạng nội bộ (Wi-Fi/LAN/router).
- Router hoạt động nhưng không ra được Internet (phía nhà mạng).
- Internet có nhưng DNS lỗi.
- Kết nối một phần (bị chặn ICMP hoặc cần đăng nhập captive portal, ví dụ Wi-Fi quán cà phê, khách sạn).

### 4.9 Trang Cài đặt

Cài đặt lưu trong `data/settings.json`. Agent kiểm tra và giới hạn giá trị trước khi lưu, nên không thể nhập giá trị vô lý. Ô thanh trượt lưu ngay khi kéo; ô chữ/số lưu khi rời ô (tránh việc agent dùng giá trị đang gõ dở).

| Nhóm | Cài đặt | Mặc định | Giới hạn | Tác dụng |
|---|---|---|---|---|
| Thu thập | Tần suất cập nhật | 1 giây | 0.5–10 s | Khoảng lấy mẫu lưu lượng |
| | Mục tiêu Ping | `1.1.1.1` | host/IP | Đích ping liên tục mỗi giây (độ trễ, mất gói, phát hiện mất Internet) |
| | Thời gian lưu dữ liệu | 90 ngày | 1–3650 | Dữ liệu chi tiết theo phút và log cũ hơn sẽ bị xoá; thống kê theo giờ luôn giữ 3 năm |
| | Speed test tự động | Tắt | Tắt / 6 giờ / mỗi ngày | Agent tự đo định kỳ (không đo trong 2 phút đầu sau khi khởi động, và không đo khi đang mất mạng) |
| | Tra cứu IP public & nhà mạng | Bật | | Hỏi Cloudflare mỗi 30 phút |
| Ngưỡng | Ping — cảnh báo | 80 ms | 5–2000 | Mốc màu vàng; mốc để tắt trạng thái "độ trễ cao" |
| | Ping — nghiêm trọng | 150 ms | 10–5000 | Mốc màu đỏ; mốc ghi sự kiện "Độ trễ cao" |
| | Mất gói | 1% | 0.1–100 | Mốc ghi sự kiện "Mất gói" |
| | Tín hiệu Wi-Fi yếu | 50% | 1–99 | Mốc ghi sự kiện "Tín hiệu yếu" |
| | Hạn mức dung lượng tháng | 0 (không giới hạn) | GB | Thanh hạn mức ở Tổng quan; cảnh báo ở 80% và 100% |
| | Thông báo trên màn hình | Bật | | Thông báo nổi khi có sự kiện mới |
| Gói cước | Download / Upload cam kết | 0 (chưa đặt) | Mbps | Mốc "tối đa" khi chưa speed test; đường so sánh trong lịch sử speed test |
| Giao diện | Ngôn ngữ | Tiếng Việt | Tiếng Việt / English | Cũng đổi nhanh bằng nút **EN / VI** trên thanh trên cùng |
| | Chế độ | Tối | Tối/Sáng | |
| | Màu nhấn | Cyan | Cyan/Tím/Lục/Hồng | |
| | Đơn vị tốc độ | Mbps | Mbps / MB/s | |
| | Hiệu ứng chuyển động | Bật | | Tắt nếu máy chậm |

Các thẻ khác trên trang:
- **Local Agent:** chế độ (dữ liệu thật/demo), phiên bản, thời gian chạy và PID, địa chỉ, có quyền Administrator không, thư mục dữ liệu, dung lượng database, link tài liệu API.
- **Dữ liệu:**
  - **Xuất cài đặt** — tải file JSON.
  - **Khôi phục mặc định** (giữ nguyên ngôn ngữ đang chọn).
  - **Xoá lịch sử** — xoá toàn bộ thống kê, log, speed test; có xác nhận; không thể hoàn tác.

---

## 5. Agent (backend) hoạt động như thế nào

### 5.1 Bốn luồng thu thập nền

| Luồng | Chu kỳ | Làm gì |
|---|---|---|
| **traffic** | Tần suất cập nhật (1 s) | Đọc bộ đếm byte của giao diện chính, tính tốc độ, đẩy vào bộ đệm 900 mẫu (15 phút), cộng dồn vào phút hiện tại. Sang phút mới thì ghi phút cũ xuống database. |
| **ping** | 1 s | Gửi 1 gói ICMP tới mục tiêu ping (chờ tối đa 1 s). Ghi độ trễ, tính jitter (trung bình chênh lệch giữa các lần ping liên tiếp trong 10 lần gần nhất), phát hiện mất Internet / độ trễ cao. |
| **wifi** | 2 s | Đọc kết nối Wi-Fi hiện tại qua WLAN API. Mỗi 15 giây đọc thêm danh sách BSS để biết độ rộng kênh, chuẩn router hỗ trợ. Phát hiện kết nối / ngắt / chuyển mạng / roaming / tín hiệu yếu. |
| **slow** | 5 s | Làm mới cấu hình mạng mỗi 30 giây (hoặc ngay khi Wi-Fi thay đổi), tra IP public mỗi 30 phút, dọn dữ liệu cũ mỗi giờ, kiểm tra hạn mức tháng, speed test tự động. |

Mỗi luồng có cơ chế tự phục hồi: lỗi trong một vòng lặp được ghi log và luồng chạy lại sau 2 giây, không làm dừng agent.

### 5.2 Chống số liệu ảo

Bộ đếm byte của Windows đôi khi trả số bất thường (cập nhật theo đợt, hoặc bằng 0 ngay sau khi khởi động). Khi test, lỗi này từng làm biểu đồ hiện 9.6 Gbps trên link 270 Mbps. Agent loại bỏ mẫu khi:

- Hai lần đọc cách nhau dưới nửa chu kỳ (chưa đủ thời gian để bộ đếm cập nhật).
- Mốc gốc bằng 0 (không phải giá trị thật).
- Tốc độ tính ra vượt **2 × tốc độ liên kết** (tối thiểu 1 Gbps). Đây là mức vật lý không thể đạt.
- Bộ đếm giảm (bị reset), hoặc khoảng cách giữa hai lần đọc quá dài (máy ngủ / hibernate).

Mẫu bị loại không làm lệch tổng dung lượng; agent chỉ lấy lại mốc gốc mới.

### 5.3 Lưu trữ (SQLite, `data/netpulse.db`)

| Bảng | Nội dung | Thời gian giữ |
|---|---|---|
| `traffic_min` | Mỗi phút: byte ↓/↑, tốc độ đỉnh, số giây có lưu lượng, tên card | Theo cài đặt (90 ngày) |
| `traffic_hour` | Tổng theo giờ, cộng dồn từ dữ liệu phút | 3 năm |
| `quality_min` | Mỗi phút: số gói gửi/mất, ping TB/min/max, jitter, tín hiệu %, RSSI | Theo cài đặt |
| `events` | Sự kiện | Theo cài đặt |
| `speedtests` | Kết quả speed test, kèm card và SSID lúc đo | Không tự xoá |
| `kv` | Trạng thái nội bộ (lần chạy cuối, đã cảnh báo hạn mức chưa…) | |

Ước lượng dung lượng: khoảng 1 MB cho mỗi 5–7 ngày dữ liệu phút, tức khoảng 15–20 MB với 90 ngày.

Thống kê ngày/tháng gộp theo **giờ địa phương**, nên một "ngày" luôn bắt đầu từ 0h theo đồng hồ của máy.

### 5.4 Thuật toán speed test

1. Lấy thông tin máy chủ, IP public, nhà mạng từ `speed.cloudflare.com/meta`.
2. **Latency:** 10 lần đo thời gian bắt tay TCP tới máy chủ, lấy trung vị; jitter = trung bình chênh lệch giữa các lần liên tiếp.
3. **Download:** 6 luồng song song tải liên tục trong 10 giây.
4. **Upload:** 6 luồng song song gửi liên tục trong 10 giây. Bộ đệm gửi được thu nhỏ để số byte đếm được sát với số byte thật sự đã lên đường truyền.
5. Kết quả = lượng dữ liệu truyền được **sau 2 giây đầu** chia cho thời gian tương ứng. Bỏ 2 giây đầu vì đó là lúc TCP còn đang tăng tốc (slow start), sẽ kéo kết quả xuống thấp hơn thực tế.

Lưu ý: latency của speed test (đo bắt tay TCP tới máy chủ speed test) thường cao hơn ping ICMP tới 1.1.1.1 vài chục ms, vì là hai đích và hai loại gói khác nhau.

### 5.5 Đọc thông tin Wi-Fi và mạng

- **Wi-Fi:**
  - Dùng trực tiếp `wlanapi.dll` (kết nối hiện tại, kênh, RSSI, danh sách BSS).
  - Chuẩn router hỗ trợ, độ rộng kênh và kiểu bảo mật của từng điểm phát được giải mã từ phần Information Elements trong gói beacon.
  - Thời điểm bắt đầu kết nối đọc từ nhật ký `WLAN-AutoConfig` (sự kiện 8001).
- **Cấu hình mạng:** một lệnh PowerShell gom `Get-NetAdapter`, `Win32_NetworkAdapterConfiguration`, `Get-NetRoute` và xuất JSON. Nếu một lần đọc lỗi, agent giữ lại kết quả tốt gần nhất.
- **Ping/traceroute:** `IcmpSendEcho` với TTL tuỳ chỉnh. Traceroute tăng TTL từ 1, router trả "TTL expired" để lộ địa chỉ từng chặng.

---

## 6. Sự kiện tự động ghi log

| Loại | Mức | Điều kiện kích hoạt | Ví dụ chi tiết |
|---|---|---|---|
| Kết nối Wi-Fi | Thành công | Wi-Fi từ ngắt chuyển sang kết nối | Đã kết nối tới ZONEHOME P404 (2.4 GHz, kênh 9, 95%) |
| Chuyển mạng Wi-Fi | Thành công | Đang kết nối nhưng SSID đổi | HomeNet → HomeNet_5G |
| Mất kết nối Wi-Fi | Nghiêm trọng | Wi-Fi từ kết nối chuyển sang ngắt | Ngắt kết nối khỏi … (tín hiệu cuối 31%, −79 dBm) |
| Roaming | Thông tin | Cùng SSID nhưng đổi BSSID (sang điểm phát khác, vd. mesh) | BSSID a → b · kênh 1 → 44 |
| Mất kết nối Internet | Nghiêm trọng | 5 lần ping liên tiếp thất bại; chi tiết khoanh vùng nguyên nhân | Wi-Fi vẫn kết nối — sự cố có thể ở router hoặc nhà mạng |
| Internet đã khôi phục | Thành công | Ping thành công trở lại sau khi mất | Ping 1.1.1.1 trở lại sau 17 phút 3 giây gián đoạn |
| Độ trễ cao | Cảnh báo | Ping TB 10 giây ≥ ngưỡng nghiêm trọng; tự tắt khi về dưới ngưỡng cảnh báo; cách nhau ≥ 5 phút | Ping trung bình 10 giây tới 1.1.1.1 là 230 ms |
| Mất gói | Cảnh báo (≥ 10%: Nghiêm trọng) | Trong 1 phút: ≥ 30 gói đã gửi, mất ≥ 3 gói và ≥ ngưỡng %; cách nhau ≥ 5 phút | Mất 6.7% gói (4/60) trong 1 phút |
| Tín hiệu Wi-Fi yếu | Cảnh báo | Tín hiệu dưới ngưỡng liên tục > 10 giây; cách nhau ≥ 10 phút | Tín hiệu 38% (−82 dBm) dưới ngưỡng 50% |
| Đổi giao diện mạng chính | Thông tin | Card ra Internet thay đổi | Wi-Fi → Ethernet |
| Thay đổi IP / gateway | Thông tin | IPv4 hoặc gateway của giao diện chính đổi | IPv4: 192.168.0.104 → 192.168.0.110 |
| Thay đổi DNS | Thông tin | Danh sách DNS server đổi | DNS: 1.1.1.1, 8.8.8.8 |
| Speed test hoàn tất | Thành công | Kết thúc một bài đo (thủ công hoặc tự động) | ↓ 93 Mbps · ↑ 90 Mbps · ping 44 ms · Cloudflare Singapore (SIN) |
| Cảnh báo dung lượng | Cảnh báo (80%) / Nghiêm trọng (100%) | Dùng vượt % hạn mức tháng; mỗi mức chỉ báo 1 lần mỗi tháng | Đã dùng 201 GB / 250 GB (80%) |
| Agent khởi động | Thông tin | Mỗi lần agent chạy; ghi khoảng không thu thập kể từ lần trước nếu trên 2 phút | Không thu thập dữ liệu từ 18/10 23:05 đến lúc khởi động lại (khoảng 7 giờ 12 phút) |
| Đã xoá lịch sử | Thông tin | Người dùng bấm "Xoá lịch sử" | |

Các điều kiện như "mất ≥ 3 gói" hay "cách nhau ≥ 5 phút" nhằm tránh báo động giả. Ví dụ, trên Wi-Fi việc rơi 1 gói ping trong một phút là bình thường. Mọi gói mất vẫn được ghi đầy đủ trong thống kê chất lượng.

---

## 7. API

Agent cung cấp REST API tại `http://127.0.0.1:8765`. Tài liệu tương tác tự sinh có tại `/api/docs`. Thời gian trả về tính bằng mili-giây (epoch), tốc độ bằng bit/giây, dung lượng bằng byte.

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/status` | Trạng thái agent, giao diện chính, kết quả speed test gần nhất, quyền admin, thư mục dữ liệu, dung lượng DB |
| GET | `/api/live?since=<ms>` hoặc `?n=<số>` | Mẫu realtime mới hơn mốc `since`, hoặc `n` mẫu gần nhất. Mỗi mẫu gồm ↓, ↑, ping, jitter, mất gói, tín hiệu và bộ đếm phiên/ngày/tháng. |
| GET | `/api/wifi` | Thông tin Wi-Fi hiện tại |
| POST | `/api/wifi/scan` | Quét mạng xung quanh (~3.5 s) |
| GET | `/api/network` | Cấu hình giao diện chính, IP public, nhà mạng |
| GET | `/api/adapters` | Danh sách card mạng |
| GET | `/api/capacity` | Kết quả speed test gần nhất ("mức tối đa") |
| GET | `/api/usage?range=24h\|7d\|30d\|12m` | Dung lượng theo khoảng |
| GET | `/api/usage/heatmap` | Ma trận 7 × 24 |
| GET | `/api/quality?range=1h\|24h\|7d` | Chất lượng theo khoảng (khoảng không có dữ liệu trả `null`) |
| GET | `/api/quality/targets` | Ping đa mục tiêu |
| GET / DELETE | `/api/events?after=<id>` | Đọc / xoá sự kiện |
| POST | `/api/events/seen` | Lưu mốc "đã xem" |
| GET | `/api/speedtest/history` | 50 lần speed test gần nhất |
| POST | `/api/tools/speedtest`, `/api/tools/ping`, `/api/tools/traceroute` | Chạy công cụ dạng job, trả `{job}` |
| GET | `/api/jobs/{id}?line=&item=` | Lấy tiến độ / kết quả mới của job |
| GET | `/api/jobs/active` | Các job speed test / ping / traceroute còn đang chạy. Trang Công cụ dùng để hiện lại tiến trình sau khi reload hoặc chuyển trang |
| POST | `/api/tools/dns` | Tra DNS `{host, type}` |
| POST | `/api/actions/{name}` | `flushdns`, `renew`, `release`, `reconnect`, `disconnect`, `resetWinsock`, `diag`; body `{elevate: true}` để chạy qua UAC |
| GET / PUT / DELETE | `/api/settings` | Đọc / cập nhật / khôi phục mặc định |
| DELETE | `/api/data` | Xoá toàn bộ lịch sử |
| POST | `/api/shutdown` | Dừng agent êm |

**Ví dụ:**
```
GET /api/live?n=1
→ {"samples":[{"ts":1792352575000,"down":4350000,"up":520000,"ping":28.0,"jitter":0.5,
   "loss":0,"signal":95,"todayDown":128000000,"todayUp":113000000, ...}],
   "eventSeq":4,"status":{"online":true,"interfaceType":"wifi","name":"ZONEHOME P404"}}
```

---

## 8. Bảo mật

| Biện pháp | Chống lại |
|---|---|
| Chỉ lắng nghe `127.0.0.1` | Máy khác trong mạng LAN không truy cập được agent |
| Chỉ chấp nhận request có Host là `127.0.0.1` / `localhost` | Tấn công DNS rebinding (một trang web độc hại trỏ tên miền của nó về 127.0.0.1) |
| Lệnh POST/PUT/DELETE bắt buộc có header `X-NetPulse: 1` | Trang web lạ đang mở trong trình duyệt gửi lệnh ngầm tới agent (CSRF). Header tuỳ chỉnh buộc trình duyệt hỏi trước (preflight), và agent không cho phép. |
| Kiểm tra host nhập vào công cụ (cấm khoảng trắng và các ký tự `; & \| < > " ' \``) | Chèn lệnh hệ thống |
| Lệnh cần quyền admin chỉ chạy qua UAC khi người dùng đồng ý | Tự nâng quyền ngoài ý muốn |
| Cài đặt được kiểm tra kiểu và giới hạn | Giá trị phá hỏng agent |

---

## 9. Dữ liệu nào rời khỏi máy

NetPulse không gửi dữ liệu thống kê hay lịch sử đi đâu. Các kết nối ra ngoài duy nhất là:

| Kết nối | Khi nào | Tắt được không |
|---|---|---|
| ICMP ping tới mục tiêu ping (mặc định 1.1.1.1) | Mỗi giây | Đổi mục tiêu (ví dụ thành gateway) trong Cài đặt |
| `speed.cloudflare.com/meta` | Mỗi 30 phút | Có: "Tra cứu IP public & nhà mạng" |
| Speed test tới Cloudflare | Khi bấm GO hoặc đo tự động | Đo tự động mặc định tắt |
| Ping tới gateway, DNS, 1.1.1.1, 8.8.8.8 | Khi mở trang Chất lượng (mục Đa mục tiêu) | |
| Truy vấn DNS, `http://www.gstatic.com/generate_204` | Khi dùng công cụ DNS / Chẩn đoán | |
| Google Fonts | Khi tải giao diện | Mất mạng thì giao diện tự dùng font hệ thống |

---

## 10. Đối chiếu với yêu cầu gốc

| Yêu cầu trong [info.md](info.md) | Đáp ứng ở |
|---|---|
| 1. Dashboard tổng quan | Trang Tổng quan ([4.2](#42-trang-tổng-quan)) |
| 2. Real-time monitoring, so sánh với khả năng tối đa | Trang Thời gian thực ([4.3](#43-trang-thời-gian-thực)), đồng hồ % và đường "Mức tối đa" |
| 3. Thông số Wi-Fi và cấu hình mạng | Trang Wi-Fi & Mạng ([4.4](#44-trang-wi-fi--mạng)) |
| 4. Phân tích lưu lượng theo giờ/ngày/tuần/tháng | Trang Thống kê ([4.6](#46-trang-thống-kê--xu-hướng)) |
| 5. Ping, latency, jitter, packet loss, độ ổn định, phát hiện bất thường | Trang Chất lượng ([4.5](#45-trang-chất-lượng-kết-nối)) và sự kiện tự động ([mục 6](#6-sự-kiện-tự-động-ghi-log)) |
| 6. Lịch sử, sự kiện kết nối/ngắt, thay đổi cấu hình | Trang Log ([4.7](#47-trang-lịch-sử--log)), database SQLite |
| 7. Speed test, ping, DNS lookup, traceroute, thao tác quản lý | Trang Công cụ ([4.8](#48-trang-công-cụ-mạng)) |
| 8. Tuỳ chỉnh tần suất, ngưỡng, thời gian lưu, giao diện | Trang Cài đặt ([4.9](#49-trang-cài-đặt)) |
| Dữ liệu thật, không số liệu giả | Agent đọc trực tiếp từ Windows; dữ liệu mô phỏng chỉ khi mở `?demo` và có nhãn rõ ràng |
| Có backend / local agent | `backend/` ([mục 5](#5-agent-backend-hoạt-động-như-thế-nào)) |
| Lưu trữ cục bộ | `data/netpulse.db` |
| Phân biệt 3 loại tốc độ | [Mục 3.1](#31-ba-loại-tốc-độ--khác-nhau-thế-nào), thẻ "Ba loại tốc độ" |
| Ưu tiên Windows, dễ mở rộng | Dùng API gốc của Windows; giao diện chỉ nói chuyện với agent qua lớp `api.js`; agent chia module độc lập |

---

## 11. Kiểm thử đã thực hiện

Kiểm thử trên máy thật: Windows 11 (build 26100), card Intel Wi-Fi 6E AX211, Wi-Fi 2.4 GHz, Python 3.11.9.

| Hạng mục | Kết quả |
|---|---|
| Đọc Wi-Fi qua WLAN API | Đúng SSID, BSSID, Wi-Fi 4, kênh 9, 40 MHz, WPA2-Personal, RSSI −31 đến −38 dBm. Khớp với `netsh wlan show interfaces`. |
| Quét mạng xung quanh | 9 điểm phát, có độ rộng kênh và chuẩn của từng điểm |
| Cấu hình mạng | IP, gateway, DNS, DHCP lease, adapter, driver đúng |
| IP public / nhà mạng | Viettel Group, Nha Trang |
| Ping, traceroute, DNS, chẩn đoán qua API | Hoạt động; traceroute 12 chặng tới 1.1.1.1; NXDOMAIN báo đúng |
| Speed test | ↓ 88–93 Mbps, ↑ 90–91 Mbps (Cloudflare Singapore) |
| Lưu dữ liệu theo phút | Đúng; phút có speed test ghi đỉnh 98/94 Mbps, khớp với link |
| Chặn chèn lệnh, CSRF, Host lạ | Trả 403/400 đúng |
| Kiểm tra cài đặt | `refreshMs = 99999` → 10000; khoá lạ bị bỏ qua |
| Dừng êm / dừng đột ngột | Dừng êm ghi nốt phút đang đo; dừng đột ngột có thể mất phần phút chưa ghi. Khi chạy lại, khoảng không thu thập được ghi trung tính |
| `setup.bat` chạy lại | Thành công |
| `start-hidden.vbs`, `stop.bat` | Hoạt động |
| 8 trang giao diện | Chụp màn hình bằng Chrome headless: không lỗi JavaScript; chế độ sáng/tối; điện thoại 390 px; chế độ demo |

Lỗi phát hiện trong quá trình kiểm thử và đã sửa:
- Tốc độ ảo 9.6 Gbps do bộ đếm Windows bị lỗi lúc khởi động.
- Cảnh báo "mất gói" quá nhạy (báo khi chỉ mất 1 gói).
- `stop.bat` kết thúc tiến trình đột ngột làm mất dữ liệu.
- Ping speed test bị cộng thời gian xử lý của máy chủ.
- Lỗi mã hoá tiếng Việt ở console.
- Cloudflare chặn request thiếu header.

Database đã được xoá sạch sau khi test để bắt đầu review với dữ liệu thật từ đầu.

---

## 12. Giới hạn đã biết và hướng phát triển

**Giới hạn hiện tại**
- **Agent chỉ ghi khi đang chạy.** Không cài tự chạy cùng Windows vì việc đó phải ghi ra ngoài thư mục. Có thể tự làm bằng cách đặt shortcut `start-hidden.vbs` vào `shell:startup`.
- **"Đỉnh 15 phút"** ở Tổng quan và các biểu đồ realtime chỉ tính từ lúc agent khởi động gần nhất (bộ đệm trong RAM).
- **Không theo dõi lưu lượng theo từng ứng dụng.** Windows không cung cấp số liệu này một cách đơn giản mà không cần quyền admin.
- **Chỉ đo giao diện mạng chính.** Lưu lượng qua card ảo (WSL, VPN) không được tính riêng.
- **Ping và traceroute chỉ hỗ trợ IPv4.**
- **Speed test phụ thuộc Cloudflare.** Kết quả có thể khác Speedtest.net (khác máy chủ, khác phương pháp).
- Windows 11 24H2+ cần quyền **Location** để đọc tên Wi-Fi.
- **Cần Python có sẵn trên máy**, không phải bản Python portable đi kèm.

**Hướng phát triển gợi ý**
- Biểu tượng ở khay hệ thống, thông báo của Windows (toast) khi mất mạng.
- Theo dõi lưu lượng theo ứng dụng (cần quyền admin).
- Hỗ trợ IPv6 cho ping/traceroute.
- Nhiều máy chủ speed test; so sánh theo thời gian trong ngày.
- Báo cáo tháng xuất PDF.
- Đóng gói Python portable để không phụ thuộc Python của hệ thống.

---

## 13. Xử lý sự cố

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Trang hiện "Không kết nối được tới NetPulse Agent" | Agent chưa chạy | Chạy `start.bat` hoặc `start-hidden.vbs` |
| Thanh đỏ "Mất kết nối với Agent" | Agent bị tắt trong lúc đang xem | Chạy lại agent; giao diện tự kết nối lại |
| Không thấy tên Wi-Fi, quét mạng báo cần quyền Vị trí | Windows 11 24H2+ chặn ứng dụng desktop đọc SSID | **Settings → Privacy & security → Location**: bật *Location services* và *Let desktop apps access your location* |
| Mục "Card Wi-Fi" báo không có | Máy không có card Wi-Fi, hoặc dịch vụ *WLAN AutoConfig* tắt | Bật dịch vụ trong `services.msc`; nếu dùng Ethernet thì bỏ qua |
| "Mức tối đa" đang so với tốc độ liên kết | Chưa chạy speed test và chưa nhập gói cước | Chạy Speed test, hoặc nhập gói cước trong Cài đặt |
| Xoá cache DNS báo "requires elevation" | Lệnh cần quyền admin trên máy này | Đồng ý "Chạy lại với quyền Admin" rồi chấp nhận UAC |
| Biểu đồ thống kê có khoảng trống | Agent không chạy trong khoảng đó | Bình thường; dùng `start-hidden.vbs` để agent chạy liên tục |
| `setup.bat` báo không tìm thấy Python | Python chưa cài hoặc chưa có trong PATH | Cài Python 3.10+ từ python.org, chọn "Add to PATH" |
| Cổng 8765 đã bị chiếm | Phần mềm khác dùng cổng này | Chạy `start.bat --port 8800` rồi mở `http://127.0.0.1:8800` |
| Muốn xem agent làm gì | | Đọc `data/logs/agent.log` |
| Muốn gỡ ứng dụng | | Chạy `stop.bat` rồi xoá thư mục `OPT_WIFI` |
