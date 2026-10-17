-- BTL Africa: make campaign/event assignment updates non-destructive.
update public.user_campaign_assignments a
set is_active = true
from public.campaigns c
where c.id = a.campaign_id and c.campaign_type = 'event' and lower(c.code) = 'long-service-award-2026'
  and exists (select 1 from public.users u where u.id=a.user_id and u.role='agent' and u.is_active);
update public.agent_campaign_supervisor_assignments a
set is_active = true
from public.campaigns c
where c.id = a.campaign_id and c.campaign_type = 'event' and lower(c.code) = 'long-service-award-2026'
  and exists (select 1 from public.users u where u.id=a.agent_id and u.role='agent' and u.is_active)
  and exists (select 1 from public.users u where u.id=a.supervisor_id and u.role in ('supervisor','sub_admin','admin','super_admin') and u.is_active);

create or replace function public.sync_agent_campaign_supervisor_assignments(p_agent_id text,p_assignments jsonb,p_manager_id text)
returns setof public.agent_campaign_supervisor_assignments
language plpgsql security definer set search_path=public as $function$
declare manager_role text; target_role text; assignment_item jsonb; selected_campaign uuid; selected_supervisor text; existing_id uuid; expected_campaign_type text;
begin
  select role into manager_role from public.users where id=p_manager_id and is_active;
  if manager_role not in ('supervisor','sub_admin','admin','super_admin') then raise exception 'campaign_manager_required' using errcode='42501'; end if;
  select role into target_role from public.users where id=p_agent_id and is_active;
  if target_role is distinct from 'agent' then raise exception 'campaigns_are_for_agents_only' using errcode='22023'; end if;
  if manager_role='supervisor' and not exists(select 1 from public.agent_campaign_supervisor_assignments a where a.agent_id=p_agent_id and a.supervisor_id=p_manager_id and a.is_active) then raise exception 'campaign_supervisor_required' using errcode='42501'; end if;
  for assignment_item in select value from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb)) loop
    selected_campaign := (assignment_item->>'campaign_id')::uuid;
    select case when u.user_category='hostess' then 'hostess' else 'brand_ambassador' end into expected_campaign_type from public.users u where u.id=p_agent_id;
    if not exists(select 1 from public.campaigns c where c.id=selected_campaign and c.status in ('active','draft') and (c.campaign_type=expected_campaign_type or (expected_campaign_type='hostess' and c.campaign_type='event'))) then raise exception 'campaign_not_available' using errcode='22023'; end if;
    if not exists(select 1 from public.user_campaign_assignments a where a.user_id=p_agent_id and a.campaign_id=selected_campaign and a.is_active) then
      insert into public.user_campaign_assignments(id,user_id,campaign_id,is_active,assigned_at,assigned_by) values(gen_random_uuid(),p_agent_id,selected_campaign,true,now(),p_manager_id) on conflict(user_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_manager_id;
    end if;
    for selected_supervisor in select value from jsonb_array_elements_text(coalesce(assignment_item->'supervisor_ids','[]'::jsonb)) loop
      if not exists(select 1 from public.users u where u.id=selected_supervisor and u.role in ('supervisor','sub_admin','admin','super_admin') and u.is_active) then raise exception 'invalid_campaign_supervisor' using errcode='22023'; end if;
      select a.id into existing_id from public.agent_campaign_supervisor_assignments a where a.agent_id=p_agent_id and a.supervisor_id=selected_supervisor and a.campaign_id=selected_campaign limit 1;
      if existing_id is null then insert into public.agent_campaign_supervisor_assignments(id,agent_id,supervisor_id,campaign_id,is_active,assigned_at,assigned_by) values(gen_random_uuid(),p_agent_id,selected_supervisor,selected_campaign,true,now(),p_manager_id); else update public.agent_campaign_supervisor_assignments set is_active=true,assigned_at=now(),assigned_by=p_manager_id where id=existing_id; end if;
    end loop;
    update public.agent_campaign_supervisor_assignments a set is_active=false where a.agent_id=p_agent_id and a.campaign_id=selected_campaign and a.is_active and not exists(select 1 from jsonb_array_elements_text(coalesce(assignment_item->'supervisor_ids','[]'::jsonb)) s(value) where s.value=a.supervisor_id);
  end loop;
  return query select a.* from public.agent_campaign_supervisor_assignments a where a.agent_id=p_agent_id and a.is_active order by a.assigned_at desc;
end;
$function$;
grant execute on function public.sync_agent_campaign_supervisor_assignments(text,jsonb,text) to anon,authenticated;

create or replace function public.update_campaign_management(p_actor_id text,p_campaign_id uuid,p_code text,p_name text,p_starts_on date,p_ends_on date,p_supervisor_id text,p_agent_ids text[] default '{}')
returns public.campaigns language plpgsql security definer set search_path=public as $function$
declare actor_role text; row_campaign public.campaigns; selected_agent text;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin','sub_admin') then raise exception 'campaign_editor_not_allowed' using errcode='42501'; end if;
  if not exists(select 1 from public.campaigns where id=p_campaign_id) then raise exception 'campaign_not_found' using errcode='P0002'; end if;
  if p_code !~ '^[a-z0-9][a-z0-9-]{2,79}$' or char_length(trim(p_name))<2 or p_starts_on is null or (p_ends_on is not null and p_starts_on>p_ends_on) then raise exception 'campaign_details_invalid' using errcode='22023'; end if;
  if p_supervisor_id is not null and not exists(select 1 from public.users where id=p_supervisor_id and role in ('supervisor','sub_admin','admin','super_admin') and is_active) then raise exception 'campaign_supervisor_invalid' using errcode='22023'; end if;
  update public.campaigns set code=lower(trim(p_code)),name=trim(p_name),starts_on=p_starts_on,ends_on=p_ends_on,event_supervisor_id=case when campaign_type='event' then p_supervisor_id else event_supervisor_id end,updated_at=now() where id=p_campaign_id returning * into row_campaign;
  update public.user_campaign_assignments set is_active=false where campaign_id=p_campaign_id and user_id not in(select unnest(coalesce(p_agent_ids,'{}')));
  foreach selected_agent in array coalesce(p_agent_ids,'{}') loop
    if exists(select 1 from public.users where id=selected_agent and role='agent' and is_active) then
      insert into public.user_campaign_assignments(user_id,campaign_id,is_active,assigned_at,assigned_by) values(selected_agent,p_campaign_id,true,now(),p_actor_id) on conflict(user_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_actor_id;
      if p_supervisor_id is not null then insert into public.agent_campaign_supervisor_assignments(agent_id,supervisor_id,campaign_id,is_active,assigned_at,assigned_by) values(selected_agent,p_supervisor_id,p_campaign_id,true,now(),p_actor_id) on conflict(agent_id,supervisor_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_actor_id; end if;
    end if;
  end loop;
  return row_campaign;
end;
$function$;
grant execute on function public.update_campaign_management(text,uuid,text,text,date,date,text,text[]) to anon,authenticated;
notify pgrst,'reload schema';
