-- Migration 0004: phân quyền (RLS), cấp quyền hàm, realtime

-- ---- thu hồi mọi quyền mặc định, chỉ cấp lại những gì cần
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema public, private, extensions to authenticated;
revoke usage on schema private from anon;

-- Chỉ ĐỌC trực tiếp bảng (cần cho Realtime); mọi thao tác ghi đi qua hàm RPC bên dưới.
grant select on public.profiles, public.app_settings, public.floors, public.dining_tables,
                public.lookups, public.bookings, public.booking_items, public.booking_tables,
                public.audit_log to authenticated;

-- Hàm tiện ích dùng trong chính sách RLS và hàm đọc
grant execute on function private.is_staff(), private.is_manager(), private.require_staff(),
  private.require_manager(), private.fail(text, jsonb), private.invalid(text, text),
  private.booking_json(public.bookings), private.tz() to authenticated;

-- Hàm API (chỉ người đã đăng nhập; bên trong còn kiểm tra nhân viên còn hoạt động / quản lý)
grant execute on function
  public.get_context(), public.get_board(date), public.get_booking(uuid), public.get_booking_history(uuid),
  public.get_availability(timestamptz, timestamptz, uuid),
  public.search_bookings(jsonb, text, text, int, int),
  public.get_audit_log(jsonb, int, int), public.get_profiles(),
  public.create_booking(uuid, jsonb, uuid[], jsonb, text, boolean),
  public.update_booking(uuid, uuid, int, jsonb, uuid[], jsonb, text),
  public.move_booking_table(uuid, uuid, int, uuid, uuid, text),
  public.set_booking_status(uuid, uuid, int, text, text),
  public.set_table_status(uuid, text, text),
  public.admin_save_table(uuid, text, text, int, boolean, text, int),
  public.admin_save_lookup(uuid, text, text, boolean, int),
  public.admin_save_settings(time, time, int, int),
  public.admin_set_profile(uuid, text, public.user_role, boolean)
to authenticated;

-- ---- RLS
alter table public.profiles          enable row level security;
alter table public.app_settings      enable row level security;
alter table public.floors            enable row level security;
alter table public.dining_tables     enable row level security;
alter table public.lookups           enable row level security;
alter table public.bookings          enable row level security;
alter table public.booking_items     enable row level security;
alter table public.booking_tables    enable row level security;
alter table public.audit_log         enable row level security;
alter table public.idempotency_keys  enable row level security;
-- Không bật FORCE: chủ sở hữu (hàm SECURITY DEFINER) ghi được; API không có quyền ghi trực tiếp.

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_staff());
create policy settings_select on public.app_settings for select to authenticated using (private.is_staff());
create policy floors_select   on public.floors for select to authenticated using (private.is_staff());
create policy tables_select   on public.dining_tables for select to authenticated using (private.is_staff());
create policy lookups_select  on public.lookups for select to authenticated using (private.is_staff());
create policy bookings_select on public.bookings for select to authenticated using (private.is_staff());
create policy items_select    on public.booking_items for select to authenticated using (private.is_staff());
create policy bt_select       on public.booking_tables for select to authenticated using (private.is_staff());
-- Nhật ký: quản lý xem tất cả; lễ tân chỉ xem lịch sử của lượt đặt.
create policy audit_select    on public.audit_log for select to authenticated
  using (private.is_manager() or (private.is_staff() and entity = 'booking'));
-- idempotency_keys: không có chính sách nào → không ai (qua API) đọc/ghi được.

-- ---- Realtime (Supabase): chỉ phát những bảng cần; RLS vẫn áp dụng cho kênh realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bookings, public.booking_tables,
      public.dining_tables, public.booking_items;
  end if;
end $$;
