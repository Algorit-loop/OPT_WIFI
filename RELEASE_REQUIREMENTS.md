# NetPulse — Yêu cầu để phát hành cho người dùng Windows 11

Tài liệu này liệt kê những việc cần làm để NetPulse (hiện là v1.0.0, chạy tốt trên máy phát triển) có thể
phát cho người dùng bình thường cài và dùng trên Windows 11, không cần kiến thức kỹ thuật.

Mỗi yêu cầu có **mức độ ưu tiên**:

- **P0 — Bắt buộc:** thiếu thì không phát hành được.
- **P1 — Nên có:** nên làm trước bản phát hành đầu, nhưng có thể phát bản beta khi chưa có.
- **P2 — Để sau:** cải thiện cho các bản tiếp theo.

---

## 1. Hiện trạng và khoảng cách

| Khía cạnh | Hiện tại | Người dùng phổ thông cần |
|---|---|---|
| Cài đặt | Tự cài Python 3.10+, chạy `setup.bat`, máy phải có Internet để `pip` tải thư viện | Tải một file, bấm cài là chạy, không cần Python |
| Nơi lưu dữ liệu | `data/` nằm cạnh mã nguồn ([config.py:8-14](backend/netpulse/config.py#L8-L14)) | Nằm trong thư mục người dùng, không bị mất khi cập nhật |
| Khởi chạy | `start.bat` / `start-hidden.vbs`, dừng bằng `stop.bat` | Biểu tượng ở Start Menu và khay hệ thống, có tuỳ chọn tự chạy cùng Windows |
| Cổng | Cố định `8765` ([config.py:18](backend/netpulse/config.py#L18)) | Tự chọn cổng khác nếu `8765` đã bị chiếm |
| Độ tin cậy của file | Không ký số | Có chữ ký số, không bị SmartScreen/Defender chặn |
| Cập nhật | Không có | Biết có bản mới, cập nhật mà không mất dữ liệu |
| Phụ thuộc bên ngoài lúc chạy | Google Fonts ([index.html:9](frontend/index.html#L9)) | Mọi tài nguyên giao diện đóng gói sẵn |
| Kiểm thử | Kiểm thử tay trên 1 máy (Win 11 build 26100, Intel AX211) | Kiểm thử tự động và trên nhiều cấu hình |
| Pháp lý | Chưa có giấy phép, chưa có chính sách quyền riêng tư | Có cả hai, kèm giấy phép bên thứ ba |

---

## 2. Đóng gói và cài đặt

| # | Yêu cầu | Ưu tiên | Tiêu chí đạt |
|---|---|---|---|
| 2.1 | **Không cần Python có sẵn trên máy.** Đóng gói kèm Python (Python embeddable hoặc PyInstaller/Nuitka) cùng toàn bộ thư viện. | P0 | Cài được trên một máy Windows 11 sạch, chưa từng cài Python. |
| 2.2 | **Không tải gì lúc cài.** Bỏ bước `pip install` khi chạy lần đầu. | P0 | Cài và chạy được khi máy đang mất mạng. |
| 2.3 | **Có trình cài đặt** (Inno Setup, WiX/MSI hoặc MSIX). Cài theo người dùng (per-user) vào `%LOCALAPPDATA%\Programs\NetPulse`, không cần quyền Administrator. | P0 | Người dùng thường (không phải admin) cài được, không hiện UAC. |
| 2.4 | **Tách dữ liệu khỏi chương trình.** Chuyển `data/` sang `%LOCALAPPDATA%\NetPulse\` (database, `settings.json`, logs, tmp). | P0 | Gỡ rồi cài lại, hoặc cài bản mới đè lên, vẫn còn nguyên lịch sử. |
| 2.5 | **Không đóng gói dữ liệu của máy phát triển.** Gói phát hành không được chứa `data/`, `.venv/`, `__pycache__/`. `.venv` hiện chứa đường dẫn tuyệt đối của máy dev, không dùng được ở máy khác. | P0 | Kiểm tra nội dung gói trước khi phát hành (xem checklist mục 10). |
| 2.6 | **Có trình gỡ cài đặt** trong *Settings → Apps*. Hỏi người dùng có muốn xoá cả dữ liệu lịch sử hay không. | P0 | Gỡ xong không còn tiến trình, shortcut, mục Startup nào. |
| 2.7 | Bản **portable** (file zip, giải nén là chạy) cho người không muốn cài. | P2 | |
| 2.8 | Hỗ trợ **Windows 11 ARM64** (Snapdragon). Mã hiện gọi `wlanapi.dll` / `iphlpapi.dll` qua ctypes, cần kiểm tra lại cấu trúc dữ liệu trên ARM64. | P2 | Chạy được trên một máy ARM64 thật. |

---

## 3. Khởi chạy và vận hành

| # | Yêu cầu | Ưu tiên | Tiêu chí đạt |
|---|---|---|---|
| 3.1 | **Biểu tượng ở khay hệ thống** với các mục: Mở bảng điều khiển · Tạm dừng thu thập · Thoát. Thay cho `start.bat` / `stop.bat`. | P0 | Người dùng không phải đụng tới file `.bat` hay `.vbs` nào. |
| 3.2 | **Tuỳ chọn "Chạy cùng Windows"**, mặc định hỏi ở lần chạy đầu. Dùng khoá `HKCU\...\Run` hoặc shortcut Startup. Phải gỡ sạch khi uninstall. | P0 | Agent chỉ ghi được lịch sử khi đang chạy, nên thiếu mục này thì phần lớn thống kê sẽ trống. |
| 3.3 | **Chỉ chạy một bản.** Đã có cơ chế kiểm tra cổng ([run.py](backend/run.py)), cần giữ khi đóng gói và khi chạy từ khay. | P0 | Mở chương trình lần thứ hai chỉ mở lại trình duyệt. |
| 3.4 | **Xử lý trùng cổng.** Nếu `8765` bị chương trình khác chiếm: tự chọn cổng trống, lưu lại, mở đúng URL. Giao diện gọi API theo đường dẫn tương đối nên không cần sửa phía frontend. | P0 | Chạy được khi một chương trình khác đang chiếm 8765. |
| 3.5 | **Ghi log lỗi ra file** trong thư mục dữ liệu, kèm mục "Mở thư mục log" trong Cài đặt hoặc ở khay, để người dùng gửi khi báo lỗi. Đã có log xoay vòng 2 MB × 3 file. | P1 | |
| 3.6 | **Thông báo Windows (toast)** khi mất Internet hoặc vượt hạn mức, kể cả khi không mở trình duyệt. | P1 | |
| 3.7 | Tuỳ chọn mở giao diện trong **cửa sổ riêng** (WebView2) thay vì tab trình duyệt. | P2 | |

---

## 4. Tương thích Windows 11

Cần kiểm thử thật (không chỉ đọc code) trên các cấu hình sau. Hiện mới kiểm thử 1 cấu hình.

| # | Trường hợp | Ưu tiên | Điều cần xác nhận |
|---|---|---|---|
| 4.1 | Windows 11 **23H2, 24H2, 25H2** | P0 | Mọi trang hoạt động; không có lỗi JavaScript. |
| 4.2 | **Quyền Location** bị tắt (mặc định trên 24H2+ với nhiều máy) | P0 | Giao diện hướng dẫn rõ cách bật; các phần không cần SSID vẫn chạy. Ở lần chạy đầu nên có bước hướng dẫn riêng. |
| 4.3 | Tài khoản **Standard user** (không phải admin) | P0 | Mọi chức năng đo đều chạy. Các lệnh cần admin hiện UAC đúng cách. |
| 4.4 | Máy **chỉ có Ethernet**, không có card Wi-Fi | P0 | Trang Wi-Fi báo "không có card Wi-Fi", không báo lỗi. |
| 4.5 | **VPN** đang bật (WireGuard, OpenVPN, phần mềm VPN công ty) | P0 | Chọn đúng giao diện chính; lưu lượng không bị đếm hai lần. |
| 4.6 | Có **card ảo** (Hyper-V, WSL, VirtualBox, Docker) | P1 | Không chọn nhầm card ảo làm giao diện chính. |
| 4.7 | Windows **tiếng Anh và tiếng Việt** (và nên thêm một ngôn ngữ khác) | P0 | Kết quả lệnh `ipconfig`/`netsh` hiển thị đúng ký tự; các thao tác nhanh không phụ thuộc chữ trong output. |
| 4.8 | **Firewall/antivirus chặn ICMP** | P1 | Hiện "không đo được ping" thay vì báo "Mất kết nối Internet" sai. |
| 4.9 | Máy công ty có **PowerShell bị giới hạn** (Constrained Language Mode, AppLocker) | P1 | Cấu hình mạng ([netconfig.py](backend/netpulse/netconfig.py)) đọc qua PowerShell. Nếu bị chặn thì vẫn hiện được phần còn lại và báo rõ. |
| 4.10 | **Ngủ / hibernate / đổi mạng** liên tục | P1 | Không có tốc độ ảo; khoảng ngủ được ghi là "chưa đo". |
| 4.11 | **Màn hình DPI cao, cỡ chữ 150–200%**, cửa sổ hẹp | P1 | Không vỡ bố cục. |
| 4.12 | Wi-Fi 6E/7 (6 GHz), card Realtek / MediaTek / Qualcomm (không chỉ Intel) | P1 | Băng tần, chuẩn, kênh và độ rộng kênh hiển thị đúng. |

---

## 5. Tin cậy và bảo mật

| # | Yêu cầu | Ưu tiên | Tiêu chí đạt |
|---|---|---|---|
| 5.1 | **Ký số** file cài đặt và mọi file `.exe` bằng chứng thư code signing (OV/EV, hoặc Azure Trusted Signing). | P0 | Không có cảnh báo "Windows protected your PC" từ SmartScreen, hoặc cảnh báo giảm dần khi bản có uy tín. |
| 5.2 | **Kiểm tra antivirus.** Gói PyInstaller và mã gọi DLL Windows qua ctypes hay bị nhận nhầm là mã độc. Quét bằng Microsoft Defender và VirusTotal trước mỗi bản phát hành; nếu bị nhận nhầm thì gửi file cho Microsoft xem xét. | P0 | Defender không cảnh báo; VirusTotal không có cảnh báo từ các hãng lớn. |
| 5.3 | **Giữ nguyên các biện pháp hiện có:** chỉ nghe `127.0.0.1`, kiểm tra Host header, header `X-NetPulse` cho lệnh thay đổi, kiểm tra host nhập vào, UAC cho lệnh admin. | P0 | Chạy lại các phép thử bảo mật ở [DAC_TA.md mục 11](DAC_TA.md) trên bản đóng gói. |
| 5.4 | **Tắt `/api/docs`** (trang tài liệu API tự sinh) ở bản phát hành, hoặc chỉ bật ở chế độ phát triển. | P1 | |
| 5.5 | Rà soát bảo mật độc lập (review mã hoặc dùng công cụ quét) cho phần thực thi lệnh hệ thống trong [tools.py](backend/netpulse/tools.py). | P1 | |

---

## 6. Quyền riêng tư và dữ liệu ra ngoài

| # | Yêu cầu | Ưu tiên | Tiêu chí đạt |
|---|---|---|---|
| 6.1 | **Đóng gói font** (Inter, JetBrains Mono) vào `frontend/`, bỏ Google Fonts. Như vậy giao diện không gửi request ra Internet nào khi mở. | P0 | Mở giao diện khi chặn mọi kết nối ra ngoài, font vẫn đúng. |
| 6.2 | **Chính sách quyền riêng tư** ngắn gọn, viết cho người dùng: dữ liệu nằm trên máy, những kết nối nào đi ra ngoài (bảng ở [DAC_TA.md mục 9](DAC_TA.md)). | P0 | Có link trong Cài đặt và trên trang tải về. |
| 6.3 | **Tra cứu IP public** gửi request tới Cloudflare 30 phút/lần và **đang bật mặc định** ([config.py:39](backend/netpulse/config.py#L39)). Phải hỏi ở lần chạy đầu, hoặc ít nhất ghi rõ trong chính sách quyền riêng tư. | P0 | |
| 6.4 | **Điều khoản sử dụng speed test.** NetPulse dùng `speed.cloudflare.com` từ một ứng dụng bên thứ ba. Cần kiểm tra điều khoản của Cloudflare có cho phép dùng như vậy khi phát hành công khai hay không. Nếu không, phải đổi nhà cung cấp hoặc xin phép. | P0 | Có kết luận bằng văn bản. |
| 6.5 | Cảnh báo **dung lượng speed test** (100–500 MB/lần) trước lần đo đầu tiên, nhất là khi đang dùng mạng di động hoặc mạng tính phí theo dung lượng (Windows có cờ *metered connection*). | P1 | Speed test tự động không chạy khi mạng được đánh dấu metered. |

---

## 7. Chất lượng và kiểm thử

| # | Yêu cầu | Ưu tiên | Tiêu chí đạt |
|---|---|---|---|
| 7.1 | **Kiểm thử tự động** cho phần tính toán: tốc độ từ bộ đếm, lọc mẫu ảo, gộp phút/giờ, điểm ổn định, phát hiện sự kiện, kiểm tra cài đặt. Hiện chưa có test nào. | P0 | Chạy bằng một lệnh; tất cả phải pass trước khi build. |
| 7.2 | **Smoke test trên bản đã đóng gói:** cài → mở → chờ 5 phút → kiểm tra có dữ liệu phút → speed test → gỡ. | P0 | Làm trên ít nhất 3 máy thật khác nhau (mục 4). |
| 7.3 | **Nâng cấp database.** Thêm số phiên bản schema và cơ chế migration, để bản sau đọc được database của bản trước. | P0 | Cài v1.0 → thu dữ liệu → cài v1.1 → lịch sử còn nguyên. |
| 7.4 | **Chạy beta** với 5–10 người dùng thật trong 1–2 tuần, thu log lỗi. | P1 | Không có lỗi crash nào chưa được xử lý. |
| 7.5 | Đo **tài nguyên khi chạy nền** lâu ngày: CPU, RAM, dung lượng database. | P1 | Ví dụ: CPU trung bình < 1%, RAM < 150 MB, sau 7 ngày không tăng RAM bất thường. |
| 7.6 | Kiểm thử giao diện trên **Edge, Chrome, Firefox** bản hiện hành. | P1 | |

---

## 8. Cập nhật và phiên bản

| # | Yêu cầu | Ưu tiên | Tiêu chí đạt |
|---|---|---|---|
| 8.1 | **Đánh số phiên bản** theo SemVer (đang có `VERSION = "1.0.0"`), hiện trong Cài đặt và trong tên file cài. | P0 | |
| 8.2 | **Cài bản mới đè lên bản cũ** mà không mất dữ liệu và cài đặt. Phụ thuộc mục 2.4 và 7.3. | P0 | |
| 8.3 | **Changelog** cho từng bản. | P1 | |
| 8.4 | **Kiểm tra có bản mới** (ví dụ qua GitHub Releases) và báo trong giao diện. Có thể tắt; phải ghi trong chính sách quyền riêng tư vì đây là một kết nối ra ngoài. | P2 | |
| 8.5 | Phát hành qua **winget** và/hoặc **Microsoft Store**. | P2 | |

---

## 9. Tài liệu, ngôn ngữ và pháp lý

| # | Yêu cầu | Ưu tiên | Tiêu chí đạt |
|---|---|---|---|
| 9.1 | **Giấy phép phần mềm** (`LICENSE`) cho NetPulse. | P0 | |
| 9.2 | **Giấy phép bên thứ ba** kèm theo bản phát hành: Python (PSF), FastAPI (MIT), Uvicorn (BSD), psutil (BSD), dnspython (ISC), Chart.js (MIT), font Inter và JetBrains Mono (OFL), cùng mọi thư viện con được đóng gói. | P0 | File `THIRD_PARTY_NOTICES` đầy đủ. |
| 9.3 | **Hướng dẫn cho người dùng** (khác với [README.md](README.md) và [DAC_TA.md](DAC_TA.md), vốn viết cho người phát triển): cài, bật quyền Location, đọc ba loại tốc độ, gỡ cài đặt, xử lý sự cố. | P0 | Người chưa biết gì về mạng làm theo được. |
| 9.4 | **Kênh hỗ trợ / báo lỗi** (email, GitHub Issues…) ghi trong ứng dụng. | P1 | |
| 9.5 | **Ngôn ngữ giao diện.** Hiện chỉ có tiếng Việt. Nếu phát hành rộng hơn thì cần tách chuỗi để thêm tiếng Anh. | P2 (P0 nếu phát hành quốc tế) | |

---

## 10. Checklist trước mỗi lần phát hành

- [ ] Tất cả yêu cầu P0 ở trên đã xong.
- [ ] Test tự động pass.
- [ ] Build từ mã sạch; gói **không** chứa `data/`, `.venv/`, `__pycache__/`, log hay database của máy dev.
- [ ] Bản demo (`?demo`) không còn dữ liệu riêng của máy dev (ví dụ hostname `DESKTOP-GIGABYTE` trong [api.js](frontend/js/api.js)).
- [ ] Mọi file `.exe` và file cài đều đã ký số.
- [ ] Quét Defender và VirusTotal sạch.
- [ ] Smoke test trên máy sạch: cài → chạy → có dữ liệu sau 5 phút → speed test → cập nhật đè bản cũ → gỡ.
- [ ] Phiên bản, changelog, ghi chú phát hành đã cập nhật.
- [ ] Chính sách quyền riêng tư và giấy phép bên thứ ba khớp với các kết nối ra ngoài và thư viện của bản này.

---

## 11. Thứ tự làm đề xuất

1. **Tách dữ liệu và đóng gói** (2.1–2.6, 6.1): đây là nền cho mọi việc khác.
2. **Khay hệ thống, chạy cùng Windows, cổng** (3.1–3.4).
3. **Migration database và test tự động** (7.1, 7.3).
4. **Pháp lý và quyền riêng tư** (6.2–6.4, 9.1–9.3). Riêng 6.4 (điều khoản Cloudflare) nên kiểm tra sớm vì có thể phải đổi cách đo speed test.
5. **Ký số, quét antivirus, kiểm thử trên nhiều máy** (5.1–5.2, mục 4, 7.2).
6. **Beta** (7.4) → phát hành 1.0.
