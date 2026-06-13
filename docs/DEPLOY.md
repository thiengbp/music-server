# Hướng dẫn triển khai Music Server (Self-hosted Deployment Guide)

Tài liệu này hướng dẫn cách build và chạy Music Server bằng Docker và Docker Compose trên máy chủ tự host (self-hosted).

---

## 1. Chuẩn bị trước khi chạy

### Bước 1: Sao chép tệp cấu hình `.env`
Sao chép tệp mẫu cấu hình và điều chỉnh lại đường dẫn thư mục nhạc của bạn:
```bash
cp .env.example .env
```

### Bước 2: Cấu hình biến môi trường trong `.env`
Mở tệp `.env` vừa tạo và chỉnh sửa các tham số sau:
- `PORT`: Cổng bạn muốn Music Server lắng nghe trên máy chủ (mặc định: `3000`).
- `HOST_MUSIC_PATH`: Đường dẫn chứa nhạc trên máy chủ của bạn để mount vào container (chế độ Read-Only).
  - Đối với chạy thử nghiệm cục bộ (local test): Bạn có thể tạo thư mục `./music` tại thư mục dự án và gán `HOST_MUSIC_PATH=./music`.
  - Đối với môi trường triển khai thực tế hoặc trên container LXC: Nên cấu hình đường dẫn tuyệt đối ổn định như `/opt/music-server/music`.
- `LIBRARY_SCAN_INTERVAL_MINUTES`: Khoảng thời gian tự động quét lại thư viện nhạc, tính bằng phút (mặc định: `15`).

### Bước 3: Tạo các thư mục lưu trữ dữ liệu (Khuyên dùng cho LXC/Server thật)
Khi triển khai trên máy chủ Linux hoặc container LXC, hãy tạo cấu trúc thư mục chuẩn để lưu trữ dữ liệu và nhạc:
```bash
mkdir -p /opt/music-server/data
mkdir -p /opt/music-server/music
```
Sau đó, hãy đặt cấu hình tương ứng trong tệp `.env`:
```ini
HOST_MUSIC_PATH=/opt/music-server/music
```
Đồng thời, bạn cũng có thể điều chỉnh dòng mapping volume cho database trong tệp `docker-compose.yml` từ `./data:/app/data` sang:
```yaml
    volumes:
      - /opt/music-server/data:/app/data
      - ${HOST_MUSIC_PATH:-./music}:/music:ro
```

---

## 2. Các lệnh khởi chạy bằng Docker Compose

### Build Docker Image
Nếu đây là lần chạy đầu tiên hoặc bạn vừa cập nhật mã nguồn ứng dụng, hãy build lại image:
```bash
docker compose build
```

### Khởi chạy Music Server
Khởi chạy container chạy ngầm (detached mode):
```bash
docker compose up -d
```
Ứng dụng sẽ tự động tạo thư mục `./data` tại thư mục hiện hành trên máy chủ và tạo tệp SQLite database `music.db` trong đó để lưu trữ dữ liệu bền vững.

### Kiểm tra sức khỏe của Server (Healthcheck)
Bạn có thể kiểm tra xem container và cơ sở dữ liệu đã sẵn sàng hoạt động hay chưa bằng cách:
```bash
curl http://localhost:3000/health
```
Kết quả mong muốn:
```json
{"status":"ok","database":"ok"}
```

### Xem logs của Server
```bash
docker compose logs -f
```

### Dừng Server
```bash
docker compose down
```

---

## 3. Quét thư viện nhạc (Scan Library)

Mặc dù Music Server đã cấu hình quét tự động dựa trên thời gian chỉ định (`LIBRARY_SCAN_INTERVAL_MINUTES`), bạn vẫn có thể bắt đầu quét thư viện nhạc thủ công ngay lập tức bằng cách gọi API POST:
```bash
curl -X POST http://localhost:3000/library/scan
```
Lệnh này sẽ bắt đầu quá trình quét thư mục nhạc đã được mount vào `/music` trong container (ánh xạ từ thư mục `HOST_MUSIC_PATH` trên máy chủ).

---

## 4. Sao lưu (Backup) và Cập nhật (Update)

### Sao lưu Cơ sở dữ liệu (Backup DB)
Vì toàn bộ dữ liệu (lịch sử nghe nhạc, hàng đợi, danh sách phát playlist, bài hát yêu thích) được lưu trong SQLite database bên ngoài container tại volume `./data`, bạn chỉ cần sao chép tệp này để backup:
```bash
cp ./data/music.db /path/to/backup/music_backup.db
```

### Cập nhật phiên bản mới mà không mất dữ liệu
Khi có bản cập nhật mới từ git hoặc source code:
1. Kéo code mới về máy chủ.
2. Build lại image mới:
   ```bash
   docker compose build
   ```
3. Khởi động lại container:
   ```bash
   docker compose up -d
   ```
Toàn bộ cơ sở dữ liệu của bạn nằm trong thư mục `./data` sẽ được giữ nguyên vẹn và liên kết lại với container mới.
