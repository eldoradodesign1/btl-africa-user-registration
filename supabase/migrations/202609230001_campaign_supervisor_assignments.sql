-- BTL Africa: campaign-scoped agent/supervisor assignments.
--
-- This migration keeps public.users.supervisor_id as the historical
-- "introduced me to the agency" relationship. Operational supervision is
-- stored in public.agent_campaign_supervisor_assignments.

create extension if not exists pgcrypto;

create table if not exists public.agent_campaign_supervisor_assignments (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.users(id) on delete cascade,
  supervisor_id text not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by text references public.users(id),
  constraint agent_campaign_supervisor_not_self check (agent_id <> supervisor_id)
);

create index if not exists agent_campaign_supervisor_agent_campaign_idx
  on public.agent_campaign_supervisor_assignments (agent_id, campaign_id, is_active);

create index if not exists agent_campaign_supervisor_supervisor_campaign_idx
  on public.agent_campaign_supervisor_assignments (supervisor_id, campaign_id, is_active);

grant select on public.agent_campaign_supervisor_assignments to anon, authenticated;

alter table public.agent_campaign_supervisor_assignments enable row level security;
do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_campaign_supervisor_assignments'
      and policyname = 'campaign_supervisor_assignments_read'
  ) then
    create policy campaign_supervisor_assignments_read
      on public.agent_campaign_supervisor_assignments
      for select
      to anon, authenticated
      using (true);
  end if;
end;
$policy$;
--
-- Temporary account requested for the initial data cleanup:
--   Sam / admin / 0890000000 / password: admin
-- Replace the phone and password from the application as soon as they are known.

create or replace function public.sync_agent_campaign_supervisor_assignments(
  p_agent_id text,
  p_assignments jsonb,
  p_manager_id text
)
returns setof public.agent_campaign_supervisor_assignments
language plpgsql
security definer
set search_path = public
as $function$
declare
  manager_role text;
  target_role text;
  assignment_item jsonb;
  selected_campaign uuid;
  selected_supervisor text;
  existing_id uuid;
  expected_campaign_type text;
  submitted_campaign_ids uuid[] := '{}'::uuid[];
begin
  select u.role into manager_role
  from public.users u
  where u.id = p_manager_id;

  if manager_role not in ('supervisor', 'sub_admin', 'admin', 'super_admin') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select u.role into target_role
  from public.users u
  where u.id = p_agent_id;

  if target_role is distinct from 'agent' then
    raise exception 'campaigns_are_for_agents_only' using errcode = '22023';
  end if;

  if manager_role = 'supervisor' and not exists (
    select 1
    from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = p_agent_id
      and scoped.supervisor_id = p_manager_id
      and scoped.is_active = true
  ) then
    raise exception 'campaign_supervisor_required' using errcode = '42501';
  end if;

  -- The submitted payload is an array of objects:
  -- [{"campaign_id":"uuid", "supervisor_ids":["text", "text"]}]
  for assignment_item in
    select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    selected_campaign := (assignment_item ->> 'campaign_id')::uuid;
    submitted_campaign_ids := array_append(submitted_campaign_ids, selected_campaign);

    select case when u.user_category = 'hostess' then 'hostess' else 'brand_ambassador' end
      into expected_campaign_type
    from public.users u
    where u.id = p_agent_id;

    if not exists (
      select 1
      from public.campaigns c
      where c.id = selected_campaign
        and c.status in ('active', 'draft')
        and c.campaign_type = expected_campaign_type
    ) then
      raise exception 'campaign_not_available' using errcode = '22023';
    end if;

    -- Keep the legacy campaign membership table synchronized for existing UI
    -- and reporting consumers while the new table remains the source of truth
    -- for operational supervisors.
    select a.id into existing_id
    from public.user_campaign_assignments a
    where a.user_id = p_agent_id
      and a.campaign_id = selected_campaign
    limit 1;

    if existing_id is null then
      insert into public.user_campaign_assignments
        (id, user_id, campaign_id, is_active, assigned_at, assigned_by)
      values
        (gen_random_uuid(), p_agent_id, selected_campaign, true, now(), p_manager_id);
    else
      update public.user_campaign_assignments a
      set is_active = true, assigned_at = now(), assigned_by = p_manager_id
      where a.id = existing_id;
    end if;

    -- A campaign may have one or several operational supervisors.
    for selected_supervisor in
      select value from jsonb_array_elements_text(coalesce(assignment_item -> 'supervisor_ids', '[]'::jsonb))
    loop
      if selected_supervisor = p_agent_id then
        raise exception 'agent_cannot_supervise_self' using errcode = '22023';
      end if;

      if not exists (
        select 1
        from public.users u
        where u.id = selected_supervisor
          and u.role in ('supervisor', 'sub_admin', 'admin', 'super_admin')
      ) then
        raise exception 'invalid_campaign_supervisor' using errcode = '22023';
      end if;

      select a.id into existing_id
      from public.agent_campaign_supervisor_assignments a
      where a.agent_id = p_agent_id
        and a.supervisor_id = selected_supervisor
        and a.campaign_id = selected_campaign
      limit 1;

      if existing_id is null then
        insert into public.agent_campaign_supervisor_assignments
          (id, agent_id, supervisor_id, campaign_id, is_active, assigned_at, assigned_by)
        values
          (gen_random_uuid(), p_agent_id, selected_supervisor, selected_campaign, true, now(), p_manager_id);
      else
        update public.agent_campaign_supervisor_assignments a
        set is_active = true, assigned_at = now(), assigned_by = p_manager_id
        where a.id = existing_id;
      end if;
    end loop;

    update public.agent_campaign_supervisor_assignments a
    set is_active = false
    where a.agent_id = p_agent_id
      and a.campaign_id = selected_campaign
      and a.is_active = true
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(assignment_item -> 'supervisor_ids', '[]'::jsonb)) selected(value)
        where selected.value = a.supervisor_id
      );
  end loop;

  -- Anything omitted from the submitted campaign list is no longer active.
  update public.user_campaign_assignments a
  set is_active = false
  where a.user_id = p_agent_id
    and a.is_active = true
    and not (a.campaign_id = any(submitted_campaign_ids));

  update public.agent_campaign_supervisor_assignments a
  set is_active = false
  where a.agent_id = p_agent_id
    and a.is_active = true
    and not (a.campaign_id = any(submitted_campaign_ids));

  return query
    select a.*
    from public.agent_campaign_supervisor_assignments a
    where a.agent_id = p_agent_id
      and a.is_active = true
    order by a.assigned_at desc;
end;
$function$;

grant execute on function public.sync_agent_campaign_supervisor_assignments(text, jsonb, text) to anon, authenticated;

-- Create the temporary administrative profile only if it does not exist yet.
insert into public.users (
  id, full_name, phone, password_hash, role, user_category,
  supervisor_id, permanent_shop_id
)
select
  'sam-admin', 'Sam', '0890000000', 'admin', 'admin', 'operations',
  null, null
where not exists (
  select 1 from public.users u where u.id = 'sam-admin' or u.phone = '0890000000'
);

-- Historical agency-entry supervisor links supplied by the owner.
-- These updates intentionally use existing database identifiers only.
update public.users set supervisor_id = 'sam-admin'
where id in (
  'michael-admin',
  'adm-0001-4a11-a881-100000000001',
  'daniel-sub-admin',
  'arnold-koma-sub-admin',
  'benedicte-mondo-sub-admin',
  'sup-0001-4a11-a881-100000000002'
);

update public.users set supervisor_id = 'adm-0001-4a11-a881-100000000001'
where id in (
  '0a6a2520-96bb-474d-87b6-b0eb8fc46cd6',
  'sup-0001-4a11-a881-100000000001',
  'usr-youth-alpha-okito'
);

update public.users set supervisor_id = '0a6a2520-96bb-474d-87b6-b0eb8fc46cd6'
where id in (
  'usr-8d3144f8',
  'usr-youth-844059251'
);

-- Abel, Shekina and Deborah Mukendi were not found by their supplied names
-- in the current database export. They are deliberately not guessed here and
-- can be assigned from the in-app supervisor selector once identified.

comment on column public.users.supervisor_id is
  'Historical supervisor who introduced the user to the agency; operational campaign supervision lives in agent_campaign_supervisor_assignments.';

comment on table public.agent_campaign_supervisor_assignments is
  'Operational agent supervision, scoped by campaign; an agent may have multiple supervisors for one campaign.';

-- Campaign assignment requests follow the operational supervisor relation.
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
          from public.agent_campaign_supervisor_assignments scoped
          where scoped.agent_id = r.user_id
            and scoped.campaign_id = r.campaign_id
            and scoped.supervisor_id = p_manager_id
            and scoped.is_active = true
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
  existing_supervisor_assignment_id uuid;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id;
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;

  select * into request_row
  from public.campaign_assignment_requests r
  where r.id = p_request_id and r.status = 'pending'
  for update;
  if not found then
    raise exception 'campaign_request_not_pending' using errcode = 'P0002';
  end if;

  if manager_role = 'supervisor' and not exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = request_row.user_id
      and scoped.campaign_id = request_row.campaign_id
      and scoped.supervisor_id = p_manager_id
      and scoped.is_active = true
  ) then
    raise exception 'campaign_supervisor_required' using errcode = '42501';
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

    -- A supervisor who approves a request becomes an active supervisor for
    -- that agent on this campaign, without disturbing other supervisors.
    if manager_role = 'supervisor' then
      select scoped.id into existing_supervisor_assignment_id
      from public.agent_campaign_supervisor_assignments scoped
      where scoped.agent_id = request_row.user_id
        and scoped.campaign_id = request_row.campaign_id
        and scoped.supervisor_id = p_manager_id
      limit 1;
      if existing_supervisor_assignment_id is null then
        insert into public.agent_campaign_supervisor_assignments
          (id, agent_id, supervisor_id, campaign_id, is_active, assigned_at, assigned_by)
        values
          (gen_random_uuid(), request_row.user_id, p_manager_id, request_row.campaign_id, true, now(), p_manager_id);
      else
        update public.agent_campaign_supervisor_assignments scoped
        set is_active = true, assigned_at = now(), assigned_by = p_manager_id
        where scoped.id = existing_supervisor_assignment_id;
      end if;
    end if;
  end if;

  update public.campaign_assignment_requests r
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = p_manager_id,
      review_note = nullif(trim(p_review_note), '')
  where r.id = request_row.id
  returning * into reviewed;
  return reviewed;
end;
$function$;

grant execute on function public.review_campaign_assignment_request(uuid, text, boolean, text) to anon, authenticated;
