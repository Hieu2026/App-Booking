-- Migration 0005: danh mục "Nhân viên tư vấn" cấu hình được + bổ sung nguồn khách BNI, TikTok, Website.
-- An toàn khi chạy trên CSDL đã có dữ liệu: chỉ thêm cột/ràng buộc, thay hàm, thêm mục danh mục còn thiếu.
-- Lượt đặt cũ (nếu có) vẫn hiển thị tên nhân viên tư vấn theo tài khoản cũ.

alter table public.lookups drop constraint if exists lookups_kind_check;
alter table public.lookups add constraint lookups_kind_check
  check (kind in ('source', 'purpose', 'deposit_method', 'consultant'));

alter table public.bookings add column if not exists consultant_option_id uuid references public.lookups (id);
create index if not exists bookings_consultant_option_idx on public.bookings (consultant_option_id);

create or replace function private.booking_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'Trạng thái', b.status,
    'Nhân viên tư vấn', coalesce((select label from lookups where id = b.consultant_option_id), (select full_name from profiles where id = b.consultant_id)),
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

create or replace function private.booking_json(b public.bookings) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', b.id, 'code', b.code, 'status', b.status, 'is_walk_in', b.is_walk_in, 'is_demo', b.is_demo,
    'consultant_id', b.consultant_id, 'consultant_option_id', b.consultant_option_id,
    'consultant_name', coalesce((select label from lookups where id = b.consultant_option_id), (select full_name from profiles where id = b.consultant_id)),
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

create or replace function private.save_booking(
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
        id, status, is_walk_in, consultant_option_id, event_name, customer_name, customer_phone,
        source_id, purpose_id, start_at, end_at, booked_at, party_size, children_count,
        decoration, special_requests, deposit_amount, deposit_method_id, deposit_date,
        contract_code, change_note, override_reason, created_by, updated_by)
      values (
        v_id, v_status, v_walk,
        nullif(d ->> 'consultant_option_id', '')::uuid,
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
        consultant_option_id = nullif(d ->> 'consultant_option_id', '')::uuid,
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

create or replace function public.search_bookings(
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
    when 'created_at' then 'b.created_at' when 'consultant' then 'coalesce((select label from lookups where id = b.consultant_option_id), (select full_name from profiles where id = b.consultant_id))'
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
      and ($10::uuid is null or b.consultant_option_id = $10)
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

create or replace function public.admin_save_lookup(
  p_id uuid, p_kind text, p_label text, p_active boolean default true, p_sort_order int default 0)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare l public.lookups; v_label text := btrim(coalesce(p_label, ''));
begin
  perform private.require_manager();
  if v_label = '' then perform private.invalid('label', 'Nhập tên mục.'); end if;
  if p_id is null then
    if p_kind not in ('source', 'purpose', 'deposit_method', 'consultant') then perform private.invalid('kind', 'Loại danh mục không hợp lệ.'); end if;
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

-- Danh mục mẫu (chạy lặp lại không tạo trùng, không ghi đè chỉnh sửa)
insert into public.lookups (kind, label, sort_order) values
  ('source', 'BNI', 7), ('source', 'TikTok', 8), ('source', 'Website', 9),
  ('consultant', 'Lễ tân', 1), ('consultant', 'Khánh Hồng', 2), ('consultant', 'Cát Tường', 3), ('consultant', 'Uyên Hồ', 4)
on conflict (kind, label) do nothing;
