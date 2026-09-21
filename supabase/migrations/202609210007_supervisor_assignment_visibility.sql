-- BTL Africa: direct supervisors only see requests from their own agents.
-- This migration is incremental for projects that already ran 202609210003.

create or replace function public.list_campaign_assignment_requests(p_manager_id text)
returns table (
  id uuid,
  user_id text,
  campaign_id uuid,
  status text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  manager_role text;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id;

  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  return query
    select r.id, r.user_id, r.campaign_id, r.status, r.requested_at, r.reviewed_at, r.reviewed_by, r.review_note
    from public.campaign_assignment_requests r
    where r.status = 'pending'
      and (
        manager_role in ('admin', 'super_admin', 'sub_admin')
        or exists (
          select 1
          from public.users agent
          where agent.id = r.user_id
            and agent.supervisor_id = p_manager_id
        )
      )
    order by r.requested_at asc;
end;
$function$;

grant execute on function public.list_campaign_assignment_requests(text) to anon, authenticated;

create or replace function public.review_campaign_assignment_request(
  p_request_id uuid,
  p_manager_id text,
  p_approve boolean,
  p_review_note text default null
)
returns public.campaign_assignment_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  manager_role text;
  request_row public.campaign_assignment_requests;
  reviewed public.campaign_assignment_requests;
  target_category text;
  expected_campaign_type text;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id;
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select * into request_row
  from public.campaign_assignment_requests r
  where r.id = p_request_id and r.status = 'pending'
    and (
      manager_role in ('admin', 'super_admin', 'sub_admin')
      or exists (
        select 1 from public.users agent
        where agent.id = r.user_id and agent.supervisor_id = p_manager_id
      )
    )
  for update;

  if not found then
    raise exception 'campaign_request_not_pending_or_forbidden' using errcode = '42501';
  end if;

  if p_approve then
    select u.user_category into target_category from public.users u where u.id = request_row.user_id and u.role = 'agent';
    expected_campaign_type := case when target_category = 'hostess' then 'hostess' else 'brand_ambassador' end;
    if target_category is null then
      raise exception 'agent_required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.campaigns c where c.id = request_row.campaign_id and c.status in ('active', 'draft') and c.campaign_type = expected_campaign_type) then
      raise exception 'campaign_category_mismatch' using errcode = '22023';
    end if;

    if exists (select 1 from public.user_campaign_assignments a where a.user_id = request_row.user_id and a.campaign_id = request_row.campaign_id) then
      update public.user_campaign_assignments a
      set is_active = true, assigned_at = now(), assigned_by = p_manager_id
      where a.user_id = request_row.user_id and a.campaign_id = request_row.campaign_id;
    else
      insert into public.user_campaign_assignments (id, user_id, campaign_id, is_active, assigned_at, assigned_by)
      values (gen_random_uuid(), request_row.user_id, request_row.campaign_id, true, now(), p_manager_id);
    end if;
  end if;

  update public.campaign_assignment_requests r
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = p_manager_id,
      review_note = nullif(trim(p_review_note), '')
  where r.id = p_request_id
  returning * into reviewed;

  return reviewed;
end;
$function$;

grant execute on function public.review_campaign_assignment_request(uuid, text, boolean, text) to anon, authenticated;

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
  select u.role into manager_role from public.users u where u.id = p_manager_id;
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select u.role, u.user_category into target_role, target_category from public.users u where u.id = p_user_id;
  if target_role is distinct from 'agent' or target_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth') then
    raise exception 'campaigns_are_for_agents_only' using errcode = '22023';
  end if;

  expected_campaign_type := case when target_category = 'hostess' then 'hostess' else 'brand_ambassador' end;
  update public.user_campaign_assignments a
  set is_active = false
  where a.user_id = p_user_id and a.is_active = true
    and not (a.campaign_id = any(coalesce(p_campaign_ids, '{}'::uuid[])));

  foreach selected_campaign in array coalesce(p_campaign_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.campaigns c where c.id = selected_campaign and c.status in ('active', 'draft') and c.campaign_type = expected_campaign_type) then
      raise exception 'campaign_not_available' using errcode = '22023';
    end if;
    select a.id into existing_assignment_id from public.user_campaign_assignments a where a.user_id = p_user_id and a.campaign_id = selected_campaign limit 1;
    if existing_assignment_id is null then
      insert into public.user_campaign_assignments (id, user_id, campaign_id, is_active, assigned_at, assigned_by)
      values (gen_random_uuid(), p_user_id, selected_campaign, true, now(), p_manager_id);
    else
      update public.user_campaign_assignments a set is_active = true, assigned_at = now(), assigned_by = p_manager_id where a.id = existing_assignment_id;
    end if;
  end loop;

  return query select a.* from public.user_campaign_assignments a where a.user_id = p_user_id and a.is_active = true order by a.assigned_at desc;
end;
$function$;

grant execute on function public.set_user_campaign_assignments(text, uuid[], text) to anon, authenticated;
