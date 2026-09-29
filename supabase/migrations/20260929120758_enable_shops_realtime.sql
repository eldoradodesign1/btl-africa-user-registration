-- BTL Africa: publish shops through Supabase Realtime.
-- Safe to apply repeatedly: it only adds the table when it exists and is not published.

do $migration$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'shops'
  )
  and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shops'
  ) then
    alter publication supabase_realtime add table public.shops;
  end if;
end;
$migration$;
