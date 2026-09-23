-- BTL Africa: publish the shared operational tables through Supabase Realtime.
-- This is idempotent and only adds tables that already exist.

do $migration$
declare
  target_table text;
begin
  foreach target_table in array array[
    'users',
    'campaigns',
    'user_campaign_assignments',
    'agent_campaign_supervisor_assignments',
    'campaign_assignment_requests',
    'campaign_claims',
    'user_registration_requests'
  ] loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and information_schema.tables.table_name = target_table
    )
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and pg_publication_tables.tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$migration$;
