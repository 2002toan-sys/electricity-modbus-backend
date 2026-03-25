# Hướng dẫn tích hợp API Hotel Modbus System (Dành cho Skyhotel)

Tài liệu này cung cấp các hướng dẫn chi tiết để đội ngũ kỹ thuật Skyhotel tích hợp hệ thống quản lý phòng (PMS) với bộ điều khiển trung tâm tại khách sạn.

## 1. Thông tin chung
- **Base URL**: `http://[IP_BACKEND]:5002/api`
- **Authentication**: Sử dụng **X-API-Key** truyền trong Header.
- **Content-Type**: `application/json`

### Header bắt buộc
```http
X-API-Key: [YOUR_API_KEY]
Content-Type: application/json
```

## 2. Danh sách API chính

### 2.1. Điều khiển Main Relay)
Dùng để cấp/ngắt nguồn điện chính khi khách Check-in/Check-out.

- **Endpoint**: `POST /relay/main/set`
- **Body**: Mảng các đối tượng (Hỗ trợ điều khiển 1 hoặc nhiều phòng cùng lúc).

**Ví dụ Request điều khiển 1 phòng:**
```json
[
  {
    "room": "302",
    "set": "on"
  }
]
```

**Ví dụ Request điều khiển nhiều phòng:**
```json
[
  { "room": "301", "set": "on" },
  { "room": "302", "set": "off" }
]
```
*(Thay `"on"` bằng `"off"` để ngắt điện)*

**Kết quả trả về (Response - 200 OK):**
Hệ thống trả về mảng kết quả tương ứng với số lượng phòng đã gửi.
```json
[
  {
    "room": "302",
    "status": "on",
    "type": "main",
    "floor": 3,
    "timestamp": "2024-03-19T03:00:00.000Z"
  }
]
```

### 2.2. Điều khiển (Sub Relay)


- **Endpoint**: `POST /relay/sub/set`
- **Body & Response**: 

### 2.3. Lấy trạng thái Main Relay (Tối giản)
Dùng để lấy trực tiếp trạng thái nguồn điện chính ("on"/"off") để đồng bộ.

- **Endpoint**: `GET /relay/main/`
- **Query Params (`?rooms=`)**:
  - `?rooms` (không chứa ID): Lấy tất cả.
  - `?rooms=301`: Lấy phòng 301.
  - `?rooms=301,302`: Lấy danh sách nhiều phòng, 

**Ví dụ Response trả về dữ liệu nhanh (200 OK):**
```json
{
  "301": "on",
  "302": "off"
}
```

### 2.4. Giám sát trạng thái phòng tổng thể (Monitor)
Dùng để lấy trạng thái thực tế của các phòng và Relay tại khách sạn.

- **Endpoint**: `GET /monitor/rooms`

**Ví dụ Response thành công:**
```json
[
  {
    "room": 302,
    "mainStatus": true,
    "subStatus": false,
    "state": 1,
    "stateName": "Có khách",
    "x_input": true,
    "timestamp": "2024-03-19T03:00:00Z"
  }
]
```

## 3. Mã lỗi (Error Codes)

| Mã lỗi | Ý nghĩa | Mô tả |
| :--- | :--- | :--- |
| **200** | OK | Thao tác thành công. |
| **400** | Bad Request | Dữ liệu gửi lên không đúng định dạng hoặc thiếu thông tin phòng. |
| **401** | Unauthorized | X-API-Key không chính xác hoặc bị thiếu. |
| **500** | Internal Error | Lỗi hệ thống server. |
| **503** | Service Unavailable | Chức năng ghi Relay đang bị tạm khóa (trong cấu hình hệ thống). |

## 4. Quy trình tích hợp & Đồng bộ

### 4.1. Nguyên tắc điều khiển
1. **Request trực tiếp**: Skyhotel gọi thẳng đến Endpoint tại khách sạn từ máy khách (Client) hoặc Server PMS.
2. **Kịch bản điều khiển**:
   - Chỉ gọi API **mở điện khi Check-in** và **tắt điện khi Check-out**.
   - **KHÔNG** gọi API khi nhân viên set khách ra ngoài/khách quay lại 

### 4.2. Hỗ trợ Đồng bộ (Sync)
Nhờ đội ngũ kỹ thuật Skyhotel hỗ trợ tạo một **Nút bấm** trên giao diện PMS (Sơ đồ khách sạn) để hỗ trợ đồng bộ trạng thái đóng/mở điện dựa trên trạng thái phòng:
1. Khi nhấn nút, PMS gọi API (`GET /monitor/rooms`) để lấy trạng thái thực tế tại khách sạn.
2. Thực hiện so sánh với sơ đồ trên PMS:
   - Nếu PMS báo phòng **Đang ở** nhưng `mainStatus` tại khách sạn là `false` (đang tắt) -> PMS gửi lệnh `set: on`.
   - Nếu PMS báo phòng **Đang trống** nhưng `mainStatus` tại khách sạn là `true` (đang bật) -> PMS gửi lệnh `set: off`.
3. Việc này giúp đảm bảo hệ thống điện luôn khớp với trạng thái thực tế trên PMS.

---

