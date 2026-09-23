-- BTL Africa: route campaign claims through campaign-scoped supervision.
-- Run after 202609220012_campaign_claims.sql and 202609230001_campaign_supervisor_assignments.sql.

create or replace function public.create_campaign_claim(
  p_user_id text,
  p_campaign_id uuid,
  p_description text
)
returns public.campaign_claims
language plpgsql
security definer
set search_path = public
as $function$
declare
  claim_row public.campaign_claims;
begin
  if not exists (
    select 1 from public.users u
    where u.id = p_user_id and u.role = 'agent'
  ) then
    raise exception 'agent_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.user_campaign_assignments a
    join public.campaigns c on c.id = a.campaign_id
    where a.user_id = p_user_id
      and a.campaign_id = p_campaign_id
      and a.is_active = true
      and c.status in ('active', 'draft')
  ) and not exists (
    select 1
    from public.agent_campaign_supervisor_assignments scoped
    join public.campaigns c on c.id = scoped.campaign_id
    where scoped.agent_id = p_user_id
      and scoped.campaign_id = p_campaign_id
      and scoped.is_active = true
      and c.status in ('active', 'draft')
  ) then
    raise exception 'campaign_assignment_required' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_description, ''))) < 3 then
    raise exception 'claim_description_required' using errcode = '22023';
  end if;

  insert into public.campaign_claims (user_id, campaign_id, description)
  values (p_user_id, p_campaign_id, trim(p_description))
  returning * into claim_row;

  return claim_row;
end;
$function$;

grant execute on function public.create_campaign_claim(text, uuid, text) to anon, authenticated;

create or replace function public.list_campaign_claims(p_manager_id text)
returns table (
  id uuid,
  user_id text,
  campaign_id uuid,
  description text,
  status text,
  created_at timestamptz,
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
    select r.id, r.user_id, r.campaign_id, r.description, r.status,
           r.created_at, r.reviewed_at, r.reviewed_by, r.review_note
    from public.campaign_claims r
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
        or exists (
          select 1 from public.users agent
          where agent.id = r.user_id and agent.supervisor_id = p_manager_id
        )
      )
    order by r.created_at asc;
end;
$function$;

grant execute on function public.list_campaign_claims(text) to anon, authenticated;

create or replace function public.review_campaign_claim(
  p_claim_id uuid,
  p_manager_id text,
  p_status text,
  p_review_note text default null
)
returns public.campaign_claims
language plpgsql
security definer
set search_path = public
as $function$
declare
  manager_role text;
  claim_row public.campaign_claims;
  reviewed public.campaign_claims;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id;
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'campaign_manager_required' using errcode = '42501';
  end if;
  if p_status not in ('acknowledged', 'resolved', 'rejected') then
    raise exception 'invalid_claim_status' using errcode = '22023';
  end if;

  select * into claim_row
  from public.campaign_claims r
  where r.id = p_claim_id and r.status = 'pending'
  for update;
  if not found then
    raise exception 'claim_not_pending' using errcode = 'P0002';
  end if;

  if manager_role = 'supervisor' and not exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = claim_row.user_id
      and scoped.campaign_id = claim_row.campaign_id
      and scoped.supervisor_id = p_manager_id
      and scoped.is_active = true
  ) and not exists (
    select 1 from public.users agent
    where agent.id = claim_row.user_id and agent.supervisor_id = p_manager_id
  ) then
    raise exception 'claim_outside_manager_scope' using errcode = '42501';
  end if;

  update public.campaign_claims r
  set status = p_status,
      reviewed_at = now(),
      reviewed_by = p_manager_id,
      review_note = nullif(trim(p_review_note), '')
  where r.id = p_claim_id
  returning * into reviewed;

  return reviewed;
end;
$function$;

grant execute on function public.review_campaign_claim(uuid, text, text, text) to anon, authenticated;
