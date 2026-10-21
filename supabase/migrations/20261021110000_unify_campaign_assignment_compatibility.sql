-- BTL Africa: single compatibility rule for every campaign assignment path.
-- hostess              -> hostess campaigns + events
-- brand_ambassador     -> brand ambassador campaigns
-- hostess_polyvalent   -> hostess campaigns + BA campaigns + events
-- This migration intentionally preserves historical rows and only changes
-- validation for future assignment, request and review operations.

create or replace function public.campaign_type_allowed_for_category(
  p_campaign_type text,
  p_user_category text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_user_category = 'hostess_polyvalent'
      then p_campaign_type in ('hostess', 'brand_ambassador', 'event')
    when p_user_category = 'hostess'
      then p_campaign_type in ('hostess', 'event')
    when p_user_category = 'brand_ambassador'
      then p_campaign_type = 'brand_ambassador'
    else false
  end;
$$;

grant execute on function public.campaign_type_allowed_for_category(text, text) to anon, authenticated;

create or replace function public.set_user_campaign_assignments(
  p_user_id text,
  p_campaign_ids uuid[],
  p_manager_id text
)
returns setof public.user_campaign_assignments
language plpgsql security definer set search_path = public
as $function$
declare
  manager_role text;
  target_role text;
  target_category text;
  selected_campaign uuid;
  existing_assignment_id uuid;
begin
  select u.role into manager_role
  from public.users u
  where u.id = p_manager_id and u.is_active;

  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select u.role, u.user_category into target_role, target_category
  from public.users u
  where u.id = p_user_id and u.is_active;

  if target_role is distinct from 'agent'
     or target_category not in ('hostess', 'brand_ambassador', 'hostess_polyvalent') then
    raise exception 'campaigns_are_for_agents_only' using errcode = '22023';
  end if;

  -- The UI submits the complete selection. Deactivate only memberships that
  -- are intentionally absent from that complete selection.
  update public.user_campaign_assignments a
  set is_active = false
  where a.user_id = p_user_id
    and a.is_active
    and not (a.campaign_id = any(coalesce(p_campaign_ids, '{}'::uuid[])));

  update public.agent_campaign_supervisor_assignments a
  set is_active = false
  where a.agent_id = p_user_id
    and a.is_active
    and not (a.campaign_id = any(coalesce(p_campaign_ids, '{}'::uuid[])));

  foreach selected_campaign in array coalesce(p_campaign_ids, '{}'::uuid[]) loop
    if not exists (
      select 1
      from public.campaigns c
      where c.id = selected_campaign
        and c.status in ('active', 'draft')
        and public.campaign_type_allowed_for_category(c.campaign_type, target_category)
    ) then
      raise exception 'campaign_not_available' using errcode = '22023';
    end if;

    select a.id into existing_assignment_id
    from public.user_campaign_assignments a
    where a.user_id = p_user_id and a.campaign_id = selected_campaign
    limit 1;

    if existing_assignment_id is null then
      insert into public.user_campaign_assignments
        (id, user_id, campaign_id, is_active, assigned_at, assigned_by)
      values
        (gen_random_uuid(), p_user_id, selected_campaign, true, now(), p_manager_id);
    else
      update public.user_campaign_assignments
      set is_active = true, assigned_at = now(), assigned_by = p_manager_id
      where id = existing_assignment_id;
    end if;
  end loop;

  return query
  select a.*
  from public.user_campaign_assignments a
  where a.user_id = p_user_id and a.is_active
  order by a.assigned_at desc;
end;
$function$;

grant execute on function public.set_user_campaign_assignments(text, uuid[], text) to anon, authenticated;

create or replace function public.sync_agent_campaign_supervisor_assignments(
  p_agent_id text,
  p_assignments jsonb,
  p_manager_id text
)
returns setof public.agent_campaign_supervisor_assignments
language plpgsql security definer set search_path = public
as $function$
declare
  manager_role text;
  target_role text;
  target_category text;
  assignment_item jsonb;
  selected_campaign uuid;
  selected_supervisor text;
  existing_id uuid;
  submitted_campaign_ids uuid[] := '{}'::uuid[];
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id and u.is_active;
  if manager_role not in ('supervisor', 'sub_admin', 'admin', 'super_admin') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select u.role, u.user_category into target_role, target_category
  from public.users u where u.id = p_agent_id and u.is_active;
  if target_role is distinct from 'agent' then
    raise exception 'campaigns_are_for_agents_only' using errcode = '22023';
  end if;

  if manager_role = 'supervisor' and not exists (
    select 1 from public.agent_campaign_supervisor_assignments a
    where a.agent_id = p_agent_id and a.supervisor_id = p_manager_id and a.is_active
  ) then
    raise exception 'campaign_supervisor_required' using errcode = '42501';
  end if;

  for assignment_item in
    select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    selected_campaign := (assignment_item ->> 'campaign_id')::uuid;
    submitted_campaign_ids := array_append(submitted_campaign_ids, selected_campaign);

    if not exists (
      select 1 from public.campaigns c
      where c.id = selected_campaign
        and c.status in ('active', 'draft')
        and public.campaign_type_allowed_for_category(c.campaign_type, target_category)
    ) then
      raise exception 'campaign_not_available' using errcode = '22023';
    end if;

    -- Keep the legacy membership table synchronized with the supervisor table.
    insert into public.user_campaign_assignments
      (id, user_id, campaign_id, is_active, assigned_at, assigned_by)
    values
      (gen_random_uuid(), p_agent_id, selected_campaign, true, now(), p_manager_id)
    on conflict (user_id, campaign_id) do update
      set is_active = true, assigned_at = now(), assigned_by = p_manager_id;

    for selected_supervisor in
      select value from jsonb_array_elements_text(
        coalesce(assignment_item -> 'supervisor_ids', '[]'::jsonb)
      )
    loop
      if selected_supervisor = p_agent_id then
        raise exception 'agent_cannot_supervise_self' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.users u
        where u.id = selected_supervisor
          and u.role in ('supervisor', 'sub_admin', 'admin', 'super_admin')
          and u.is_active
      ) then
        raise exception 'invalid_campaign_supervisor' using errcode = '22023';
      end if;

      insert into public.agent_campaign_supervisor_assignments
        (id, agent_id, supervisor_id, campaign_id, is_active, assigned_at, assigned_by)
      values
        (gen_random_uuid(), p_agent_id, selected_supervisor, selected_campaign, true, now(), p_manager_id)
      on conflict (agent_id, supervisor_id, campaign_id) do update
        set is_active = true, assigned_at = now(), assigned_by = p_manager_id;
    end loop;

    update public.agent_campaign_supervisor_assignments a
    set is_active = false
    where a.agent_id = p_agent_id
      and a.campaign_id = selected_campaign
      and a.is_active
      and not exists (
        select 1 from jsonb_array_elements_text(
          coalesce(assignment_item -> 'supervisor_ids', '[]'::jsonb)
        ) s(value)
        where s.value = a.supervisor_id
      );
  end loop;

  -- If a selected campaign has no supervisors in the submitted payload, its
  -- membership remains valid while only its operational links are cleared.
  return query
  select a.*
  from public.agent_campaign_supervisor_assignments a
  where a.agent_id = p_agent_id and a.is_active
  order by a.assigned_at desc;
end;
$function$;

grant execute on function public.sync_agent_campaign_supervisor_assignments(text, jsonb, text) to anon, authenticated;

create or replace function public.request_campaign_assignment(
  p_user_id text,
  p_campaign_id uuid
)
returns public.campaign_assignment_requests
language plpgsql security definer set search_path = public
as $function$
declare
  requested public.campaign_assignment_requests;
  target_category text;
  campaign_type text;
begin
  select u.user_category into target_category
  from public.users u where u.id = p_user_id and u.role = 'agent' and u.is_active;
  if target_category is null then raise exception 'agent_required' using errcode = '42501'; end if;

  select c.campaign_type into campaign_type
  from public.campaigns c where c.id = p_campaign_id and c.status in ('active', 'draft');
  if campaign_type is null then raise exception 'campaign_not_available' using errcode = '22023'; end if;
  if not public.campaign_type_allowed_for_category(campaign_type, target_category) then
    raise exception 'campaign_category_mismatch' using errcode = '22023';
  end if;

  if exists (select 1 from public.user_campaign_assignments a where a.user_id = p_user_id and a.campaign_id = p_campaign_id and a.is_active) then
    raise exception 'already_assigned' using errcode = '23505';
  end if;

  if exists (select 1 from public.campaign_assignment_requests r where r.user_id = p_user_id and r.campaign_id = p_campaign_id and r.status = 'pending') then
    select * into requested from public.campaign_assignment_requests r where r.user_id = p_user_id and r.campaign_id = p_campaign_id and r.status = 'pending' order by r.requested_at desc limit 1;
    return requested;
  end if;

  insert into public.campaign_assignment_requests (user_id, campaign_id)
  values (p_user_id, p_campaign_id)
  returning * into requested;
  return requested;
end;
$function$;

grant execute on function public.request_campaign_assignment(text, uuid) to anon, authenticated;

create or replace function public.review_campaign_assignment_request(
  p_request_id uuid,
  p_manager_id text,
  p_approve boolean,
  p_review_note text default null
)
returns public.campaign_assignment_requests
language plpgsql security definer set search_path = public
as $function$
declare
  manager_role text;
  request_row public.campaign_assignment_requests;
  reviewed public.campaign_assignment_requests;
  target_category text;
  campaign_type text;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id and u.is_active;
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then raise exception 'campaign_manager_required' using errcode = '42501'; end if;
  select * into request_row from public.campaign_assignment_requests r where r.id = p_request_id and r.status = 'pending' for update;
  if not found then raise exception 'campaign_request_not_pending' using errcode = 'P0002'; end if;

  if p_approve then
    select u.user_category into target_category from public.users u where u.id = request_row.user_id and u.role = 'agent' and u.is_active;
    if target_category is null then raise exception 'agent_required' using errcode = '22023'; end if;
    select c.campaign_type into campaign_type from public.campaigns c where c.id = request_row.campaign_id and c.status in ('active', 'draft');
    if campaign_type is null then raise exception 'campaign_not_available' using errcode = '22023'; end if;
    if not public.campaign_type_allowed_for_category(campaign_type, target_category) then raise exception 'campaign_category_mismatch' using errcode = '22023'; end if;

    insert into public.user_campaign_assignments (id, user_id, campaign_id, is_active, assigned_at, assigned_by)
    values (gen_random_uuid(), request_row.user_id, request_row.campaign_id, true, now(), p_manager_id)
    on conflict (user_id, campaign_id) do update set is_active = true, assigned_at = now(), assigned_by = p_manager_id;
  end if;

  update public.campaign_assignment_requests r
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = p_manager_id, review_note = nullif(trim(p_review_note), '')
  where r.id = p_request_id
  returning * into reviewed;
  return reviewed;
end;
$function$;

grant execute on function public.review_campaign_assignment_request(uuid, text, boolean, text) to anon, authenticated;
notify pgrst, 'reload schema';
