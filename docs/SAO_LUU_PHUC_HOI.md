# Sao lưu & phục hồi dữ liệu

Dữ liệu nằm trong **Supabase PostgreSQL**. Vercel chỉ chứa mã chạy ứng dụng, không chứa dữ liệu.

## 1. Sao lưu tự động của Supabase
* Gói **Pro** trở lên: sao lưu hằng ngày (lưu theo thời hạn của gói) và có thể bật **Point-in-Time Recovery**. Xem *Dashboard → Database → Backups*.
* Gói **Free**: không có sao lưu tự động đáng tin cậy ⇒ **bắt buộc tự sao lưu thủ công** (mục 2). Kiểm tra chính sách gói hiện hành tại tài liệu Supabase vì có thể thay đổi.

## 2. Sao lưu thủ công (khuyến nghị mỗi ngày/tuần, và trước mỗi lần cập nhật cấu trúc)
Cần công cụ `pg_dump` (cài PostgreSQL client). Lấy *Connection string* ở *Dashboard → Connect* (dùng loại **Session pooler** hoặc **Direct**), thay `[MẬT-KHẨU]`.

```bash
# Toàn bộ dữ liệu nghiệp vụ (schema public) — giữ file ở nơi an toàn, KHÔNG đưa lên GitHub
pg_dump "postgresql://postgres.<ref>:[MẬT-KHẨU]@<host>:5432/postgres" \
  --schema=public --no-owner --no-privileges --format=custom \
  --file "khoai-$(date +%F).dump"
```

Tài khoản đăng nhập (schema `auth`) do Supabase quản lý và có trong bản sao lưu tự động của Supabase. Nếu chỉ dùng `pg_dump --schema=public`, khi phục hồi vào dự án **mới** bạn phải tạo lại tài khoản (mục 6 README) và cập nhật `profiles.id` tương ứng — vì vậy với sự cố nghiêm trọng hãy ưu tiên **phục hồi từ Backups của Supabase**.

Ngoài ra có thể **xuất Excel** (Danh sách & báo cáo) làm bản lưu đọc được cho nghiệp vụ.

## 3. Phục hồi
**A. Cùng dự án, từ Backups của Supabase (nhanh nhất):** *Dashboard → Database → Backups → Restore*. Dữ liệu sau thời điểm sao lưu sẽ mất; hãy thông báo nhân viên ngừng nhập trong lúc phục hồi.

**B. Từ file `.dump` vào dự án Supabase trống (đã chạy migration 0001–0004):**
```bash
# 1. Chỉ lấy dữ liệu từ bản dump, vào CSDL đã có cấu trúc
pg_restore --data-only --disable-triggers --no-owner \
  -d "postgresql://postgres.<ref>:[MẬT-KHẨU]@<host>:5432/postgres" khoai-2030-01-01.dump
```
Lưu ý: `--disable-triggers` cần quyền cao; nếu bị từ chối, hãy phục hồi bằng cách A hoặc nhờ người có kinh nghiệm. Sau khi phục hồi, kiểm tra:
```sql
select count(*) from public.dining_tables;   -- phải đủ 29 bàn (nếu chưa thêm/bớt)
select count(*) from public.bookings;
```
và đăng nhập thử, mở vài lượt đặt, xem lịch sử.

**C. Phục hồi một lượt đặt bị sai:** không xóa; dùng *Lịch sử thay đổi* để biết giá trị cũ rồi sửa lại trong ứng dụng.

## 4. Kiểm tra định kỳ
* Mỗi quý, thử phục hồi bản sao lưu vào một dự án Supabase **tạm** để chắc chắn file dùng được.
* Lưu file sao lưu ở ít nhất hai nơi, giới hạn người truy cập (chứa dữ liệu khách).
