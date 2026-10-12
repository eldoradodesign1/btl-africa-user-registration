-- BTL Africa: expose existing lead action types to the attendance claim form.
create or replace function public.list_lead_action_types()
returns table(action_type text)
language sql
security definer
set search_path = public
as $function$
  select distinct btrim(l.action_type)
  from public.leads l
  where nullif(btrim(l.action_type), '') is not null
  order by btrim(l.action_type);
$function$;

grant execute on function public.list_lead_action_types() to anon, authenticated;
