-- BTL Africa: remove one agent from one campaign/event without deleting history.
create or replace function public.remove_agent_from_campaign(
  p_agent_id text,
  p_campaign_id uuid,
  p_manager_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare manager_role text;
begin
  select role into manager_role from public.users where id = p_manager_id and is_active;
  if manager_role not in ('admin','super_admin','sub_admin','supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.campaigns where id = p_campaign_id) then
    raise exception 'campaign_not_found' using errcode = 'P0002';
  end if;
  if manager_role = 'supervisor' and not exists (
    select 1 from public.agent_campaign_supervisor_assignments
    where agent_id = p_agent_id and campaign_id = p_campaign_id and supervisor_id = p_manager_id and is_active
  ) then
    raise exception 'campaign_supervisor_required' using errcode = '42501';
  end if;
  update public.user_campaign_assignments
  set is_active = false
  where user_id = p_agent_id and campaign_id = p_campaign_id;
  update public.agent_campaign_supervisor_assignments
  set is_active = false
  where agent_id = p_agent_id and campaign_id = p_campaign_id;
  return true;
end;
$function$;
grant execute on function public.remove_agent_from_campaign(text, uuid, text) to anon, authenticated;
notify pgrst, 'reload schema';
