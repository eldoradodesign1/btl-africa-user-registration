-- BTL Africa: campaign claim cases with threaded messages, workflow statuses and audit events.
-- Run after 202609220012_campaign_claims.sql and 202609230002_campaign_claims_supervision.sql.

alter table public.campaign_claims
  add column if not exists priority text not null default 'normal',
  add column if not exists category text not null default 'other',
  add column if not exists assigned_to text references public.users(id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_message_at timestamptz,
  add column if not exists resolved_at timestamptz;

alter table public.campaign_claims
  drop constraint if exists campaign_claims_status_check;
alter table public.campaign_claims
  add constraint campaign_claims_status_check
  check (status in ('pending', 'acknowledged', 'in_review', 'awaiting_agent', 'resolved', 'rejected'));

alter table public.campaign_claims
  drop constraint if exists campaign_claims_priority_check;
alter table public.campaign_claims
  add constraint campaign_claims_priority_check
  check (priority in ('low', 'normal', 'high', 'critical'));

alter table public.campaign_claims
  drop constraint if exists campaign_claims_category_check;
alter table public.campaign_claims
  add constraint campaign_claims_category_check
  check (category in ('attendance', 'payment', 'performance', 'technical', 'assignment', 'other'));

create index if not exists campaign_claims_status_updated_at_idx
  on public.campaign_claims (status, updated_at desc);

create table if not exists public.campaign_claim_messages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.campaign_claims(id) on delete cascade,
  author_id text not null references public.users(id),
  body text not null check (char_length(trim(body)) >= 1),
  visibility text not null default 'shared' check (visibility in ('shared', 'internal')),
  message_type text not null default 'message' check (message_type in ('message', 'request_information', 'status_change', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists campaign_claim_messages_claim_created_idx
  on public.campaign_claim_messages (claim_id, created_at asc);

create table if not exists public.campaign_claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.campaign_claims(id) on delete cascade,
  actor_id text not null references public.users(id),
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists campaign_claim_events_claim_created_idx
  on public.campaign_claim_events (claim_id, created_at asc);

create table if not exists public.campaign_claim_reads (
  claim_id uuid not null references public.campaign_claims(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (claim_id, user_id)
);

alter table public.campaign_claim_messages enable row level security;
alter table public.campaign_claim_events enable row level security;
alter table public.campaign_claim_reads enable row level security;
revoke all on table public.campaign_claim_messages from anon, authenticated;
revoke all on table public.campaign_claim_events from anon, authenticated;
revoke all on table public.campaign_claim_reads from anon, authenticated;

drop function if exists public.create_campaign_claim(text, uuid, text);
create function public.create_campaign_claim(
  p_user_id text,
  p_campaign_id uuid,
  p_description text,
  p_priority text default 'normal',
  p_category text default 'other'
)
returns public.campaign_claims
language plpgsql
security definer
set search_path = public
as $function$
declare
  claim_row public.campaign_claims;
begin
  if not exists (select 1 from public.users u where u.id = p_user_id and u.role = 'agent') then
    raise exception 'agent_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_campaign_assignments a
    join public.campaigns c on c.id = a.campaign_id
    where a.user_id = p_user_id and a.campaign_id = p_campaign_id and a.is_active = true
      and c.status in ('active', 'draft')
  ) and not exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    join public.campaigns c on c.id = scoped.campaign_id
    where scoped.agent_id = p_user_id and scoped.campaign_id = p_campaign_id and scoped.is_active = true
      and c.status in ('active', 'draft')
  ) then
    raise exception 'campaign_assignment_required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_description, ''))) < 3 then
    raise exception 'claim_description_required' using errcode = '22023';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'critical') then
    raise exception 'invalid_claim_priority' using errcode = '22023';
  end if;
  if p_category not in ('attendance', 'payment', 'performance', 'technical', 'assignment', 'other') then
    raise exception 'invalid_claim_category' using errcode = '22023';
  end if;

  insert into public.campaign_claims (user_id, campaign_id, description, priority, category, status, updated_at)
  values (p_user_id, p_campaign_id, trim(p_description), p_priority, p_category, 'pending', now())
  returning * into claim_row;
  insert into public.campaign_claim_events (claim_id, actor_id, from_status, to_status, note)
  values (claim_row.id, p_user_id, null, 'pending', 'Dossier créé par l’agent');
  return claim_row;
end;
$function$;

grant execute on function public.create_campaign_claim(text, uuid, text, text, text) to anon, authenticated;

drop function if exists public.list_campaign_claims(text);
create function public.list_campaign_claims(p_manager_id text)
returns table (
  id uuid,
  user_id text,
  campaign_id uuid,
  description text,
  status text,
  priority text,
  category text,
  assigned_to text,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  last_message_at timestamptz,
  resolved_at timestamptz
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
    select r.id, r.user_id, r.campaign_id, r.description, r.status, r.priority, r.category,
           r.assigned_to, r.created_at, r.updated_at, r.reviewed_at, r.reviewed_by,
           r.review_note, r.last_message_at, r.resolved_at
    from public.campaign_claims r
    where (
        manager_role in ('admin', 'super_admin', 'sub_admin')
        or exists (
          select 1 from public.agent_campaign_supervisor_assignments scoped
          where scoped.agent_id = r.user_id and scoped.campaign_id = r.campaign_id
            and scoped.supervisor_id = p_manager_id and scoped.is_active = true
        )
        or exists (
          select 1 from public.users agent
          where agent.id = r.user_id and agent.supervisor_id = p_manager_id
        )
      )
    order by r.updated_at desc, r.created_at desc;
end;
$function$;

grant execute on function public.list_campaign_claims(text) to anon, authenticated;

create or replace function public.list_my_campaign_claims(p_agent_id text)
returns table (
  id uuid,
  user_id text,
  campaign_id uuid,
  description text,
  status text,
  priority text,
  category text,
  assigned_to text,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  last_message_at timestamptz,
  resolved_at timestamptz,
  unread_count bigint
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.users u where u.id = p_agent_id and u.role = 'agent') then
    raise exception 'agent_required' using errcode = '42501';
  end if;

  return query
    select r.id, r.user_id, r.campaign_id, r.description, r.status, r.priority, r.category,
           r.assigned_to, r.created_at, r.updated_at, r.reviewed_at, r.reviewed_by,
           r.review_note, r.last_message_at, r.resolved_at,
           count(m.id) filter (
             where m.visibility = 'shared' and m.author_id <> p_agent_id
               and m.created_at > coalesce(reads.read_at, '-infinity'::timestamptz)
           ) as unread_count
    from public.campaign_claims r
    left join public.campaign_claim_messages m on m.claim_id = r.id
    left join public.campaign_claim_reads reads on reads.claim_id = r.id and reads.user_id = p_agent_id
    where r.user_id = p_agent_id
    group by r.id, reads.read_at
    order by r.updated_at desc, r.created_at desc;
end;
$function$;

grant execute on function public.list_my_campaign_claims(text) to anon, authenticated;

create or replace function public.claim_manager_can_access(p_manager_id text, p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  manager_role text;
  claim_row public.campaign_claims;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id;
  select * into claim_row from public.campaign_claims where id = p_claim_id;
  if claim_row.id is null then return false; end if;
  if manager_role in ('admin', 'super_admin', 'sub_admin') then return true; end if;
  if manager_role <> 'supervisor' then return false; end if;
  return exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = claim_row.user_id and scoped.campaign_id = claim_row.campaign_id
      and scoped.supervisor_id = p_manager_id and scoped.is_active = true
  ) or exists (
    select 1 from public.users agent where agent.id = claim_row.user_id and agent.supervisor_id = p_manager_id
  );
end;
$function$;

revoke all on function public.claim_manager_can_access(text, uuid) from public;
grant execute on function public.claim_manager_can_access(text, uuid) to anon, authenticated;

create or replace function public.list_campaign_claim_messages(p_viewer_id text, p_claim_id uuid)
returns table (
  id uuid,
  claim_id uuid,
  author_id text,
  body text,
  visibility text,
  message_type text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  viewer_role text;
  claim_owner text;
begin
  select u.role into viewer_role from public.users u where u.id = p_viewer_id;
  select r.user_id into claim_owner from public.campaign_claims r where r.id = p_claim_id;
  if claim_owner is null then raise exception 'claim_not_found' using errcode = 'P0002'; end if;
  if p_viewer_id <> claim_owner and not public.claim_manager_can_access(p_viewer_id, p_claim_id) then
    raise exception 'claim_access_denied' using errcode = '42501';
  end if;

  return query
    select m.id, m.claim_id, m.author_id, m.body, m.visibility, m.message_type, m.created_at
    from public.campaign_claim_messages m
    where m.claim_id = p_claim_id
      and (p_viewer_id <> claim_owner or m.visibility = 'shared')
    order by m.created_at asc;
end;
$function$;

grant execute on function public.list_campaign_claim_messages(text, uuid) to anon, authenticated;

create or replace function public.add_campaign_claim_message(
  p_author_id text,
  p_claim_id uuid,
  p_body text,
  p_visibility text default 'shared',
  p_message_type text default 'message'
)
returns public.campaign_claim_messages
language plpgsql
security definer
set search_path = public
as $function$
declare
  claim_owner text;
  author_role text;
  message_row public.campaign_claim_messages;
begin
  select r.user_id into claim_owner from public.campaign_claims r where r.id = p_claim_id;
  select u.role into author_role from public.users u where u.id = p_author_id;
  if claim_owner is null then raise exception 'claim_not_found' using errcode = 'P0002'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 1 then raise exception 'message_required' using errcode = '22023'; end if;
  if p_visibility not in ('shared', 'internal') then raise exception 'invalid_message_visibility' using errcode = '22023'; end if;
  if p_message_type not in ('message', 'request_information', 'status_change', 'system') then raise exception 'invalid_message_type' using errcode = '22023'; end if;
  if p_author_id <> claim_owner and not public.claim_manager_can_access(p_author_id, p_claim_id) then
    raise exception 'claim_access_denied' using errcode = '42501';
  end if;
  if author_role = 'agent' and (p_author_id <> claim_owner or p_visibility <> 'shared') then
    raise exception 'agent_message_restricted' using errcode = '42501';
  end if;

  insert into public.campaign_claim_messages (claim_id, author_id, body, visibility, message_type)
  values (p_claim_id, p_author_id, trim(p_body), p_visibility, p_message_type)
  returning * into message_row;

  update public.campaign_claims
  set updated_at = now(), last_message_at = now(),
      status = case when p_author_id = claim_owner and status = 'awaiting_agent' then 'in_review' else status end
  where id = p_claim_id;
  return message_row;
end;
$function$;

grant execute on function public.add_campaign_claim_message(text, uuid, text, text, text) to anon, authenticated;

create or replace function public.transition_campaign_claim(
  p_claim_id uuid,
  p_manager_id text,
  p_to_status text,
  p_note text default null
)
returns public.campaign_claims
language plpgsql
security definer
set search_path = public
as $function$
declare
  claim_row public.campaign_claims;
  updated_row public.campaign_claims;
  normalized_status text := case when p_to_status = 'acknowledged' then 'in_review' else p_to_status end;
begin
  if not public.claim_manager_can_access(p_manager_id, p_claim_id) then
    raise exception 'claim_access_denied' using errcode = '42501';
  end if;
  if normalized_status not in ('pending', 'in_review', 'awaiting_agent', 'resolved', 'rejected') then
    raise exception 'invalid_claim_status' using errcode = '22023';
  end if;

  select * into claim_row from public.campaign_claims where id = p_claim_id for update;
  if not found then raise exception 'claim_not_found' using errcode = 'P0002'; end if;

  update public.campaign_claims
  set status = normalized_status,
      updated_at = now(),
      reviewed_at = case when normalized_status in ('resolved', 'rejected') then now() else reviewed_at end,
      reviewed_by = case when normalized_status in ('resolved', 'rejected') then p_manager_id else reviewed_by end,
      resolved_at = case when normalized_status in ('resolved', 'rejected') then now() else null end,
      review_note = case when nullif(trim(coalesce(p_note, '')), '') is not null then trim(p_note) else review_note end
  where id = p_claim_id
  returning * into updated_row;

  insert into public.campaign_claim_events (claim_id, actor_id, from_status, to_status, note)
  values (p_claim_id, p_manager_id, claim_row.status, normalized_status, nullif(trim(p_note), ''));

  if nullif(trim(coalesce(p_note, '')), '') is not null then
    insert into public.campaign_claim_messages (claim_id, author_id, body, visibility, message_type)
    values (p_claim_id, p_manager_id, trim(p_note), 'shared',
            case when normalized_status = 'awaiting_agent' then 'request_information' else 'status_change' end);
    update public.campaign_claims set last_message_at = now(), updated_at = now() where id = p_claim_id;
    select * into updated_row from public.campaign_claims where id = p_claim_id;
  end if;

  return updated_row;
end;
$function$;

grant execute on function public.transition_campaign_claim(uuid, text, text, text) to anon, authenticated;

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
begin
  return public.transition_campaign_claim(p_claim_id, p_manager_id, p_status, p_review_note);
end;
$function$;

grant execute on function public.review_campaign_claim(uuid, text, text, text) to anon, authenticated;

create or replace function public.mark_campaign_claim_read(p_user_id text, p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.campaign_claims r where r.id = p_claim_id and r.user_id = p_user_id) then
    raise exception 'claim_access_denied' using errcode = '42501';
  end if;
  insert into public.campaign_claim_reads (claim_id, user_id, read_at)
  values (p_claim_id, p_user_id, now())
  on conflict (claim_id, user_id) do update set read_at = excluded.read_at;
end;
$function$;

grant execute on function public.mark_campaign_claim_read(text, uuid) to anon, authenticated;
