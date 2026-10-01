-- Dữ liệu khởi tạo thật của nhà hàng (nguồn: "Cấu hình NH Khoái.xlsx").
-- Chạy lặp lại an toàn: không tạo trùng, không ghi đè thay đổi do quản lý đã sửa.

insert into public.floors (code, name, sort_order) values
  ('T1', 'Tầng trệt', 1),
  ('T2', 'Tầng 2', 2),
  ('T4', 'Tầng 4', 3)
on conflict (code) do nothing;

insert into public.dining_tables (code, floor_code, capacity, sort_order) values
  -- TẦNG TRỆT — 15 bàn, 60 khách
  ('A1', 'T1', 4, 1), ('A2', 'T1', 4, 2), ('A3', 'T1', 6, 3), ('A4', 'T1', 4, 4), ('A5', 'T1', 2, 5),
  ('A6', 'T1', 4, 6), ('A7', 'T1', 4, 7), ('A8', 'T1', 6, 8), ('A9', 'T1', 4, 9), ('A10', 'T1', 2, 10),
  ('A11', 'T1', 4, 11), ('A12', 'T1', 4, 12), ('A13', 'T1', 4, 13), ('A14', 'T1', 4, 14), ('A15', 'T1', 4, 15),
  -- TẦNG 2 — 12 bàn/khu, 89 khách
  ('VIP 1', 'T2', 10, 1), ('VIP 4', 'T2', 5, 2), ('VIP 7', 'T2', 10, 3),
  ('B1.1', 'T2', 15, 4), ('B1.10', 'T2', 15, 5),
  ('B2.1', 'T2', 6, 6), ('B2.2', 'T2', 4, 7), ('B2.3', 'T2', 4, 8), ('B2.4', 'T2', 8, 9),
  ('B2.5', 'T2', 4, 10), ('B2.6', 'T2', 4, 11), ('B2.7', 'T2', 4, 12),
  -- TẦNG 4 — 2 bàn/khu, 80 khách (đặt nguyên khối, chưa chia nhỏ)
  ('STT', 'T4', 30, 1), ('STN', 'T4', 50, 2)
on conflict (code) do nothing;

-- Danh mục MẪU ĐỀ XUẤT (chưa được nhà hàng xác nhận) — quản lý có thể sửa/thêm/ẩn trong ứng dụng.
insert into public.lookups (kind, label, sort_order) values
  ('source', 'Khách quen / giới thiệu', 1), ('source', 'Điện thoại', 2), ('source', 'Zalo', 3),
  ('source', 'Facebook', 4), ('source', 'Khách vãng lai', 5), ('source', 'Đối tác / công ty', 6),
  ('purpose', 'Sinh nhật', 1), ('purpose', 'Tiệc gia đình', 2), ('purpose', 'Tiệc công ty', 3),
  ('purpose', 'Họp mặt bạn bè', 4), ('purpose', 'Liên hoan / tất niên', 5), ('purpose', 'Khác', 6),
  ('purpose', 'Báo hỷ', 7), ('purpose', 'Thôi nôi', 8), ('purpose', 'Kỷ niệm', 9), ('purpose', 'Tổng kết', 10),
  ('source', 'BNI', 7), ('source', 'TikTok', 8), ('source', 'Website', 9),
  ('consultant', 'Lễ tân', 1), ('consultant', 'Khánh Hồng', 2), ('consultant', 'Cát Tường', 3), ('consultant', 'Uyên Hồ', 4),
  ('deposit_method', 'Tiền mặt', 1), ('deposit_method', 'Chuyển khoản', 2), ('deposit_method', 'Thẻ', 3)
on conflict (kind, label) do nothing;
