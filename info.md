Tôi muốn xây dựng một **Local Network Monitoring & Analytics Dashboard** — ứng dụng web chạy trên localhost, dùng để giám sát, thống kê, phân tích và quản lý kết nối Internet/Wi-Fi của máy tính.

### Các chức năng chính

1. **Dashboard tổng quan:** Hiển thị trạng thái mạng, tốc độ Download/Upload hiện tại, dung lượng đã tiêu thụ, mức sử dụng băng thông và các chỉ số hiệu suất.

2. **Real-time Monitoring:** Theo dõi lưu lượng mạng theo thời gian thực, trực quan hóa bằng biểu đồ động, so sánh tốc độ đang sử dụng với khả năng tối đa của kết nối.

3. **Wi-Fi & Network Information:** Hiển thị thông số kỹ thuật Wi-Fi đang kết nối (SSID, băng tần, chuẩn Wi-Fi, cường độ tín hiệu, tốc độ liên kết...) và cấu hình mạng (IP, DNS, Gateway, Adapter...).

4. **Analytics & Statistics:** Phân tích lưu lượng Download/Upload, mức tiêu thụ dữ liệu, tốc độ trung bình/cao nhất, xu hướng sử dụng theo giờ/ngày/tuần/tháng.

5. **Connection Quality:** Theo dõi Ping, Latency, Jitter, Packet Loss, độ ổn định kết nối và phát hiện bất thường.

6. **History & Logs:** Lưu trữ lịch sử sử dụng mạng, biến động tốc độ, sự kiện kết nối/ngắt kết nối và các thay đổi cấu hình.

7. **Network Tools & Actions:** Cung cấp Speed Test, Ping Test, DNS Lookup, Traceroute và một số thao tác quản lý mạng phù hợp.

8. **Settings & Customization:** Tùy chỉnh tần suất cập nhật, ngưỡng cảnh báo, thời gian lưu dữ liệu và giao diện dashboard.

### Yêu cầu chung

- Dữ liệu thực tế, cập nhật liên tục, không sử dụng số liệu giả.
- Có backend/local agent để thu thập thông tin mạng trực tiếp từ hệ điều hành.
- Lưu trữ dữ liệu cục bộ để phục vụ thống kê và phân tích lịch sử.
- Phân biệt tốc độ sử dụng thực tế, tốc độ liên kết Wi-Fi và tốc độ Internet đo được.
- Ưu tiên Windows, thiết kế kiến trúc dễ mở rộng.

**Mục tiêu:** Tạo ra một trung tâm giám sát mạng cá nhân đầy đủ, giúp tôi hiểu Internet/Wi-Fi của mình đang hoạt động như thế nào, tiêu thụ bao nhiêu tài nguyên, hiệu suất ra sao và có thể cải thiện ở đâu