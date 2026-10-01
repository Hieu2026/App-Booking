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
