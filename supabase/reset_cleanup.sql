drop schema if exists private cascade;
drop table if exists public.idempotency_keys, public.audit_log, public.booking_items, public.booking_tables, public.bookings, public.dining_tables, public.floors, public.lookups, public.app_settings, public.profiles cascade;
drop sequence if exists public.booking_code_seq;
drop type if exists public.booking_status, public.table_ops_status, public.user_role cascade;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('create_booking','update_booking','move_booking_table','set_booking_status','set_table_status','admin_save_table','admin_save_lookup','admin_save_settings','admin_set_profile','get_context','get_board','get_booking','get_booking_history','get_availability','search_bookings','get_audit_log','get_profiles','get_all_tables')
  loop execute 'drop function ' || r.sig; end loop;
end $$;
