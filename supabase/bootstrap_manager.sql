-- Tạo HỒ SƠ quản lý đầu tiên cho một tài khoản ĐÃ có trong Supabase Auth.
-- Bước 1: Supabase Dashboard → Authentication → Users → "Add user" (đặt mật khẩu mạnh của riêng bạn,
--         tick "Auto Confirm User"). KHÔNG dùng mật khẩu mặc định/công khai.
-- Bước 2: Đổi email và họ tên bên dưới cho đúng, rồi chạy trong SQL Editor.
insert into public.profiles (id, full_name, email, role, active)
select id, 'Quản lý (đổi tên)', email, 'manager', true
  from auth.users
 where email = 'email-cua-quan-ly@example.com'   -- ← đổi thành email vừa tạo
on conflict (id) do update set role = 'manager', active = true;

-- Kiểm tra: phải thấy đúng 1 dòng.
select id, full_name, email, role, active from public.profiles where role = 'manager';
