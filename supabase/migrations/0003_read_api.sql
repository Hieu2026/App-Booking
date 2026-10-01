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
