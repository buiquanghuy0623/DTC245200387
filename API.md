# Tài liệu API - GymFit Manager

Base URL mặc định: `http://localhost`. Các endpoint `/api` dùng cookie phiên `gymfit_session`; đăng nhập trước và giữ cookie để gọi các API cần xác thực. Tên đăng nhập và mật khẩu lấy từ `GYM_ADMIN_USERNAME` và `GYM_ADMIN_PASSWORD` trong `.env`.

## Xác thực

| Method | Endpoint | Xác thực | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/auth/session` | Không | Kiểm tra phiên hiện tại |
| `POST` | `/api/auth/login` | Không | Đăng nhập |
| `POST` | `/api/auth/logout` | Không | Đăng xuất, xóa cookie phiên |

Đăng nhập bằng JSON; lưu cookie trả về để dùng cho các request tiếp theo:

```bash
curl -i -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"<GYM_ADMIN_USERNAME>","password":"<GYM_ADMIN_PASSWORD>"}' \
  http://localhost/api/auth/login
```

## API thống kê tổng quan

`GET /api/dashboard` — cần đăng nhập. Trả về số liệu hội viên, huấn luyện viên, gói tập và lịch tập từ ngày hiện tại trở đi:

```bash
curl -b cookies.txt http://localhost/api/dashboard
```

Ví dụ phản hồi:

```json
{
  "members": { "total": 12, "active": 10, "expired": 2 },
  "trainers": { "total": 3 },
  "packages": { "total": 4 },
  "schedules": { "total": 5 }
}
```

`members.active` và `members.expired` có thể là `null` khi chưa có hội viên.

## Quản lý dữ liệu

Tất cả endpoint dưới đây cần đăng nhập. Danh sách trả về là mảng JSON; `POST` tạo bản ghi mới, `PUT` cập nhật theo ID và `DELETE` xóa theo ID.

| Tài nguyên | GET danh sách | POST tạo | PUT cập nhật | DELETE xóa |
| --- | --- | --- | --- | --- |
| Hội viên | `/api/members` | `/api/members` | `/api/members/:id` | `/api/members/:id` |
| Huấn luyện viên | `/api/trainers` | `/api/trainers` | `/api/trainers/:id` | `/api/trainers/:id` |
| Gói tập | `/api/packages` | `/api/packages` | `/api/packages/:id` | `/api/packages/:id` |
| Lịch tập | `/api/schedules` | `/api/schedules` | `/api/schedules/:id` | `/api/schedules/:id` |

Gửi body JSON với các trường tương ứng:

- Hội viên: `full_name`, `phone`, `email`, `gender`, `package_id`, `start_date`, `end_date`, `status`. `full_name` và `phone` là bắt buộc.
- Huấn luyện viên: `full_name`, `specialty`, `phone`, `email`, `profile_photo`, `status`. `full_name` và `specialty` là bắt buộc; ảnh tùy chọn dạng data URL PNG/JPEG/WEBP, tối đa 1 MB.
- Gói tập: `name`, `duration_months`, `price`, `description`. Tên bắt buộc, thời hạn phải lớn hơn 0, giá không âm.
- Lịch tập: `title`, `class_type`, `schedule_date`, `start_time`, `end_time`, `room`, `trainer_id`, `max_members`. Tên lớp, loại lớp, ngày và thời gian bắt đầu/kết thúc là bắt buộc.

Ví dụ tạo hội viên:

```bash
curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"full_name":"Nguyen Van A","phone":"0900000000","gender":"Nam","status":"Hoạt động"}' \
  http://localhost/api/members
```

Request sai dữ liệu trả về `400`, chưa đăng nhập trả về `401`, ID không tồn tại khi cập nhật/xóa trả về `404`; tạo thành công trả về `201`.

## Health check và metrics

| Method | Endpoint | Mô tả |
| --- | --- | --- |
| `GET` | `/health` | Kiểm tra ứng dụng và kết nối database |
| `GET` | `/metrics` | Metrics Prometheus (dùng nội bộ; Prometheus scrape trực tiếp) |
