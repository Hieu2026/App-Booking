-- Xóa toàn bộ dữ liệu demo (chỉ các lượt đặt có is_demo = true). Dữ liệu thật không bị ảnh hưởng.
-- Bàn đang ở trạng thái "đang phục vụ" do demo (nếu có) được trả về "sẵn sàng".
update public.dining_tables set ops_status = 'ready', serving_booking_id = null
 where serving_booking_id in (select id from public.bookings where is_demo);
delete from public.bookings where is_demo;   -- kéo theo bàn gắn và món yêu cầu của các lượt demo
