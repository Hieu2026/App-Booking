# Triển khai Vercel — tóm tắt nhanh

1. Vercel → Add New → Project → chọn repo `App-Booking` (đặt Production Branch là `claude/khoai-table-booking-app-vbn1sx` nếu chưa gộp vào `main`).
2. Thêm 4 biến môi trường: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (bí mật), `NEXT_PUBLIC_POLL_SECONDS=20`.
3. Deploy. Thêm/sửa biến xong phải **Redeploy** thì mới có hiệu lực.
4. Supabase → Authentication → URL Configuration: đặt Site URL là địa chỉ Vercel.

Chi tiết và cách xử lý lỗi: xem README mục 5.
