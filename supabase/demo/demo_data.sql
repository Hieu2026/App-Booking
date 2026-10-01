-- DỮ LIỆU DEMO — chỉ để xem thử giao diện. KHÔNG chạy trên hệ thống thật đang vận hành.
-- Mọi dòng demo được đánh dấu is_demo = true và xóa sạch bằng supabase/demo/demo_cleanup.sql.
-- Chạy trong SQL Editor của Supabase sau khi đã chạy migration + seed và đã có ít nhất một tài khoản quản lý.
do $$
declare
  v_by   uuid := (select id from public.profiles where role = 'manager' and active order by created_at limit 1);
  v_day  date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_id   uuid;
  r      record;
begin
  if v_by is null then raise exception 'Chưa có tài khoản quản lý — hãy tạo trước khi nạp dữ liệu demo.'; end if;
  for r in select * from (values
    ('A3',   0, '11:30', '13:30', 'Nguyễn Minh Anh',  '0901000001', 'Sinh nhật bố',        5, 'confirmed'),
    ('A8',   0, '12:00', '14:00', 'Trần Quốc Bảo',   '0901000002', null,                  6, 'pending'),
    ('VIP 1',0, '18:00', '21:00', 'Công ty ABC',      '0901000003', 'Tiệc cuối năm',      10, 'confirmed'),
    ('B1.1', 0, '18:30', '21:30', 'Lê Thu Hà',        '0901000004', 'Thôi nôi bé Bin',    15, 'confirmed'),
    ('STT',  1, '18:00', '21:00', 'Phạm Văn Dũng',    '0901000005', 'Tiệc cưới nhỏ',      30, 'pending'),
    ('B2.4', 1, '12:00', '14:00', 'Hoàng Thị Mai',    '0901000006', 'Họp mặt bạn cũ',      8, 'confirmed'),
    ('A1',  -1, '12:00', '13:30', 'Đỗ Văn Em',        '0901000007', null,                  4, 'completed'),
    ('A2',   0, '19:00', '20:30', 'Vũ Thị Giang',     '0901000008', null,                  3, 'cancelled')
  ) as t(tbl, plus_day, st, en, cust, phone, ev, party, stat)
  loop
    insert into public.bookings (status, is_demo, consultant_id, event_name, customer_name, customer_phone,
        start_at, end_at, booked_at, party_size, created_by, updated_by, deposit_amount,
        cancel_reason)
      values (r.stat::public.booking_status, true, v_by, r.ev, r.cust, r.phone,
        ((v_day + r.plus_day)::text || ' ' || r.st)::timestamp at time zone 'Asia/Ho_Chi_Minh',
        ((v_day + r.plus_day)::text || ' ' || r.en)::timestamp at time zone 'Asia/Ho_Chi_Minh',
        now(), r.party, v_by, v_by, case when r.party >= 10 then 2000000 end,
        case when r.stat = 'cancelled' then 'Khách báo bận (demo)' end)
      returning id into v_id;
    insert into public.booking_tables (booking_id, table_id)
      select v_id, id from public.dining_tables where code = r.tbl;
    if r.party >= 10 then
      insert into public.booking_items (booking_id, name, qty, sort_order) values (v_id, 'Lẩu hải sản', 3, 1), (v_id, 'Gà quay', 2, 2);
    end if;
  end loop;
end $$;
