# GymFit Manager - Đề 23

Website quản lý phòng Gym / Fitness gồm:

- Quản lý hội viên
- Quản lý gói tập
- Quản lý lịch tập
- Quản lý huấn luyện viên
- MySQL + phpMyAdmin
- Nginx reverse proxy
- Prometheus + Grafana
- Loki + LogQL thông qua Promtail
- Hardening cơ bản cho HTTP và container app
- Có health check và metrics endpoint

## 1. Chạy bằng Docker Desktop

Tạo file cấu hình `.env` từ mẫu trước khi chạy lần đầu:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Thiết lập `GYM_ADMIN_USERNAME`, `GYM_ADMIN_PASSWORD` và `GYM_SESSION_SECRET` trong `.env`. Bí mật phiên phải có ít nhất 32 ký tự; có thể tạo giá trị ngẫu nhiên bằng Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Không sử dụng mật khẩu hoặc khóa mẫu trong `.env.example` khi triển khai thật. Đăng nhập bằng tên người dùng và mật khẩu đã cấu hình trong `.env`.

Mở thư mục này bằng Visual Studio Code rồi mở Terminal:

```bash
docker compose up -d --build
```

### Các thành phần được Docker Compose điều phối

Docker Compose khởi tạo và điều phối các service sau trong cùng một stack:

- `app`: ứng dụng GymFit.
- `mysql`: cơ sở dữ liệu MariaDB.
- `phpmyadmin`: giao diện quản trị cơ sở dữ liệu.
- `nginx`: reverse proxy cho website và phpMyAdmin.
- `prometheus`: thu thập metrics từ ứng dụng.
- `grafana`: dashboard và cảnh báo.
- `loki`: lưu trữ log tập trung.
- `promtail`: thu thập log ứng dụng và Nginx, chuyển tới Loki.

Các service kết nối với nhau qua Docker network `gymnet` (driver `bridge`); các service phụ thuộc vào nhau được khởi động theo cấu hình trong `docker-compose.yml`, trong đó ứng dụng và phpMyAdmin chờ MySQL healthy.

Compose tạo và quản lý các named volume để lưu dữ liệu ngoài vòng đời container:

- `mysql_data`: dữ liệu MariaDB.
- `grafana_data`: dữ liệu Grafana.
- `loki_data`: dữ liệu Loki.
- `app_logs`: log ứng dụng, được Promtail đọc ở chế độ chỉ đọc.
- `nginx_logs`: log Nginx, được Promtail đọc ở chế độ chỉ đọc.

Các volume này vẫn được giữ lại sau `docker compose down`; dùng `docker compose down -v` để xóa chúng cùng dữ liệu tương ứng. Các cấu hình được mount từ thư mục dự án (ví dụ cấu hình Nginx, Prometheus, Grafana, Loki và Promtail) là bind mount, không phải named volume.

Kiểm tra:

- Website: http://localhost
- phpMyAdmin qua Nginx: http://localhost/phpmyadmin/
- phpMyAdmin: http://localhost:8080
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001
- Health: http://localhost/health
- Metrics: http://localhost:3000/metrics (nội bộ; Prometheus scrape trực tiếp)

Tài khoản Grafana mặc định lấy từ `.env`. Hãy đổi các mật khẩu mặc định trước khi sử dụng thật.

## 2. Đăng nhập phpMyAdmin

Host: `mysql`

User: giá trị `MYSQL_USER` trong `.env` (mặc định `gymuser`)

Password: giá trị `MYSQL_PASSWORD` trong `.env` (mặc định `change_me_gym`)

Database: `gymdb`

## 3. Prometheus

Prometheus tự scrape `app:3000/metrics` mỗi 10 giây.

## 4. Grafana + Loki

Grafana đã được provision sẵn hai datasource: Prometheus và Loki.
Dashboard `GymFit - Tổng quan hệ thống` được nạp tự động.
Dashboard có biểu đồ tốc độ request theo route và theo HTTP status code, tính bằng `rate(http_requests_total[1m])`.
Promtail thu thập log ứng dụng và log Nginx; log Nginx được lưu trong Docker volume `nginx_logs`.

### Giả lập HTTP 500 và kiểm tra metrics/log

Endpoint thử nghiệm `/__test__/http-500` chỉ được tạo khi `ENABLE_TEST_ERROR_ENDPOINT=true`. Endpoint này cố ý trả về HTTP 500; chỉ bật trong môi trường thử nghiệm.

1. Mở `.env` trong thư mục dự án, đặt:

   ```dotenv
   ENABLE_TEST_ERROR_ENDPOINT=true
   ```

2. Mở PowerShell tại thư mục chứa `docker-compose.yml` (`gym-fitness-management`), rồi tạo lại app:

   ```powershell
   docker compose up -d --build --force-recreate app
   ```

3. Chờ ít nhất 15 giây để Prometheus scrape giá trị ban đầu `0` (Prometheus scrape mỗi 10 giây). Việc này giúp Prometheus nhận ra lần request tiếp theo là mức tăng của counter.

4. Gửi request:

   ```powershell
   curl.exe -i http://localhost:8081/__test__/http-500
   ```

   Kết quả đúng có dòng `HTTP/1.1 500 Internal Server Error` và JSON `{"message":"Có lỗi hệ thống, vui lòng thử lại sau."}`. Nếu thiếu dòng trạng thái, lệnh `curl.exe` có thể đang được chạy với `-s`; `-i` sẽ hiển thị status line.

5. **Kiểm tra metrics trong Prometheus:** mở `http://localhost:9090`, chọn trang **Graph** (hoặc ô truy vấn Prometheus), dán truy vấn sau và bấm **Execute**:

   ```promql
   http_requests_total{route="/__test__/http-500",status="500"}
   ```

   Counter này là tổng request kể từ lần app khởi động; sau request thử nghiệm kết quả cần là `1` hoặc lớn hơn. Đợi tối đa 10 giây sau khi gửi request để Prometheus scrape. Có thể kiểm tra số lỗi 5xx trong 5 phút bằng:

   ```promql
   sum(increase(http_requests_total{status=~"5.."}[5m])) or vector(0)
   ```

6. **Kiểm tra log trong Grafana:** mở `http://localhost:3001`, đăng nhập bằng `GRAFANA_ADMIN_USER` và `GRAFANA_ADMIN_PASSWORD` từ `.env`. Chọn **Explore** ở thanh bên trái, chọn datasource **Loki**, đặt khoảng thời gian góc trên bên phải thành **Last 15 minutes**, nhập truy vấn rồi bấm **Run query**:

   ```logql
   {job="gym-app", status="500"} | json | path="/__test__/http-500"
   ```

   Nên thấy log có `path="/__test__/http-500"` và `status=500`. Chọn **Dashboards → GymFit → GymFit - Tổng quan hệ thống** để xem panel **5xx requests (last 5 minutes)**. Panel này đếm tổng lỗi 5xx trong 5 phút gần nhất, nên request thử nghiệm sẽ hiện là `1` sau khi Prometheus scrape. Sau 5 phút, số đếm trở về 0 nếu không có lỗi mới.

7. **Kiểm tra cảnh báo email:** trong Grafana, mở **Alerting → Contact points** và kiểm tra contact point `gmail-email`; dùng nút **Test** nếu được hiển thị để gửi thư thử. Tiếp đó mở **Alerting → Alert rules** và kiểm tra rule `HTTP 5xx errors`. Rule kích hoạt khi có lỗi 5xx trong 5 phút, giữ điều kiện 1 phút; với scrape 10 giây và đánh giá rule mỗi phút, đợi khoảng 1–2 phút rồi kiểm tra email và thư mục spam.

   SMTP được cấu hình bằng `GRAFANA_SMTP_USER`, `GRAFANA_SMTP_PASSWORD` (mật khẩu ứng dụng Gmail, không phải mật khẩu đăng nhập Gmail) và `GRAFANA_SMTP_FROM_ADDRESS`. Người nhận mặc định là `GRAFANA_SMTP_USER`; đặt `GRAFANA_ALERT_EMAIL` trong `.env` nếu muốn gửi tới địa chỉ khác. Sau khi đổi cấu hình hoặc alert provisioning, nạp lại Grafana:

   ```powershell
   docker compose up -d --force-recreate grafana
   ```

8. **Tắt endpoint thử nghiệm sau khi kiểm tra:** đổi `ENABLE_TEST_ERROR_ENDPOINT=false` hoặc xóa biến đó trong `.env`, rồi chạy:

   ```powershell
   docker compose up -d --force-recreate app
   ```

   Khi endpoint đã tắt, request tới `/__test__/http-500` sẽ không còn trả về lỗi mô phỏng.

#### Nếu không thấy dữ liệu

- Nếu request trả 404, xác nhận URL chính xác là `http://localhost:8081/__test__/http-500`, `ENABLE_TEST_ERROR_ENDPOINT=true`, rồi chạy lại bước 2 để build image mới và tạo lại container.
- Nếu Prometheus không có metric, kiểm tra **Status → Targets** tại `http://localhost:9090`; target `gym-app` cần có trạng thái **UP**. Sau đó gửi lại request và chạy lại truy vấn.
- Nếu Loki không có log, xác nhận đã chọn **Loki** và khoảng thời gian bao trùm lúc gửi request. Kiểm tra `promtail` và `loki` đang chạy bằng `docker compose ps`.
- Panel **5xx requests (last 5 minutes)** hiển thị tổng lỗi gần đây, không phải tốc độ mỗi giây. Dùng truy vấn counter ở bước 4 để xác nhận request đã được ghi nhận độc lập với dashboard.

### Cảnh báo HTTP 5xx qua Gmail

Các file provision cấu hình cảnh báo nằm trong `grafana/provisioning/alerting/`: `alert-rules.yml` định nghĩa điều kiện HTTP 5xx, `contact-points.yml` khai báo email nhận, và `notification-policies.yml` định tuyến alert tới contact point.

Áp dụng cấu hình mới hoặc khởi động lại hai dịch vụ thu thập log:

```bash
docker compose up -d --force-recreate nginx promtail
```

Ví dụ LogQL:

```logql
{job="gym-app"}
```

Truy vấn log truy cập Nginx:

```logql
{job="nginx"}
```

Lọc request lỗi 5xx:

```logql
{job="gym-app"} | json | status >= 500
```

## 5. Dừng hệ thống

```bash
docker compose down
```

Xóa dữ liệu MySQL/Grafana/Loki và log Nginx:

```bash
docker compose down -v
```

## 6. Tài liệu API

Xem [API.md](./API.md) để biết hướng dẫn xác thực, API thống kê, quản lý dữ liệu, health check và metrics.

## 7. GitHub

GitHub Actions tự động kiểm tra cú pháp JavaScript, cấu hình Docker Compose và build image khi push hoặc tạo pull request.

```bash
git init
git add .
git commit -m "Khoi tao he thong quan ly phong gym fitness"
git branch -M main
git remote add origin <LINK_REPOSITORY_GITHUB>
git push -u origin main
```
