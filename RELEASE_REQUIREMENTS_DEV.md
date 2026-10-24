# NetPulse — Yêu cầu để chia sẻ cho developer

Dành cho người biết kỹ thuật: tự cài Python, `git clone`, chạy `setup.bat` / `start.bat`.
Bản cho người dùng phổ thông xem [RELEASE_REQUIREMENTS.md](RELEASE_REQUIREMENTS.md).

## Đã xong

- [x] `.gitignore`: bỏ qua `.venv/`, `data/`, `__pycache__/`, `*.zip`, thư mục IDE.
- [x] `.gitattributes`: giữ CRLF cho `.bat` / `.vbs` (nếu thành LF, `cmd` có thể nhảy sai nhãn `goto`).
- [x] Xoá hostname máy dev khỏi dữ liệu demo ([api.js](frontend/js/api.js)).
- [x] `setup.bat` kiểm tra Python 3.10+ thật (thử `py -3` rồi `python`), không bị alias Microsoft Store đánh lừa.
- [x] README: yêu cầu hệ thống, cài đặt từ `git clone`, cập nhật.

## Còn lại

- [ ] Khi tạo repo: commit đầu tiên phải là bản đã sạch; không đưa `OPT_WIFI.zip` lên.
- [ ] `stop.bat` gọi cố định cổng 8765, không dừng được bản chạy bằng `start.bat --port <khác>`.
- [ ] README: ghi các kết nối ra ngoài (Cloudflare tra IP public mỗi 30 phút, bật mặc định; speed test; Google Fonts).
- [ ] Thử clone sạch trên máy khác (hoặc Windows Sandbox): `setup.bat` → `start.bat` → có dữ liệu sau vài phút.

## Để sau

- Thêm `PRAGMA user_version` cho database, để bản sau đổi cấu trúc bảng mà không làm hỏng dữ liệu cũ.
- Test tự động cho phần tính toán.
