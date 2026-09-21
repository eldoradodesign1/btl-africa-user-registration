-- BTL Africa: campaign assignment management for agents.
-- Existing schema: public.users.id/user_campaign_assignments.user_id are text;
-- campaigns.id/user_campaign_assignments.campaign_id are uuid.

create or replace function public.set_user_campaign_assignments(
  p_user_id text,
  p_campaign_ids uuid[],
  p_manager_id text
)
returns setof public.user_campaign_assignments
language plpgsql
security definer
set search_path = public
as $function$
declare
  manager_role text;
  target_role text;
  target_category text;
  expected_campaign_type text;
  selected_campaign uuid;
  existing_assignment_id uuid;
begin
  select u.role into manager_role
  from public.users u
  where u.id = p_manager_id;

  if manager_role not in ('admin', 'super_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select u.role, u.user_category into target_role, target_category
  from public.users u
  where u.id = p_user_id;

  if target_role is distinct from 'agent' or target_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth') then
    raise exception 'campaigns_are_for_agents_only' using errcode = '22023';
  end if;

  expected_campaign_type := case when target_category = 'hostess' then 'hostess' else 'brand_ambassador' end;

  update public.user_campaign_assignments a
  set is_active = false
  where a.user_id = p_user_id
    and a.is_active = true
    and not (a.campaign_id = any(coalesce(p_campaign_ids, '{}'::uuid[])));

  foreach selected_campaign in array coalesce(p_campaign_ids, '{}'::uuid[]) loop
    if not exists (
      select 1
      from public.campaigns c
      where c.id = selected_campaign
        and c.status in ('active', 'draft')
        and c.campaign_type = expected_campaign_type
    ) then
      raise exception 'campaign_not_available' using errcode = '22023';
    end if;

    select a.id into existing_assignment_id
    from public.user_campaign_assignments a
    where a.user_id = p_user_id
      and a.campaign_id = selected_campaign
    limit 1;

    if existing_assignment_id is null then
      insert into public.user_campaign_assignments
        (id, user_id, campaign_id, is_active, assigned_at, assigned_by)
      values
        (gen_random_uuid(), p_user_id, selected_campaign, true, now(), p_manager_id);
    else
      update public.user_campaign_assignments a
      set is_active = true, assigned_at = now(), assigned_by = p_manager_id
      where a.id = existing_assignment_id;
    end if;
  end loop;

  return query
    select a.*
    from public.user_campaign_assignments a
    where a.user_id = p_user_id
      and a.is_active = true
    order by a.assigned_at desc;
end;
$function$;

grant execute on function public.set_user_campaign_assignments(text, uuid[], text) to anon, authenticated;
