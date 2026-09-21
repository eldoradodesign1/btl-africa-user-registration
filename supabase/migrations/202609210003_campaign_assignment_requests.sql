-- BTL Africa: agent requests for a campaign assignment.
-- Existing schema uses text user ids and uuid campaign ids.

create table if not exists public.campaign_assignment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id),
  campaign_id uuid not null references public.campaigns(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text references public.users(id),
  review_note text
);

create unique index if not exists campaign_assignment_requests_pending_idx
  on public.campaign_assignment_requests (user_id, campaign_id)
  where status = 'pending';

create index if not exists campaign_assignment_requests_status_idx
  on public.campaign_assignment_requests (status, requested_at desc);

alter table public.campaign_assignment_requests enable row level security;
revoke all on table public.campaign_assignment_requests from anon, authenticated;

drop function if exists public.request_campaign_assignment(text, uuid);

create function public.request_campaign_assignment(
  p_user_id text,
  p_campaign_id uuid
)
returns public.campaign_assignment_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  requested public.campaign_assignment_requests;
  target_category text;
  campaign_type text;
begin
  select u.user_category into target_category
  from public.users u
  where u.id = p_user_id and u.role = 'agent';

  if target_category is null then
    raise exception 'agent_required' using errcode = '42501';
  end if;

  select c.campaign_type into campaign_type
  from public.campaigns c
  where c.id = p_campaign_id and c.status in ('active', 'draft');

  if campaign_type is null then
    raise exception 'campaign_not_available' using errcode = '22023';
  end if;

  if campaign_type <> case when target_category = 'hostess' then 'hostess' else 'brand_ambassador' end then
    raise exception 'campaign_category_mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.user_campaign_assignments a
    where a.user_id = p_user_id and a.campaign_id = p_campaign_id and a.is_active = true
  ) then
    raise exception 'already_assigned' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.campaign_assignment_requests r
    where r.user_id = p_user_id and r.campaign_id = p_campaign_id and r.status = 'pending'
  ) then
    select * into requested from public.campaign_assignment_requests r
    where r.user_id = p_user_id and r.campaign_id = p_campaign_id and r.status = 'pending'
    order by r.requested_at desc limit 1;
    return requested;
  end if;

  insert into public.campaign_assignment_requests (user_id, campaign_id)
  values (p_user_id, p_campaign_id)
  returning * into requested;

  return requested;
end;
$function$;

grant execute on function public.request_campaign_assignment(text, uuid) to anon, authenticated;

-- Managers can review requests from supervisors and agents.
drop function if exists public.list_campaign_assignment_requests(text);
drop function if exists public.review_campaign_assignment_request(uuid, text, boolean, text);

create function public.list_campaign_assignment_requests(p_manager_id text)
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
begin
  if not exists (
    select 1 from public.users u
    where u.id = p_manager_id and u.role in ('admin', 'super_admin', 'supervisor')
  ) then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  return query
    select r.id, r.user_id, r.campaign_id, r.status, r.requested_at, r.reviewed_at, r.reviewed_by, r.review_note
    from public.campaign_assignment_requests r
    where r.status = 'pending'
    order by r.requested_at asc;
end;
$function$;

create function public.review_campaign_assignment_request(
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
  if manager_role not in ('admin', 'super_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select * into request_row
  from public.campaign_assignment_requests r
  where r.id = p_request_id and r.status = 'pending'
  for update;

  if not found then
    raise exception 'campaign_request_not_pending' using errcode = 'P0002';
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

grant execute on function public.list_campaign_assignment_requests(text) to anon, authenticated;
grant execute on function public.review_campaign_assignment_request(uuid, text, boolean, text) to anon, authenticated;
