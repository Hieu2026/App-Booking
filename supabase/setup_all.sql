-- GỘP SẴN để dán một lần vào Supabase SQL Editor: 4 migration (theo thứ tự) + seed. Chỉ chạy MỘT lần trên dự án mới.
-- Được tạo tự động từ các file trong supabase/migrations và seed.sql; nếu sửa migration, tạo lại file này.

-- ================= migrations/0001_schema.sql =================
-- Khoái — Quản lý bàn & đặt tiệc
-- Migration 0001: cấu trúc dữ liệu
-- Chạy lại nhiều lần an toàn khi dùng qua công cụ migration (mỗi file chỉ chạy một lần).

create schema if not exists extensions;
create schema if not exists private;
create extension if not exists btree_gist with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- kiểu dữ liệu
create type public.user_role as enum ('receptionist', 'manager');
create type public.booking_status as enum
  ('pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show');
create type public.table_ops_status as enum ('ready', 'serving', 'cleaning', 'suspended');

-- ---------------------------------------------------------------- tài khoản nhân viên
-- Chỉ người có dòng ở đây (và active = true) mới truy cập được dữ liệu nghiệp vụ.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (btrim(full_name) <> ''),
  email       text,
  role        public.user_role not null default 'receptionist',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- cấu hình (1 dòng)
create table public.app_settings (
  id                        int primary key default 1 check (id = 1),
  open_time                 time not null default '10:00',
  close_time                time not null default '22:00',
  -- Khoảng đệm dọn bàn sau mỗi lượt (phút). Đề xuất mặc định: 0.
  buffer_minutes            int  not null default 0 check (buffer_minutes between 0 and 240),
  -- Thời lượng gợi ý khi tạo lượt đặt mới (phút). Đề xuất: 120.
  default_duration_minutes  int  not null default 120 check (default_duration_minutes between 15 and 720),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------- khu vực & bàn
create table public.floors (
  code        text primary key,
  name        text not null,
  sort_order  int  not null default 0
);

create table public.dining_tables (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code = btrim(code) and code <> ''),
  floor_code          text not null references public.floors (code),
  capacity            int  not null check (capacity > 0),
  ops_status          public.table_ops_status not null default 'ready',
  serving_booking_id  uuid,
  sort_order          int  not null default 0,
  active              boolean not null default true,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index dining_tables_floor_idx on public.dining_tables (floor_code, sort_order);

-- ---------------------------------------------------------------- danh mục cấu hình được
create table public.lookups (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('source', 'purpose', 'deposit_method')),
  label       text not null check (btrim(label) <> ''),
  active      boolean not null default true,
  sort_order  int not null default 0,
  unique (kind, label)
);

-- ---------------------------------------------------------------- lượt đặt
create sequence public.booking_code_seq start 1;

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique
                        default ('KH-' || lpad(nextval('public.booking_code_seq')::text, 5, '0')),
  status              public.booking_status not null default 'pending',
  is_walk_in          boolean not null default false,
  is_demo             boolean not null default false,

  consultant_id       uuid references public.profiles (id),
  event_name          text,
  customer_name       text,
  customer_phone      text,
  source_id           uuid references public.lookups (id),
  purpose_id          uuid references public.lookups (id),

  start_at            timestamptz not null,
  end_at              timestamptz not null,
  booked_at           timestamptz,           -- thời điểm KHÁCH đặt (khác created_at)
  party_size          int  not null check (party_size >= 1),   -- tổng người, đã gồm trẻ em
  children_count      int  not null default 0 check (children_count >= 0),
  decoration          text,
  special_requests    text,

  deposit_amount      numeric(14, 0) check (deposit_amount is null or deposit_amount >= 0), -- VND
  deposit_method_id   uuid references public.lookups (id),
  deposit_date        date,
  contract_code       text,                  -- "Mã HĐ": giữ nguyên tên trường

  cancel_reason       text,
  change_note         text,
  override_reason     text,                  -- lý do quản lý ghi đè cảnh báo

  version             int  not null default 1,
  client_request_id   uuid,
  created_at          timestamptz not null default now(),   -- thời điểm nhập vào hệ thống
  created_by          uuid references public.profiles (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id),

  check (end_at > start_at),
  check (children_count <= party_size)
);
create index bookings_start_idx on public.bookings (start_at);
create index bookings_booked_idx on public.bookings (booked_at);
create index bookings_status_idx on public.bookings (status);
create index bookings_phone_idx on public.bookings (customer_phone);

alter table public.dining_tables
  add constraint dining_tables_serving_fk
  foreign key (serving_booking_id) references public.bookings (id);

create table public.booking_items (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  qty         int  not null check (qty > 0),
  note        text,
  sort_order  int  not null default 0
);
create index booking_items_booking_idx on public.booking_items (booking_id);

-- Bàn gắn với lượt đặt. "during" và "holds" do trigger tự điền để chống trùng lịch
-- ngay trong cơ sở dữ liệu: một bàn không thể có hai lượt giữ chỗ giao nhau.
create table public.booking_tables (
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  table_id    uuid not null references public.dining_tables (id),
  during      tstzrange not null,
  holds       boolean not null default true,
  primary key (booking_id, table_id),
  constraint booking_tables_no_overlap
    exclude using gist (table_id with =, during with &&) where (holds)
);
create index booking_tables_table_idx on public.booking_tables (table_id);

-- ---------------------------------------------------------------- nhật ký (chỉ ghi thêm)
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  entity      text not null,
  entity_id   text,
  booking_id  uuid,
  action      text not null,
  summary     text,
  changes     jsonb
);
create index audit_log_booking_idx on public.audit_log (booking_id, at);
create index audit_log_at_idx on public.audit_log (at desc);

-- ---------------------------------------------------------------- chống gửi lặp
create table public.idempotency_keys (
  key         uuid primary key,
  actor_id    uuid not null,
  result      jsonb,
  created_at  timestamptz not null default now()
);
create index idempotency_keys_created_idx on public.idempotency_keys (created_at);

-- ================= migrations/0002_logic.sql =================
-- Migration 0002: hàm hỗ trợ, trigger và các thao tác ghi dữ liệu (RPC)
-- Mọi thao tác ghi nghiệp vụ đi qua các hàm này: kiểm tra quyền, chống trùng lịch,
-- kiểm soát phiên bản, chống gửi lặp và ghi nhật ký đều nằm trong CÙNG một giao dịch.

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- tiện ích
create function private.tz() returns text language sql immutable as $$ select 'Asia/Ho_Chi_Minh'::text $$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

create function private.is_manager() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.active and p.role = 'manager')
$$;

-- Ném lỗi nghiệp vụ: message = mã lỗi, detail = JSON mô tả thêm.
create function private.fail(p_code text, p_detail jsonb default null) returns void
language plpgsql as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail::text, '');
end $$;

create function private.invalid(p_field text, p_message text) returns void
language plpgsql as $$
begin
  perform private.fail('E_VALIDATION', jsonb_build_object('field', p_field, 'message', p_message));
end $$;

create function private.require_staff() returns void language plpgsql stable as $$
begin
  if auth.uid() is null or not private.is_staff() then perform private.fail('E_FORBIDDEN'); end if;
end $$;

create function private.require_manager() returns void language plpgsql stable as $$
begin
  if auth.uid() is null or not private.is_manager() then
    perform private.fail('E_FORBIDDEN', jsonb_build_object('message', 'Chỉ quản lý được thực hiện thao tác này.'));
  end if;
end $$;

create function private.jsonb_diff(a jsonb, b jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', a -> k, 'to', b -> k)), '{}'::jsonb)
  from jsonb_object_keys(coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb)) as k
  where a -> k is distinct from b -> k
$$;

create function private.audit(p_entity text, p_entity_id text, p_booking uuid,
                              p_action text, p_summary text, p_changes jsonb default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log (actor_id, actor_name, entity, entity_id, booking_id, action, summary, changes)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()),
          p_entity, p_entity_id, p_booking, p_action, p_summary, p_changes)
$$;

-- Nhật ký chỉ được ghi thêm, kể cả với chủ sở hữu hàm.
create function private.audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Nhật ký không được sửa hoặc xóa.' using errcode = 'P0001';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_immutable();

-- Ảnh chụp nghiệp vụ của lượt đặt (để so sánh trước/sau trong nhật ký)
create function private.booking_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'Trạng thái', b.status,
    'Nhân viên tư vấn', (select full_name from profiles where id = b.consultant_id),
    'Tên tiệc / bàn', b.event_name,
    'Tên khách', b.customer_name,
    'Số điện thoại', b.customer_phone,
    'Nguồn khách', (select label from lookups where id = b.source_id),
    'Bắt đầu', to_char(b.start_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI'),
    'Kết thúc', to_char(b.end_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI'),
    'Ngày giờ khách đặt', to_char(b.booked_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI'),
    'Số khách', b.party_size,
    'Số trẻ em', b.children_count,
    'Mục đích tiệc', (select label from lookups where id = b.purpose_id),
    'Trang trí', b.decoration,
    'Yêu cầu riêng', b.special_requests,
    'Tiền cọc (VND)', b.deposit_amount,
    'Phương thức cọc', (select label from lookups where id = b.deposit_method_id),
    'Ngày cọc', b.deposit_date,
    'Mã HĐ', b.contract_code,
    'Lý do hủy', b.cancel_reason,
    'Bàn', coalesce((select jsonb_agg(t.code order by t.sort_order, t.code)
                     from booking_tables bt join dining_tables t on t.id = bt.table_id
                     where bt.booking_id = b.id), '[]'::jsonb),
    'Món yêu cầu', coalesce((select jsonb_agg(i.name || ' × ' || i.qty
                                               || coalesce(' (' || nullif(i.note, '') || ')', '')
                                               order by i.sort_order)
                             from booking_items i where i.booking_id = b.id), '[]'::jsonb)
  )
  from bookings b where b.id = p_id
$$;

-- ---------------------------------------------------------------- trigger chống trùng lịch
-- Điền khoảng chiếm chỗ (có khoảng đệm dọn bàn) và cờ giữ chỗ cho dòng bàn mới.
create function private.bt_fill() returns trigger language plpgsql as $$
declare v_buf int;
begin
  select buffer_minutes into v_buf from public.app_settings where id = 1;
  select tstzrange(b.start_at, b.end_at + make_interval(mins => coalesce(v_buf, 0)), '[)'),
         b.status in ('pending', 'confirmed', 'arrived')
    into new.during, new.holds
    from public.bookings b where b.id = new.booking_id;
  return new;
end $$;
create trigger booking_tables_fill before insert on public.booking_tables
  for each row execute function private.bt_fill();

-- Khi đổi giờ / đổi trạng thái lượt đặt, đồng bộ lại các dòng bàn.
create function private.bookings_sync() returns trigger language plpgsql as $$
declare v_buf int;
begin
  select buffer_minutes into v_buf from public.app_settings where id = 1;
  update public.booking_tables bt
     set during = tstzrange(new.start_at, new.end_at + make_interval(mins => coalesce(v_buf, 0)), '[)'),
         holds  = new.status in ('pending', 'confirmed', 'arrived')
   where bt.booking_id = new.id;
  return null;
end $$;
create trigger bookings_sync after update of status, start_at, end_at on public.bookings
  for each row when (old.status is distinct from new.status
                     or old.start_at is distinct from new.start_at
                     or old.end_at is distinct from new.end_at)
  execute function private.bookings_sync();

-- ---------------------------------------------------------------- chống gửi lặp
create function private.idem_begin(p_key uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.idempotency_keys;
begin
  if p_key is null then return null; end if;
  delete from public.idempotency_keys where created_at < now() - interval '3 days';
  -- Nếu cùng khóa đang được xử lý ở phiên khác, lệnh này chờ phiên đó xong.
  insert into public.idempotency_keys (key, actor_id) values (p_key, auth.uid())
    on conflict (key) do nothing;
  select * into r from public.idempotency_keys where key = p_key;
  if r.actor_id <> auth.uid() then
    perform private.fail('E_VALIDATION', jsonb_build_object('message', 'Yêu cầu không hợp lệ.'));
  end if;
  return r.result;
end $$;

create function private.idem_end(p_key uuid, p_result jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.idempotency_keys set result = p_result where key = p_key
$$;

-- ---------------------------------------------------------------- bắt đầu phục vụ
create function private.start_serving(p_booking uuid, p_tables uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t record;
begin
  for t in select dt.*, (select code from bookings where id = dt.serving_booking_id) as serving_code
             from dining_tables dt where dt.id = any(p_tables) order by dt.id for update loop
    if t.ops_status = 'serving' and t.serving_booking_id = p_booking then continue; end if;
    if t.ops_status <> 'ready' then
      perform private.fail('E_TABLE_BUSY', jsonb_build_object(
        'table', t.code, 'ops_status', t.ops_status, 'serving_booking', t.serving_code));
    end if;
    update dining_tables set ops_status = 'serving', serving_booking_id = p_booking, updated_at = now()
      where id = t.id;
  end loop;
end $$;

-- ---------------------------------------------------------------- tạo / sửa lượt đặt
-- p_data: các trường lượt đặt. Khi sửa, trường không có trong p_data giữ nguyên.
-- p_tables / p_items: null = giữ nguyên.
create function private.save_booking(
  p_id uuid, p_expected int, p_data jsonb, p_tables uuid[], p_items jsonb,
  p_override text, p_walk_in boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_new       boolean := p_id is null;
  v_id        uuid := coalesce(p_id, gen_random_uuid());
  b           public.bookings;
  s           public.app_settings;
  d           jsonb;
  v_before    jsonb;
  v_old_tabs  uuid[];
  v_tabs      uuid[];
  v_start     timestamptz;
  v_end       timestamptz;
  v_party     int;
  v_kids      int;
  v_name      text;
  v_phone     text;
  v_status    public.booking_status;
  v_cap       int;
  v_warn      jsonb := '[]'::jsonb;
  v_susp      text[];
  v_changed   boolean;
  v_override  text;
  v_conf      jsonb;
  v_item      jsonb;
  v_n         int := 0;
  v_qty       int;
  v_deposit   numeric;
  v_walk      boolean;
begin
  perform private.require_staff();
  select * into s from app_settings where id = 1;

  if v_new then
    d := coalesce(p_data, '{}'::jsonb);
    v_walk := p_walk_in;
    v_old_tabs := '{}';
  else
    select * into b from bookings where id = p_id for update;
    if not found then perform private.fail('E_NOT_FOUND'); end if;
    if b.version <> p_expected then
      perform private.fail('E_VERSION', jsonb_build_object(
        'current_version', b.version, 'updated_at', b.updated_at,
        'updated_by', (select full_name from profiles where id = b.updated_by)));
    end if;
    if b.status in ('completed', 'cancelled', 'no_show') then
      perform private.fail('E_FINAL', jsonb_build_object('status', b.status));
    end if;
    v_before := private.booking_snapshot(p_id);
    select coalesce(array_agg(table_id), '{}') into v_old_tabs from booking_tables where booking_id = p_id;
    d := (to_jsonb(b) - 'id' - 'code' - 'version' - 'created_at' - 'created_by' - 'status')
         || coalesce(p_data, '{}'::jsonb);
    v_walk := b.is_walk_in;
  end if;

  -- ---- đọc & kiểm tra dữ liệu
  v_start := nullif(d ->> 'start_at', '')::timestamptz;
  v_end   := nullif(d ->> 'end_at', '')::timestamptz;
  if v_start is null then perform private.invalid('start_at', 'Chọn ngày giờ bắt đầu.'); end if;
  if v_end is null then perform private.invalid('end_at', 'Chọn giờ kết thúc dự kiến.'); end if;
  if v_end <= v_start then perform private.invalid('end_at', 'Giờ kết thúc phải sau giờ bắt đầu.'); end if;

  v_party := nullif(d ->> 'party_size', '')::int;
  if v_party is null or v_party < 1 then perform private.invalid('party_size', 'Số lượng khách phải từ 1 trở lên.'); end if;
  v_kids := coalesce(nullif(d ->> 'children_count', '')::int, 0);
  if v_kids < 0 or v_kids > v_party then
    perform private.invalid('children_count', 'Số trẻ em không được lớn hơn tổng số khách.');
  end if;

  v_name  := nullif(btrim(d ->> 'customer_name'), '');
  v_phone := nullif(regexp_replace(coalesce(d ->> 'customer_phone', ''), '[\s.\-()]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then
    perform private.invalid('customer_phone', 'Số điện thoại không hợp lệ (8–15 chữ số).');
  end if;
  if not v_walk then
    if v_name is null then perform private.invalid('customer_name', 'Nhập tên khách đặt.'); end if;
    if v_phone is null then perform private.invalid('customer_phone', 'Nhập số điện thoại liên hệ của khách.'); end if;
  end if;

  v_deposit := nullif(d ->> 'deposit_amount', '')::numeric;
  if v_deposit is not null and (v_deposit < 0 or v_deposit <> trunc(v_deposit)) then
    perform private.invalid('deposit_amount', 'Số tiền cọc phải là số nguyên VND, không âm.');
  end if;

  if p_tables is null then v_tabs := v_old_tabs;
  else select coalesce(array_agg(distinct x), '{}') into v_tabs from unnest(p_tables) x; end if;
  if cardinality(v_tabs) = 0 then perform private.invalid('tables', 'Chọn ít nhất một bàn.'); end if;
  if (select count(*) from dining_tables where id = any(v_tabs) and (active or id = any(v_old_tabs)))
       <> cardinality(v_tabs) then
    perform private.invalid('tables', 'Có bàn không tồn tại hoặc đã ngưng dùng trong danh mục.');
  end if;

  select array_agg(code order by code) into v_susp from dining_tables
   where id = any(v_tabs) and ops_status = 'suspended' and not (id = any(v_old_tabs));
  if v_susp is not null then
    perform private.fail('E_TABLE_SUSPENDED', jsonb_build_object('tables', to_jsonb(v_susp)));
  end if;

  -- ---- cảnh báo (chỉ khi thời gian / bàn / số khách thay đổi hoặc tạo mới)
  if v_new then
    v_changed := true;
  else
    v_changed := v_start <> b.start_at or v_end <> b.end_at or v_party <> b.party_size
      or not (v_tabs @> v_old_tabs and v_old_tabs @> v_tabs);
  end if;
  if v_changed then
    select sum(capacity) into v_cap from dining_tables where id = any(v_tabs);
    if v_party > v_cap then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('type', 'capacity',
        'message', format('Số khách (%s) vượt tổng sức chứa của các bàn đã chọn (%s).', v_party, v_cap)));
    end if;
    if (v_start at time zone private.tz())::time < s.open_time
       or (v_end at time zone private.tz())::time > s.close_time
       or (v_start at time zone private.tz())::date <> (v_end at time zone private.tz())::date then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('type', 'hours',
        'message', format('Lịch nằm ngoài giờ mở cửa (%s–%s).',
                          to_char(s.open_time, 'HH24:MI'), to_char(s.close_time, 'HH24:MI'))));
    end if;
    if jsonb_array_length(v_warn) > 0 then
      if private.is_manager() and nullif(btrim(p_override), '') is not null then
        v_override := btrim(p_override);
      else
        perform private.fail('E_WARNING', jsonb_build_object(
          'warnings', v_warn, 'can_override', private.is_manager()));
      end if;
    end if;
  end if;

  -- ---- ghi dữ liệu (ràng buộc loại trừ ở bảng booking_tables chặn trùng lịch)
  begin
    if v_new then
      v_status := case when v_walk then 'arrived'
                       when d ->> 'status' = 'confirmed' then 'confirmed' else 'pending' end;
      insert into bookings (
        id, status, is_walk_in, consultant_id, event_name, customer_name, customer_phone,
        source_id, purpose_id, start_at, end_at, booked_at, party_size, children_count,
        decoration, special_requests, deposit_amount, deposit_method_id, deposit_date,
        contract_code, change_note, override_reason, created_by, updated_by)
      values (
        v_id, v_status, v_walk,
        coalesce(nullif(d ->> 'consultant_id', '')::uuid, auth.uid()),
        nullif(btrim(d ->> 'event_name'), ''), v_name, v_phone,
        nullif(d ->> 'source_id', '')::uuid, nullif(d ->> 'purpose_id', '')::uuid,
        v_start, v_end, nullif(d ->> 'booked_at', '')::timestamptz, v_party, v_kids,
        nullif(btrim(d ->> 'decoration'), ''), nullif(btrim(d ->> 'special_requests'), ''),
        v_deposit, nullif(d ->> 'deposit_method_id', '')::uuid, nullif(d ->> 'deposit_date', '')::date,
        nullif(btrim(d ->> 'contract_code'), ''), nullif(btrim(d ->> 'change_note'), ''),
        v_override, auth.uid(), auth.uid());
    else
      delete from booking_tables where booking_id = v_id and not (table_id = any(v_tabs));
      update bookings set
        consultant_id = nullif(d ->> 'consultant_id', '')::uuid,
        event_name = nullif(btrim(d ->> 'event_name'), ''),
        customer_name = v_name, customer_phone = v_phone,
        source_id = nullif(d ->> 'source_id', '')::uuid,
        purpose_id = nullif(d ->> 'purpose_id', '')::uuid,
        start_at = v_start, end_at = v_end,
        booked_at = nullif(d ->> 'booked_at', '')::timestamptz,
        party_size = v_party, children_count = v_kids,
        decoration = nullif(btrim(d ->> 'decoration'), ''),
        special_requests = nullif(btrim(d ->> 'special_requests'), ''),
        deposit_amount = v_deposit,
        deposit_method_id = nullif(d ->> 'deposit_method_id', '')::uuid,
        deposit_date = nullif(d ->> 'deposit_date', '')::date,
        contract_code = nullif(btrim(d ->> 'contract_code'), ''),
        change_note = nullif(btrim(d ->> 'change_note'), ''),
        override_reason = coalesce(v_override, override_reason),
        version = version + 1, updated_at = now(), updated_by = auth.uid()
      where id = v_id;
    end if;

    insert into booking_tables (booking_id, table_id)
      select v_id, x from unnest(v_tabs) x
      where not (x = any(v_old_tabs));
  exception when exclusion_violation then
    select jsonb_agg(jsonb_build_object(
             'table', t.code, 'booking_code', ob.code, 'customer', ob.customer_name,
             'event_name', ob.event_name, 'status', ob.status,
             'start_at', ob.start_at, 'end_at', ob.end_at))
      into v_conf
      from booking_tables ot
      join bookings ob on ob.id = ot.booking_id
      join dining_tables t on t.id = ot.table_id
     where ot.holds and ot.table_id = any(v_tabs) and ot.booking_id <> v_id
       and ot.during && tstzrange(v_start, v_end + make_interval(mins => s.buffer_minutes), '[)');
    perform private.fail('E_OVERLAP', jsonb_build_object('conflicts', coalesce(v_conf, '[]'::jsonb)));
  end;

  -- ---- món yêu cầu
  if p_items is not null then
    delete from booking_items where booking_id = v_id;
    for v_item in select * from jsonb_array_elements(p_items) loop
      if nullif(btrim(v_item ->> 'name'), '') is null then continue; end if;
      v_qty := coalesce(nullif(v_item ->> 'qty', '')::int, 0);
      if v_qty < 1 then perform private.invalid('items', 'Số phần của mỗi món phải từ 1 trở lên.'); end if;
      v_n := v_n + 1;
      insert into booking_items (booking_id, name, qty, note, sort_order)
        values (v_id, btrim(v_item ->> 'name'), v_qty, nullif(btrim(v_item ->> 'note'), ''), v_n);
    end loop;
  end if;

  -- ---- trạng thái bàn khi lượt đặt đang phục vụ
  if v_new and v_walk then
    perform private.start_serving(v_id, v_tabs);
  elsif not v_new and b.status = 'arrived' then
    update dining_tables set ops_status = 'cleaning', serving_booking_id = null, updated_at = now()
     where serving_booking_id = v_id and not (id = any(v_tabs));
    perform private.start_serving(v_id, v_tabs);
  end if;

  -- ---- nhật ký
  if v_new then
    perform private.audit('booking', v_id::text, v_id, 'create',
      case when v_walk then 'Tiếp nhận khách vãng lai' else 'Tạo lượt đặt' end,
      jsonb_build_object('snapshot', private.booking_snapshot(v_id), 'override_reason', v_override));
  else
    perform private.audit('booking', v_id::text, v_id,
      case when v_start <> b.start_at or v_end <> b.end_at then 'reschedule'
           when not (v_tabs @> v_old_tabs and v_old_tabs @> v_tabs) then 'change_tables'
           else 'update' end,
      'Sửa lượt đặt',
      jsonb_build_object('diff', private.jsonb_diff(v_before, private.booking_snapshot(v_id)),
                         'override_reason', v_override));
  end if;

  select * into b from bookings where id = v_id;
  return jsonb_build_object('id', b.id, 'code', b.code, 'version', b.version, 'status', b.status);
end $$;

-- ---------------------------------------------------------------- RPC công khai (cho người đã đăng nhập)
create function public.create_booking(
  p_request_id uuid, p_data jsonb, p_tables uuid[],
  p_items jsonb default '[]'::jsonb, p_override_reason text default null,
  p_walk_in boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v jsonb;
begin
  perform private.require_staff();
  v := private.idem_begin(p_request_id);
  if v is not null then return v; end if;
  v := private.save_booking(null, null, p_data, p_tables, p_items, p_override_reason, p_walk_in);
  perform private.idem_end(p_request_id, v);
  return v;
end $$;

create function public.update_booking(
  p_request_id uuid, p_id uuid, p_expected_version int, p_data jsonb, p_tables uuid[] default null,
  p_items jsonb default null, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v jsonb;
begin
  perform private.require_staff();
  v := private.idem_begin(p_request_id);
  if v is not null then return v; end if;
  v := private.save_booking(p_id, p_expected_version, p_data, p_tables, p_items, p_override_reason);
  perform private.idem_end(p_request_id, v);
  return v;
end $$;

-- Chuyển bàn: thay một bàn bằng bàn khác (nguyên tử, kiểm tra trùng lịch lại).
create function public.move_booking_table(
  p_request_id uuid, p_id uuid, p_expected_version int,
  p_from uuid, p_to uuid, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v jsonb; v_tabs uuid[];
begin
  perform private.require_staff();
  v := private.idem_begin(p_request_id);
  if v is not null then return v; end if;
  select array_agg(case when table_id = p_from then p_to else table_id end) into v_tabs
    from booking_tables where booking_id = p_id;
  if v_tabs is null or not exists (select 1 from booking_tables where booking_id = p_id and table_id = p_from) then
    perform private.invalid('tables', 'Bàn cần chuyển không thuộc lượt đặt này.');
  end if;
  v := private.save_booking(p_id, p_expected_version, '{}'::jsonb, v_tabs, null, p_override_reason);
  perform private.idem_end(p_request_id, v);
  return v;
end $$;

-- Đổi trạng thái: confirm | check_in | complete | cancel | no_show
create function public.set_booking_status(
  p_request_id uuid, p_id uuid, p_expected_version int, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v jsonb; b public.bookings; v_new public.booking_status; v_before jsonb; v_tabs uuid[];
  v_label text;
begin
  perform private.require_staff();
  v := private.idem_begin(p_request_id);
  if v is not null then return v; end if;

  select * into b from bookings where id = p_id for update;
  if not found then perform private.fail('E_NOT_FOUND'); end if;
  if b.version <> p_expected_version then
    perform private.fail('E_VERSION', jsonb_build_object(
      'current_version', b.version, 'updated_at', b.updated_at,
      'updated_by', (select full_name from profiles where id = b.updated_by)));
  end if;

  v_new := case p_action
    when 'confirm'  then 'confirmed'
    when 'check_in' then 'arrived'
    when 'complete' then 'completed'
    when 'cancel'   then 'cancelled'
    when 'no_show'  then 'no_show' end;
  if v_new is null then perform private.invalid('action', 'Thao tác không hợp lệ.'); end if;

  if not (
       (p_action = 'confirm'  and b.status = 'pending')
    or (p_action = 'check_in' and b.status in ('pending', 'confirmed'))
    or (p_action = 'complete' and b.status = 'arrived')
    or (p_action = 'cancel'   and b.status in ('pending', 'confirmed'))
    or (p_action = 'no_show'  and b.status in ('pending', 'confirmed'))) then
    perform private.fail('E_TRANSITION', jsonb_build_object('status', b.status, 'action', p_action));
  end if;
  if p_action = 'cancel' and nullif(btrim(p_reason), '') is null then
    perform private.invalid('reason', 'Nhập lý do hủy.');
  end if;

  v_before := private.booking_snapshot(p_id);
  select coalesce(array_agg(table_id), '{}') into v_tabs from booking_tables where booking_id = p_id;

  if p_action = 'check_in' then
    -- Có bàn tạm ngưng thì không bắt đầu phục vụ được.
    perform 1 from dining_tables where id = any(v_tabs) and ops_status = 'suspended';
    if found then
      perform private.fail('E_TABLE_SUSPENDED', jsonb_build_object('tables',
        (select to_jsonb(array_agg(code)) from dining_tables where id = any(v_tabs) and ops_status = 'suspended')));
    end if;
    perform private.start_serving(p_id, v_tabs);
  elsif p_action = 'complete' then
    update dining_tables set ops_status = 'cleaning', serving_booking_id = null, updated_at = now()
     where serving_booking_id = p_id;
  end if;

  update bookings set status = v_new, version = version + 1, updated_at = now(), updated_by = auth.uid(),
         cancel_reason = case when p_action = 'cancel' then btrim(p_reason)
                              when p_action = 'no_show' then coalesce(nullif(btrim(p_reason), ''), cancel_reason)
                              else cancel_reason end
   where id = p_id returning * into b;

  v_label := case p_action when 'confirm' then 'Xác nhận lượt đặt' when 'check_in' then 'Khách đến — bắt đầu phục vụ'
    when 'complete' then 'Hoàn tất phục vụ' when 'cancel' then 'Hủy lượt đặt' else 'Khách không đến' end;
  perform private.audit('booking', p_id::text, p_id, p_action, v_label,
    jsonb_build_object('diff', private.jsonb_diff(v_before, private.booking_snapshot(p_id)),
                       'reason', nullif(btrim(p_reason), '')));

  v := jsonb_build_object('id', b.id, 'code', b.code, 'version', b.version, 'status', b.status);
  perform private.idem_end(p_request_id, v);
  return v;
end $$;

-- Vận hành bàn: ready (xác nhận sẵn sàng / mở lại) | suspended (tạm ngưng)
create function public.set_table_status(p_table_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t public.dining_tables; v_upcoming int;
begin
  perform private.require_staff();
  select * into t from dining_tables where id = p_table_id for update;
  if not found then perform private.fail('E_NOT_FOUND'); end if;

  if p_status = 'ready' then
    if t.ops_status not in ('cleaning', 'suspended') then
      perform private.fail('E_TRANSITION', jsonb_build_object('ops_status', t.ops_status));
    end if;
  elsif p_status = 'suspended' then
    if t.ops_status = 'serving' then
      perform private.fail('E_TABLE_BUSY', jsonb_build_object('table', t.code, 'ops_status', t.ops_status));
    end if;
    if t.ops_status = 'suspended' then perform private.fail('E_TRANSITION', jsonb_build_object('ops_status', t.ops_status)); end if;
  else
    perform private.invalid('status', 'Trạng thái không hợp lệ.');
  end if;

  update dining_tables set ops_status = p_status::public.table_ops_status,
         serving_booking_id = null, updated_at = now() where id = t.id;

  select count(*) into v_upcoming from booking_tables bt
   where bt.table_id = t.id and bt.holds and upper(bt.during) > now();

  perform private.audit('table', t.id::text, null,
    case p_status when 'ready' then 'table_ready' else 'table_suspend' end,
    format('Bàn %s: %s', t.code, case p_status when 'ready' then 'sẵn sàng' else 'tạm ngưng' end),
    jsonb_build_object('from', t.ops_status, 'to', p_status, 'note', nullif(btrim(p_note), '')));

  return jsonb_build_object('id', t.id, 'code', t.code, 'ops_status', p_status, 'upcoming_bookings', v_upcoming);
end $$;

-- ---------------------------------------------------------------- quản lý (chỉ vai trò quản lý)
create function public.admin_save_table(
  p_id uuid, p_code text, p_floor_code text, p_capacity int,
  p_active boolean default true, p_note text default null, p_sort_order int default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t public.dining_tables; v_code text := btrim(coalesce(p_code, '')); v_up int;
begin
  perform private.require_manager();
  if v_code = '' then perform private.invalid('code', 'Nhập mã bàn.'); end if;
  if p_capacity is null or p_capacity < 1 then perform private.invalid('capacity', 'Sức chứa phải từ 1 trở lên.'); end if;
  if not exists (select 1 from floors where code = p_floor_code) then perform private.invalid('floor_code', 'Chọn tầng/khu.'); end if;
  if exists (select 1 from dining_tables where code = v_code and id is distinct from p_id) then
    perform private.invalid('code', 'Mã bàn này đã tồn tại.');
  end if;
  if p_id is null then
    insert into dining_tables (code, floor_code, capacity, active, note, sort_order)
      values (v_code, p_floor_code, p_capacity, coalesce(p_active, true), nullif(btrim(p_note), ''),
              coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 1 from dining_tables)))
      returning * into t;
    perform private.audit('table', t.id::text, null, 'table_create', 'Thêm bàn ' || t.code,
      to_jsonb(t) - 'id');
  else
    if not coalesce(p_active, true) then
      select count(*) into v_up from booking_tables bt where bt.table_id = p_id and bt.holds and upper(bt.during) > now();
      if v_up > 0 then
        perform private.invalid('active', format('Bàn còn %s lượt đặt sắp tới, hãy chuyển bàn trước khi ngưng dùng.', v_up));
      end if;
    end if;
    select * into t from dining_tables where id = p_id for update;
    if not found then perform private.fail('E_NOT_FOUND'); end if;
    perform private.audit('table', t.id::text, null, 'table_update', 'Sửa bàn ' || t.code,
      private.jsonb_diff(to_jsonb(t) - 'id' - 'updated_at',
        jsonb_build_object('code', v_code, 'floor_code', p_floor_code, 'capacity', p_capacity,
          'active', coalesce(p_active, true), 'note', nullif(btrim(p_note), ''),
          'sort_order', coalesce(p_sort_order, t.sort_order), 'ops_status', t.ops_status,
          'serving_booking_id', t.serving_booking_id, 'created_at', t.created_at)));
    update dining_tables set code = v_code, floor_code = p_floor_code, capacity = p_capacity,
           active = coalesce(p_active, true), note = nullif(btrim(p_note), ''),
           sort_order = coalesce(p_sort_order, sort_order), updated_at = now()
     where id = p_id returning * into t;
  end if;
  return jsonb_build_object('id', t.id, 'code', t.code);
end $$;

create function public.admin_save_lookup(
  p_id uuid, p_kind text, p_label text, p_active boolean default true, p_sort_order int default 0)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare l public.lookups; v_label text := btrim(coalesce(p_label, ''));
begin
  perform private.require_manager();
  if v_label = '' then perform private.invalid('label', 'Nhập tên mục.'); end if;
  if p_id is null then
    if p_kind not in ('source', 'purpose', 'deposit_method') then perform private.invalid('kind', 'Loại danh mục không hợp lệ.'); end if;
    if exists (select 1 from lookups where kind = p_kind and label = v_label) then
      perform private.invalid('label', 'Mục này đã có trong danh mục.');
    end if;
    insert into lookups (kind, label, active, sort_order) values (p_kind, v_label, coalesce(p_active, true), coalesce(p_sort_order, 0))
      returning * into l;
  else
    if exists (select 1 from lookups where kind = (select kind from lookups where id = p_id) and label = v_label and id <> p_id) then
      perform private.invalid('label', 'Mục này đã có trong danh mục.');
    end if;
    update lookups set label = v_label, active = coalesce(p_active, true), sort_order = coalesce(p_sort_order, sort_order)
     where id = p_id returning * into l;
    if not found then perform private.fail('E_NOT_FOUND'); end if;
  end if;
  perform private.audit('lookup', l.id::text, null, 'lookup_save', 'Danh mục ' || l.kind || ': ' || l.label, to_jsonb(l));
  return to_jsonb(l);
end $$;

create function public.admin_save_settings(
  p_open time, p_close time, p_buffer_minutes int, p_default_duration int)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare s public.app_settings; v_old jsonb;
begin
  perform private.require_manager();
  if p_close <= p_open then perform private.invalid('close_time', 'Giờ đóng cửa phải sau giờ mở cửa.'); end if;
  if p_buffer_minutes is null or p_buffer_minutes < 0 or p_buffer_minutes > 240 then
    perform private.invalid('buffer_minutes', 'Khoảng đệm dọn bàn từ 0 đến 240 phút.');
  end if;
  if p_default_duration is null or p_default_duration < 15 or p_default_duration > 720 then
    perform private.invalid('default_duration_minutes', 'Thời lượng gợi ý từ 15 đến 720 phút.');
  end if;
  select to_jsonb(a) into v_old from app_settings a where id = 1;
  update app_settings set open_time = p_open, close_time = p_close, buffer_minutes = p_buffer_minutes,
         default_duration_minutes = p_default_duration, updated_at = now() where id = 1 returning * into s;
  perform private.audit('settings', '1', null, 'settings', 'Đổi cấu hình', private.jsonb_diff(v_old, to_jsonb(s)));
  return to_jsonb(s);
end $$;

create function public.admin_set_profile(
  p_id uuid, p_full_name text, p_role public.user_role, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p public.profiles; v_old jsonb;
begin
  perform private.require_manager();
  if btrim(coalesce(p_full_name, '')) = '' then perform private.invalid('full_name', 'Nhập họ tên.'); end if;
  select * into p from profiles where id = p_id for update;
  if not found then perform private.fail('E_NOT_FOUND'); end if;
  if p_id = auth.uid() and (p_role <> 'manager' or not p_active) then
    perform private.invalid('role', 'Bạn không thể tự hạ quyền hoặc khóa tài khoản của chính mình.');
  end if;
  v_old := to_jsonb(p) - 'created_at' - 'updated_at';
  update profiles set full_name = btrim(p_full_name), role = p_role, active = p_active, updated_at = now()
   where id = p_id returning * into p;
  perform private.audit('profile', p.id::text, null, 'profile_update', 'Sửa tài khoản ' || p.full_name,
    private.jsonb_diff(v_old, to_jsonb(p) - 'created_at' - 'updated_at'));
  return jsonb_build_object('id', p.id);
end $$;

-- ================= migrations/0003_read_api.sql =================
-- Migration 0003: các hàm đọc dữ liệu (chạy với quyền của người gọi → áp dụng RLS)

create function private.booking_json(b public.bookings) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', b.id, 'code', b.code, 'status', b.status, 'is_walk_in', b.is_walk_in, 'is_demo', b.is_demo,
    'consultant_id', b.consultant_id,
    'consultant_name', (select full_name from profiles where id = b.consultant_id),
    'event_name', b.event_name, 'customer_name', b.customer_name, 'customer_phone', b.customer_phone,
    'source_id', b.source_id, 'source_label', (select label from lookups where id = b.source_id),
    'purpose_id', b.purpose_id, 'purpose_label', (select label from lookups where id = b.purpose_id),
    'start_at', b.start_at, 'end_at', b.end_at, 'booked_at', b.booked_at,
    'party_size', b.party_size, 'children_count', b.children_count,
    'decoration', b.decoration, 'special_requests', b.special_requests,
    'deposit_amount', b.deposit_amount, 'deposit_method_id', b.deposit_method_id,
    'deposit_method_label', (select label from lookups where id = b.deposit_method_id),
    'deposit_date', b.deposit_date, 'contract_code', b.contract_code,
    'cancel_reason', b.cancel_reason, 'change_note', b.change_note, 'override_reason', b.override_reason,
    'version', b.version,
    'created_at', b.created_at, 'created_by_name', (select full_name from profiles where id = b.created_by),
    'updated_at', b.updated_at, 'updated_by_name', (select full_name from profiles where id = b.updated_by),
    'tables', coalesce((select jsonb_agg(jsonb_build_object(
                'id', t.id, 'code', t.code, 'floor_code', t.floor_code, 'capacity', t.capacity)
                order by f.sort_order, t.sort_order, t.code)
              from booking_tables bt
              join dining_tables t on t.id = bt.table_id
              join floors f on f.code = t.floor_code
              where bt.booking_id = b.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'note', i.note)
                order by i.sort_order) from booking_items i where i.booking_id = b.id), '[]'::jsonb)
  )
$$;

-- Thông tin chung sau đăng nhập
create function public.get_context() returns jsonb
language plpgsql stable set search_path = public, extensions, pg_temp as $$
begin
  perform private.require_staff();
  return jsonb_build_object(
    'now', now(),
    'me', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role)
             from profiles p where p.id = auth.uid()),
    'settings', (select to_jsonb(s) from app_settings s where s.id = 1),
    'floors', (select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order), '[]'::jsonb) from floors f),
    'lookups', (select coalesce(jsonb_agg(to_jsonb(l) order by l.kind, l.sort_order, l.label), '[]'::jsonb) from lookups l),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role)
                order by p.full_name), '[]'::jsonb) from profiles p where p.active)
  );
end $$;

-- Bảng bàn theo ngày: danh sách bàn + các lượt đặt trong ngày (kèm lượt đang phục vụ)
create function public.get_board(p_day date) returns jsonb
language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare
  v_from timestamptz := (p_day::timestamp at time zone 'Asia/Ho_Chi_Minh');
  v_to   timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
begin
  perform private.require_staff();
  return jsonb_build_object(
    'now', now(),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', t.id, 'code', t.code, 'floor_code', t.floor_code, 'capacity', t.capacity,
                  'ops_status', t.ops_status, 'active', t.active, 'note', t.note,
                  'serving_booking_id', t.serving_booking_id,
                  'serving_booking_code', (select code from bookings where id = t.serving_booking_id))
                order by f.sort_order, t.sort_order, t.code), '[]'::jsonb)
               from dining_tables t join floors f on f.code = t.floor_code where t.active),
    'bookings', (select coalesce(jsonb_agg(private.booking_json(b) order by b.start_at, b.code), '[]'::jsonb)
                   from bookings b
                  where (b.start_at < v_to and b.end_at > v_from) or b.status = 'arrived')
  );
end $$;

create function public.get_booking(p_id uuid) returns jsonb
language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare b public.bookings;
begin
  perform private.require_staff();
  select * into b from bookings where id = p_id;
  if not found then perform private.fail('E_NOT_FOUND'); end if;
  return private.booking_json(b);
end $$;

create function public.get_booking_history(p_id uuid) returns jsonb
language plpgsql stable set search_path = public, extensions, pg_temp as $$
begin
  perform private.require_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object(
              'id', a.id, 'at', a.at, 'actor_name', a.actor_name, 'action', a.action,
              'summary', a.summary, 'changes', a.changes) order by a.at desc, a.id desc), '[]'::jsonb)
            from audit_log a where a.booking_id = p_id);
end $$;

-- Tình trạng từng bàn trong một khung giờ (để chọn bàn khi đặt)
create function public.get_availability(p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare v_buf int; v_range tstzrange;
begin
  perform private.require_staff();
  if p_start is null or p_end is null or p_end <= p_start then return '[]'::jsonb; end if;
  select buffer_minutes into v_buf from app_settings where id = 1;
  v_range := tstzrange(p_start, p_end + make_interval(mins => v_buf), '[)');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'floor_code', t.floor_code, 'capacity', t.capacity,
      'ops_status', t.ops_status,
      'conflict', (select jsonb_build_object('booking_id', ob.id, 'booking_code', ob.code,
                          'customer_name', ob.customer_name, 'event_name', ob.event_name, 'status', ob.status,
                          'start_at', ob.start_at, 'end_at', ob.end_at)
                     from booking_tables bt join bookings ob on ob.id = bt.booking_id
                    where bt.table_id = t.id and bt.holds and bt.booking_id is distinct from p_exclude
                      and bt.during && v_range
                    order by lower(bt.during) limit 1),
      'next_start', (select min(lower(bt.during)) from booking_tables bt
                      where bt.table_id = t.id and bt.holds and bt.booking_id is distinct from p_exclude
                        and lower(bt.during) >= p_end),
      'serving', (select jsonb_build_object('booking_code', ob.code, 'end_at', ob.end_at)
                    from bookings ob where ob.id = t.serving_booking_id
                      and ob.id is distinct from p_exclude)
    ) order by f.sort_order, t.sort_order, t.code), '[]'::jsonb)
    from dining_tables t join floors f on f.code = t.floor_code where t.active);
end $$;

-- Tìm kiếm / lọc / sắp xếp lượt đặt. p_limit null = lấy tất cả (dùng cho xuất Excel, tối đa 20.000).
create function public.search_bookings(
  p_filters jsonb default '{}'::jsonb, p_sort text default 'start_at', p_dir text default 'desc',
  p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_q      text := nullif(btrim(f ->> 'q'), '');
  v_pat    text;
  v_pdig   text;
  v_basis  text := case when f ->> 'date_basis' = 'booked' then 'booked' else 'event' end;
  v_from   timestamptz := (nullif(f ->> 'date_from', '')::date)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to     timestamptz := ((nullif(f ->> 'date_to', '')::date) + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_status text[] := case when jsonb_typeof(f -> 'status') = 'array'
                          then array(select jsonb_array_elements_text(f -> 'status')) end;
  v_where  text;
  v_order  text;
  v_dir    text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_limit  int := least(coalesce(p_limit, 20000), 20000);
  v_rows   jsonb;
  v_tot    record;
begin
  perform private.require_staff();
  if v_q is not null then
    v_pat := '%' || extensions.unaccent(lower(v_q)) || '%';
    v_pdig := regexp_replace(v_q, '[^0-9+]', '', 'g');
    if v_pdig = '' then v_pdig := null; else v_pdig := '%' || v_pdig || '%'; end if;
  end if;
  v_order := case p_sort
    when 'code' then 'b.code' when 'customer_name' then 'b.customer_name'
    when 'event_name' then 'b.event_name' when 'start_at' then 'b.start_at'
    when 'booked_at' then 'b.booked_at' when 'party_size' then 'b.party_size'
    when 'children_count' then 'b.children_count' when 'deposit_amount' then 'b.deposit_amount'
    when 'deposit_date' then 'b.deposit_date' when 'status' then 'b.status'
    when 'contract_code' then 'b.contract_code' when 'customer_phone' then 'b.customer_phone'
    when 'created_at' then 'b.created_at' when 'consultant' then '(select full_name from profiles where id = b.consultant_id)'
    else 'b.start_at' end;

  v_where := $w$
    where ($1::text is null or (
            extensions.unaccent(lower(coalesce(b.customer_name, ''))) like $1
         or extensions.unaccent(lower(coalesce(b.event_name, ''))) like $1
         or lower(b.code) like $1 or lower(coalesce(b.contract_code, '')) like $1
         or ($2::text is not null and coalesce(b.customer_phone, '') like $2)
         or exists (select 1 from booking_tables bt join dining_tables t on t.id = bt.table_id
                     where bt.booking_id = b.id and lower(t.code) like $1)))
      and ($3::timestamptz is null or (case when $9 = 'booked' then b.booked_at else b.start_at end) >= $3)
      and ($4::timestamptz is null or (case when $9 = 'booked' then b.booked_at else b.start_at end) < $4)
      and ($5::text is null or exists (select 1 from booking_tables bt join dining_tables t on t.id = bt.table_id
                                        where bt.booking_id = b.id and t.floor_code = $5))
      and ($6::uuid is null or exists (select 1 from booking_tables bt where bt.booking_id = b.id and bt.table_id = $6))
      and ($7::text[] is null or b.status::text = any($7))
      and ($8::text is null or ($8 = 'has' and coalesce(b.deposit_amount, 0) > 0)
                            or ($8 = 'none' and coalesce(b.deposit_amount, 0) = 0))
      and ($10::uuid is null or b.consultant_id = $10)
      and ($11::uuid is null or b.source_id = $11)
      and ($12::uuid is null or b.purpose_id = $12)
  $w$;

  execute 'select count(*)::int as n, coalesce(sum(b.party_size), 0)::int as guests, coalesce(sum(b.deposit_amount), 0) as deposit
             from bookings b ' || v_where
    into v_tot
    using v_pat, v_pdig, v_from, v_to, nullif(f ->> 'floor', ''), nullif(f ->> 'table_id', '')::uuid,
          v_status, nullif(f ->> 'deposit', ''), v_basis, nullif(f ->> 'consultant_id', '')::uuid,
          nullif(f ->> 'source_id', '')::uuid, nullif(f ->> 'purpose_id', '')::uuid;

  execute format('select coalesce(jsonb_agg(j order by rn), ''[]''::jsonb)
                    from (select private.booking_json(b) as j,
                                 row_number() over (order by %s %s nulls last, b.code) as rn
                            from bookings b %s order by rn limit %s offset %s) x',
                 v_order, v_dir, v_where, v_limit, greatest(coalesce(p_offset, 0), 0))
    into v_rows
    using v_pat, v_pdig, v_from, v_to, nullif(f ->> 'floor', ''), nullif(f ->> 'table_id', '')::uuid,
          v_status, nullif(f ->> 'deposit', ''), v_basis, nullif(f ->> 'consultant_id', '')::uuid,
          nullif(f ->> 'source_id', '')::uuid, nullif(f ->> 'purpose_id', '')::uuid;

  return jsonb_build_object('total', v_tot.n, 'total_guests', v_tot.guests,
                            'total_deposit', v_tot.deposit, 'rows', v_rows);
end $$;

-- Nhật ký (chỉ quản lý)
create function public.get_audit_log(p_filters jsonb default '{}'::jsonb, p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_from timestamptz := (nullif(f ->> 'date_from', '')::date)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to timestamptz := ((nullif(f ->> 'date_to', '')::date) + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_q text := nullif(btrim(f ->> 'q'), '');
  v_total int;
  v_rows jsonb;
begin
  perform private.require_manager();
  select count(*) into v_total from audit_log a
   where (v_from is null or a.at >= v_from) and (v_to is null or a.at < v_to)
     and (nullif(f ->> 'entity', '') is null or a.entity = f ->> 'entity')
     and (v_q is null or a.summary ilike '%' || v_q || '%' or a.actor_name ilike '%' || v_q || '%'
          or exists (select 1 from bookings b where b.id = a.booking_id and b.code ilike '%' || v_q || '%'));
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', a.id, 'at', a.at, 'actor_name', a.actor_name, 'entity', a.entity,
             'action', a.action, 'summary', a.summary, 'changes', a.changes, 'booking_id', a.booking_id,
             'booking_code', (select code from bookings b where b.id = a.booking_id)) as r
      from audit_log a
     where (v_from is null or a.at >= v_from) and (v_to is null or a.at < v_to)
       and (nullif(f ->> 'entity', '') is null or a.entity = f ->> 'entity')
       and (v_q is null or a.summary ilike '%' || v_q || '%' or a.actor_name ilike '%' || v_q || '%'
            or exists (select 1 from bookings b where b.id = a.booking_id and b.code ilike '%' || v_q || '%'))
     order by a.at desc, a.id desc
     limit least(coalesce(p_limit, 100), 500) offset greatest(coalesce(p_offset, 0), 0)) s;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create function public.get_profiles() returns jsonb
language plpgsql stable set search_path = public, extensions, pg_temp as $$
begin
  perform private.require_manager();
  return (select coalesce(jsonb_agg(to_jsonb(p) order by p.role, p.full_name), '[]'::jsonb) from profiles p);
end $$;

-- Danh mục bàn đầy đủ (kể cả bàn đã ngưng dùng) cho màn hình quản lý
create function public.get_all_tables() returns jsonb
language plpgsql stable set search_path = public, extensions, pg_temp as $$
begin
  perform private.require_manager();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'floor_code', t.floor_code, 'capacity', t.capacity,
      'ops_status', t.ops_status, 'active', t.active, 'note', t.note, 'sort_order', t.sort_order)
      order by f.sort_order, t.sort_order, t.code), '[]'::jsonb)
    from dining_tables t join floors f on f.code = t.floor_code);
end $$;

-- ================= migrations/0004_security.sql =================
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
  public.get_audit_log(jsonb, int, int), public.get_profiles(), public.get_all_tables(),
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

-- ================= seed.sql =================
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
  ('deposit_method', 'Tiền mặt', 1), ('deposit_method', 'Chuyển khoản', 2), ('deposit_method', 'Thẻ', 3)
on conflict (kind, label) do nothing;
