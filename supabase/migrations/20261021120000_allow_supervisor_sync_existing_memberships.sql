-- BTL Africa: keep supervisor edits possible for existing campaign memberships.
-- A paused/archived campaign must not be newly assigned, but its existing
-- membership must not block an operational supervisor update.
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
        and public.campaign_type_allowed_for_category(c.campaign_type, target_category)
        and (
          c.status in ('active', 'draft')
          or exists (
            select 1 from public.user_campaign_assignments existing
            where existing.user_id = p_user_id
              and existing.campaign_id = selected_campaign
              and existing.is_active
          )
        )
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
        and public.campaign_type_allowed_for_category(c.campaign_type, target_category)
        and (
          c.status in ('active', 'draft')
          or exists (
            select 1 from public.user_campaign_assignments existing
            where existing.user_id = p_agent_id
              and existing.campaign_id = selected_campaign
              and existing.is_active
          )
        )
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

notify pgrst, 'reload schema';
