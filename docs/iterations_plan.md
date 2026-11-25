# KẾ HOẠCH & TIẾN ĐỘ TRIỂN KHAI CÁC ITERATION (HOTEL MODBUS SYSTEM)

> **Mục tiêu**: Chuyển đổi toàn diện hệ thống từ lưu trữ file tạm (JSON/CSV) sang cơ sở dữ liệu **SQLite** (`better-sqlite3`, WAL mode), xử lý triệt để các bug kết nối Modbus / CommandQueue, tối ưu hóa WebSocket/Notification, và xây dựng giao diện cấu hình động (Phòng, PLC, Hệ thống) trên Frontend.

---

## 📌 Tổng quan các Iteration

| Iteration | Nội dung chính | Trạng thái | BE Scope | FE Scope |
|---|---|:---:|---|---|
| **Iter 0** | SQLite Core Engine & Sửa lỗi Hang-Forever Modbus | ✅ **Hoàn thành** | `schema.sql`, `db.js`, `seed.js`, `stateManager.js`, `commandQueue.js` | Đồng bộ mô hình dữ liệu |
| **Iter 1** | Tối ưu Notification & Chống lặp thông báo qua SQLite | ✅ **Hoàn thành** | `notificationLogger.js`, `notificationService.js` | Bỏ `api.saveNotification()` ở WS handler |
| **Iter 2** | Quản lý Lịch sử phòng (History & Reports) | ✅ **Hoàn thành** | `historyLogger.js`, `monitorController.js` | `HistoryPage.js`, `Sidebar.js`, pagination & filter |
| **Iter 3** | Cấu hình & Quản lý Phòng Động (Dynamic Rooms) | ✅ **Hoàn thành** | Config API CRUD Rooms, reload lookup map | `SettingsPage.js` (Tab Phòng), fix filter cứng 6 phòng |
| **Iter 4** | Quản lý Cấu hình PLC & Fix Crash PLC Status | ✅ **Hoàn thành** | Config API đọc/cập nhật PLC từ SQLite, tự kết nối lại khi đổi cấu hình | Tab Quản lý PLC, chuẩn hóa trạng thái kết nối bằng `Object.values()` |
| **Iter 5** | Cấu hình Hệ thống & Test Bot Telegram | ✅ **Hoàn thành** | API GET/PUT System Configs, API Test Telegram, cập nhật runtime | Tab Cấu hình chung, form Telegram và nút kiểm tra kết nối |
| **Iter 6** | Bảo mật (.env), Clean Code & Tối ưu WebSocket | 🟡 Đang triển khai | Chuyển auth secret/API key sang `.env` | Giữ nguyên WebSocket |

---

## 🔍 Chi tiết từng Iteration

### 🟢 Iteration 0: SQLite Engine & Fix Core Bugs (ĐÃ HOÀN THÀNH)
* **Mục tiêu**: Thiết lập Database SQLite chuẩn WAL mode, seed dữ liệu 36 phòng và 6 PLC tầng 2–7; khắc phục triệt để lỗi treo HTTP request vô hạn khi PLC ngắt kết nối.
* **Chi tiết kỹ thuật Backend**:
  - Cài đặt `better-sqlite3`.
  - Tạo cấu trúc bảng: `system_configs`, `plcs`, `rooms`, `room_current_states`, `room_history`, `notifications`, `users`, `api_keys`.
  - `src/services/commandQueue.js`:
    - Xóa bỏ callback thừa ở `_executeWrite` (chống lỗi gọi callback 2 lần gây crash).
    - Đảm bảo `callback(error)` luôn được gọi trước khi `break` khi gặp lỗi ngắt kết nối socket.
    - Tự động xả hàng đợi ghi (WRITE queue) với lỗi `Floor X PLC is disconnected (timeout)` khi hết thời gian chờ (60s).
  - Thêm PLC tầng 7 (`192.168.10.247:502`) vào cấu hình.
* **Kiểm thử**: Đã chạy test script `test_iter0.mjs` đạt yêu cầu.

---

### 🟢 Iteration 1: Hệ thống Thông báo qua SQLite (ĐÃ HOÀN THÀNH)
* **Mục tiêu**: Chấm dứt tình trạng thông báo bị trùng lặp khi nhiều tab trình duyệt mở đồng thời; hỗ trợ xóa sạch thông báo từ DB.
* **Chi tiết kỹ thuật**:
  - **Backend**:
    - `notificationLogger.js`: Đọc/ghi trực tiếp vào bảng `notifications`. Sửa lỗi `clearAllNotifications()` (thực thi `DELETE FROM notifications`).
    - `notificationService.js`: Backend tự động insert thông báo vào SQLite ngay khi phát hiện thay đổi trạng thái Modbus, sau đó mới emit qua WebSocket kèm ID duy nhất.
  - **Frontend**:
    - `App.js`: Loại bỏ hoàn toàn lệnh gọi `api.saveNotification(...)` bên trong socket event `state-changed`. Chỉ nhận payload và cập nhật UI.
* **Kiểm thử**: Đã chạy test script `test_iter1.mjs` đạt yêu cầu.

---

### 🟢 Iteration 2: Lịch sử & Báo cáo Trạng thái Phòng (ĐÃ HOÀN THÀNH)
* **Mục tiêu**: Xây dựng trang tra cứu lịch sử thay đổi trạng thái phòng có bộ lọc và phân trang chuyên nghiệp.
* **Chi tiết kỹ thuật**:
  - **Backend**:
    - `historyLogger.js`: Ghi nhận thay đổi vào bảng `room_history`. Viết hàm `getHistory({ room, startDate, endDate, state, page, limit })` sử dụng truy vấn SQL `LIMIT / OFFSET`.
    - `monitorController.js`: Bổ sung query params cho API `GET /api/monitor/history`.
  - **Frontend**:
    - `src/services/api.js`: Thêm hàm `getStateHistory(params)`.
    - `src/components/HistoryPage.js`: Giao diện bộ lọc (chọn phòng, trạng thái, khoảng ngày), bảng dữ liệu màu theo trạng thái (badge), thanh chuyển trang.
    - `src/components/Sidebar.js` & `App.js`: Thêm menu "Lịch sử" và router hiển thị trang.
* **Kiểm thử**: Đã chạy `test_iter2.mjs` và build frontend thành công.

---

### 🟢 Iteration 3: Cấu hình & Quản lý Phòng Động (ĐÃ HOÀN THÀNH)
* **Mục tiêu**: Cho phép Admin thêm, sửa, bật/tắt phòng trực tiếp từ giao diện web; loại bỏ giới hạn cứng chỉ hiển thị 6 phòng/tầng ở Frontend.
* **Công việc Backend**:
  - Tạo Controller `src/controllers/configController.js` và Route `src/routes/config.js`:
    - `GET /api/config/rooms`: Lấy danh sách toàn bộ phòng và mapping Modbus.
    - `POST /api/config/rooms`: Thêm phòng mới (kiểm tra trùng lặp, tự khởi tạo record trong `room_current_states`).
    - `PUT /api/config/rooms/:room`: Cập nhật cấu hình coil/input của phòng.
    - `DELETE /api/config/rooms/:room`: Đánh dấu `is_active = 0` (soft delete) hoặc xóa.
  - Cập nhật `configLoader.js`: Thêm hàm nạp lại cache từ SQLite (`reload()`) thay vì chỉ đọc từ `appsettings.json`.
  - Phân quyền: Chỉ tài khoản có `role: 'admin'` mới được thao tác cấu hình.
* **Công việc Frontend**:
  - `src/App.js`:
    - Loại bỏ bộ lọc cứng `suffix >= 1 && suffix <= 6`.
    - Sắp xếp và gom nhóm theo trường `floor` do Backend trả về thay vì cắt ký tự đầu của số phòng.
  - `src/services/api.js`: Bổ sung các hàm `getRoomsConfig()`, `createRoom()`, `updateRoom()`, `deleteRoom()`.
  - Tạo trang `src/components/SettingsPage.js` (Tab Quản lý Phòng): Bảng danh sách phòng, nút "Thêm phòng mới", Modal form nhập chi tiết (Số phòng, Tầng, Y Main, Y Sub, X Input,...).
  - `src/components/Sidebar.js`: Thêm nút "Cài đặt" (chỉ hiển thị khi `user.role === 'admin'`).

---

### 🟢 Iteration 4: Quản lý Cấu hình PLC & Fix Crash PLC Status (ĐÃ HOÀN THÀNH)
* **Mục tiêu**: Cho phép thay đổi IP, port, timeout của PLC các tầng mà không cần sửa file JSON; khắc phục lỗi crash dashboard khi đọc trạng thái kết nối PLC.
* **Chi tiết kỹ thuật**:
  - **Backend**:
    - API đọc/cập nhật cấu hình PLC (`GET /api/config/plcs`, `PUT /api/config/plcs/:floor`).
    - Cấu hình PLC runtime được nạp từ SQLite.
    - Khi cập nhật thông số kết nối, tự động ngắt socket cũ, cập nhật polling và kết nối lại tới PLC mới trong `plcManager.js`.
  - **Frontend**:
    - Sửa bug `plcStatus`: Backend trả về `Object` dạng `{ 2: true, 3: false }` nhưng Frontend đang gọi `.every()` (vốn là hàm của Array) gây lỗi giao diện -> Đổi thành `Object.values(statuses).every(...)`.
    - Tab "Quản lý PLC" trong `SettingsPage.js`.

---

### 🟢 Iteration 5: Cấu hình Hệ thống & Test Bot Telegram (ĐÃ HOÀN THÀNH)
* **Mục tiêu**: Quản trị cấu hình chung (polling interval, cổng mạng) và quản lý cấu hình thông báo Telegram ngay trên UI.
* **Chi tiết kỹ thuật**:
  - **Backend**:
    - API đọc/ghi bảng `system_configs` (`GET/PUT /api/config/settings`), kiểm tra dữ liệu và nạp lại polling/Telegram vào runtime.
    - API `POST /api/config/test-telegram`: Gửi ngay một tin nhắn mẫu tới Telegram để kiểm tra Token và Chat ID; lỗi được trả rõ ràng, không ghi token vào log.
    - Các cấu hình đang dùng về keep-alive, CORS, rate limit, PLC reconnect, email và mẫu thông báo chuyển trạng thái được seed vào SQLite, tải lại qua ConfigLoader và chỉnh trong tab Cấu hình chung.
    - Token Telegram được che trong dữ liệu trả về cấu hình; thay đổi cổng backend yêu cầu khởi động lại.
    - Loại bỏ lưu trữ dự phòng bằng CSV/JSON cho trạng thái phòng, lịch sử và thông báo; SQLite là nguồn lưu trữ duy nhất.
    - **Frontend**:
    - Tab "Cấu hình chung" trong `SettingsPage.js`: Form cấu hình Bot Token, Chat ID, nút bấm "Kiểm tra kết nối Telegram".

---

### ⚪ Iteration 6: Bảo mật, Biến môi trường & Tối ưu WebSocket
* **Mục tiêu**: Hoàn thiện dự án chuẩn production, bảo mật thông tin nhạy cảm và tối ưu băng thông.
* **Chi tiết kỹ thuật**:
  - Quản lý tài khoản: đăng nhập và đổi mật khẩu dùng bảng `users`; mật khẩu được hash bằng bcrypt. Migration tài khoản một lần xóa user cũ và tạo duy nhất admin từ `INITIAL_ADMIN_USERNAME`/`INITIAL_ADMIN_PASSWORD`; không lưu mật khẩu mẫu trong source.
  - API đổi mật khẩu cho người dùng đã đăng nhập và API CRUD user chỉ dành cho Admin; bảo vệ tài khoản Admin cuối cùng và không cho tự xóa/tự đổi vai trò.
  - Frontend bổ sung trang đổi mật khẩu và tab quản lý người dùng, không trả password hash về giao diện.
  - Đã chuyển secret xác thực và API Key mặc định sang file `.env` (dùng thư viện `dotenv`); `.env` phải được giữ ngoài Git.
  - JWT đăng nhập hết hạn sau 24 giờ không hoạt động cho mọi tài khoản; chỉ hoạt động người dùng mới gia hạn timeout, request kiểm tra token không gia hạn. Logout thu hồi token trong SQLite. Tùy chọn ở màn hình đăng nhập chỉ ghi nhớ username.
  - Tối ưu WebSocket được giữ nguyên và bỏ qua trong đợt triển khai này theo yêu cầu.
  - Dọn dẹp các file tạm, hoàn thiện tài liệu hướng dẫn vận hành và sao lưu database.

---

## 🛠️ Lưu ý quan trọng cho quá trình vận hành & kiểm thử
1. **Đăng nhập trên Localhost**:
   - Cookie phiên làm việc cần cấu hình `sameSite: 'lax'` khi đang ở môi trường phát triển (`NODE_ENV !== 'production'`) để tránh bị trình duyệt chặn cross-origin giữa port 3001 (FE) và 3000 (BE).
2. **Cơ sở dữ liệu SQLite**:
   - File database được lưu tại: `hotel-modbus-system/data/hotel.db`.
   - Có thể xem trực tiếp bằng các công cụ như **DB Browser for SQLite**, **DBeaver** hoặc extension SQLite Viewer trong VS Code.
