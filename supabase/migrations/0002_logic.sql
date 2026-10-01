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
