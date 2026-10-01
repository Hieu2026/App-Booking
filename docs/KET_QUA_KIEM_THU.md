# Kết quả kiểm thử (chạy thực tế)

Ngày chạy: 01/10/2026 · Node 22 · PostgreSQL 16.14 cục bộ · Chromium (Playwright 1.63) · Next.js 16.3.8 (bản **production build**).

| Lớp kiểm thử | Lệnh | Kết quả |
|---|---|---|
| Kiểu dữ liệu | `npm run typecheck` | Đạt, 0 lỗi |
| Lint | `npm run lint` | Đạt, 0 lỗi, 0 cảnh báo |
| Cơ sở dữ liệu thật (35 test) + hàm thuần (8 test) | `npm run test` | **43/43 đạt** |
| Trình duyệt thật, 4 phiên song song, CSDL thật (21 test) | `npm run test:e2e` | **21/21 đạt** |
| Build production | `npm run build` | Thành công |

Ảnh chụp từ lần chạy: [laptop](screenshots/laptop-ban.png) · [tablet](screenshots/tablet-ban.png) · [điện thoại](screenshots/dien-thoai-ban.png) · [danh sách/báo cáo](screenshots/laptop-danh-sach.png) · [biểu mẫu đặt bàn](screenshots/laptop-dat-moi.png).

## Cách chạy lại

```bash
# PostgreSQL cục bộ có sẵn user khoai_test / mật khẩu test (superuser) — xem tests/db/setup.sh
npm run test        # tự tạo CSDL khoai_test, nạp mô phỏng Supabase + migration + seed
npm run test:e2e    # tự build, dựng "mini-supabase" (tests/e2e/mini-supabase.mjs) + app, tạo CSDL khoai_e2e
```

## Đối chiếu 12 điều kiện nghiệm thu

| # | Điều kiện | Bằng chứng | Kết quả |
|---|---|---|---|
| 1 | Seed đúng 29 bàn/khu, 229 chỗ, đúng tổng từng tầng | `tests/db/schema.test.ts`: 29 bàn / 229 chỗ; T1 15/60, T2 12/89, T4 2/80; seed chạy lặp 2 lần không tạo trùng, không ghi đè chỉnh sửa. E2E kiểm tra giao diện hiển thị đủ 29 thẻ và tổng từng tầng | Đạt |
| 2 | Phân biệt B1.1 / B1.10; không mất STT | `schema.test.ts` (mã, sức chứa, không còn khoảng trắng thừa như “VIP 4 ”) + E2E thấy thẻ STT, STN, B1.1, B1.10 | Đạt |
| 3 | Tạo, sửa, hủy, hoàn tất | `booking.test.ts` (vòng đời + nhật ký) và E2E (tạo trên giao diện, hủy có lý do, vãng lai → hoàn tất → chờ dọn → sẵn sàng, thêm/bớt/đổi bàn) | Đạt |
| 4 | Bốn phiên cùng làm việc, nhận cập nhật | DB: 4 người dùng khác nhau cùng thấy dữ liệu vừa lưu. E2E: 4 trình duyệt độc lập, một người tạo → 3 máy còn lại tự thấy bàn chuyển đỏ (cơ chế **làm mới định kỳ**; xem “Chưa kiểm chứng” về Realtime) | Đạt (qua làm mới định kỳ) |
| 5 | Hai yêu cầu đồng thời đặt trùng bàn: chỉ một thành công | DB: 5 yêu cầu song song × 5 vòng → luôn đúng 1 thành công, 4 `E_OVERLAP`; E2E: 2 trình duyệt bấm lưu cùng lúc → 1 thành công, người kia thấy “Vừa có người đặt trước…” và bàn chuyển “Trùng lịch”, nội dung đang nhập còn nguyên. *Kiểm chứng đột biến:* gỡ ràng buộc loại trừ → 8 test thất bại | Đạt |
| 6 | Đặt nhiều bàn thất bại không để lại dữ liệu một phần | DB: đặt A8+A9+A10 khi A9 trùng → số dòng `bookings`/`booking_tables` không đổi; thêm bàn trùng khi sửa → không đổi gì, phiên bản không tăng; đặt chéo (A,B)/(B,A) song song không kẹt và mỗi bàn đúng 1 lượt | Đạt |
| 7 | Sửa từ dữ liệu cũ không ghi đè âm thầm | DB: `E_VERSION` (kèm người sửa); E2E: máy B đang nhập dở → được báo “vừa sửa”, bấm lưu bị chặn, dữ liệu của máy A giữ nguyên, nội dung B còn trên màn hình | Đạt |
| 8 | Chưa đăng nhập / không có quyền: không đọc/ghi qua API | DB: vai trò `anon` bị `permission denied` ở mọi bảng và hàm; người có tài khoản nhưng không có hồ sơ / bị khóa chỉ thấy 0 dòng và `E_FORBIDDEN`; nhân viên không `INSERT/UPDATE/DELETE` trực tiếp được, không sửa/xóa được nhật ký (kể cả chủ sở hữu), hàm quản lý trả `E_FORBIDDEN` với lễ tân. E2E: trang/API không phiên → chuyển đăng nhập/401; gọi thẳng RPC bằng khóa công khai → 401/403, không lộ dữ liệu | Đạt |
| 9 | Báo cáo không đếm trùng; số điện thoại giữ số 0 | Lượt 2 bàn + 3 món → 1 dòng, tổng 1 lượt / 28 khách / 3.000.000 (cả ở màn hình và file .xlsx); ô điện thoại là văn bản `0987654321`; tiền là số định dạng `#,##0`; ngày giờ là giờ tường Việt Nam; `=…`, `+…`, `@…` được tiền tố `'` | Đạt |
| 10 | Làm mới / đăng nhập máy khác vẫn thấy dữ liệu | E2E: reload và phiên khác thấy lượt đặt vừa lưu | Đạt |
| 11 | Laptop, tablet, điện thoại không vỡ | E2E: 1366×768, 820×1180, 390×844 — 6 màn hình × 3 cỡ không có cuộn ngang toàn trang; luồng chọn bàn, mở chi tiết bàn dùng được; đã xem ảnh chụp | Đạt (Chromium giả lập khung hình) |
| 12 | Build production | `next build` thành công | Đạt |

Các hành vi khác đã có kiểm thử: khoảng `[bắt đầu, kết thúc)` (liền kề không trùng), trạng thái giữ chỗ / không giữ chỗ, khoảng đệm dọn bàn 15 phút, cảnh báo sức chứa / ngoài giờ (kể cả qua nửa đêm) và ghi đè chỉ dành cho quản lý kèm lý do, **không ghi đè được trùng lịch**, bàn đang phục vụ quá giờ vẫn “đang phục vụ” và chặn lượt kế tiếp, tạm ngưng / mở lại bàn, chống gửi lặp (4 yêu cầu cùng khóa chỉ tạo 1 lượt; người khác không dùng lại được khóa), tìm kiếm không dấu / theo số điện thoại khác định dạng / mã bàn / Mã HĐ, chống chèn SQL ở tham số sắp xếp, tạo – khóa tài khoản, quản lý bàn / danh mục / cấu hình, nhật ký.

## CHƯA kiểm chứng (cần làm khi triển khai thật)

1. **Chưa chạy trên Supabase và Vercel thật.** Môi trường tạo ra mã nguồn không có tài khoản/quyền các dịch vụ này; không có URL online. Hãy làm theo README mục 3–6 rồi chạy “checklist sau triển khai” bên dưới.
2. **Supabase Auth / PostgREST / Realtime thật chưa được dùng.** Migration, RLS, quyền hàm, ràng buộc và đồng thời được kiểm thử trên **PostgreSQL 16 thật** với vai trò `anon`/`authenticated` và JWT claims giống cách PostgREST hoạt động. Trình duyệt tự động chạy qua công cụ mô phỏng nhỏ `tests/e2e/mini-supabase.mjs` (đăng nhập + gọi RPC; **chỉ để kiểm thử, không triển khai**). Lớp HTTP của PostgREST, GoTrue thật và việc đẩy tin **Realtime** chưa được chạy; ứng dụng có sẵn làm mới định kỳ (~20 giây, khi quay lại tab, khi có mạng lại) nên vẫn cập nhật nếu Realtime không hoạt động.
3. **Migration chưa chạy bằng Supabase CLI/SQL Editor** mà bằng `psql` trên PostgreSQL 16 (Supabase dùng bản mới hơn một chút; các tính năng dùng ở đây — `btree_gist`, `unaccent`, ràng buộc loại trừ, `SECURITY DEFINER` — đều có sẵn).
4. Trình duyệt thật trên máy tablet/điện thoại, Safari, Firefox: chưa thử (chỉ Chromium giả lập khung hình). Định dạng ô ngày/giờ phụ thuộc ngôn ngữ trình duyệt.
5. Liên kết SMS / Zalo / Email: mới kiểm tra nội dung và địa chỉ liên kết, chưa mở thử trên thiết bị thật (Zalo không nhận sẵn nội dung — ứng dụng tự sao chép để dán).
6. Lệnh sao lưu/phục hồi trong `docs/SAO_LUU_PHUC_HOI.md` chưa chạy với dự án Supabase thật.
7. Chưa đo tải/hiệu năng với dữ liệu lớn (nhiều năm, hàng chục nghìn lượt đặt). Xuất Excel giới hạn 20.000 lượt mỗi lần.

## Checklist sau khi triển khai thật (khoảng 15 phút)

- [ ] Đăng nhập bằng quản lý; tạo 1 lễ tân; đăng nhập lễ tân ở trình duyệt khác.
- [ ] *Quản lý → Danh mục bàn*: đủ 29 bàn, 229 chỗ.
- [ ] Ở hai máy cùng đặt một bàn một giờ: chỉ một máy thành công.
- [ ] Máy A tạo lượt đặt → máy B thấy bàn đỏ trong vài giây (kiểm tra chấm “Trực tiếp” = Realtime hoạt động).
- [ ] Mở trang web khi chưa đăng nhập → bị chuyển về trang đăng nhập; Supabase → *Authentication* đã **tắt đăng ký công khai**.
- [ ] Xuất Excel, mở bằng Excel: số điện thoại giữ số 0 đầu.
- [ ] Chạy `supabase/demo/demo_cleanup.sql` nếu đã từng nạp demo.
