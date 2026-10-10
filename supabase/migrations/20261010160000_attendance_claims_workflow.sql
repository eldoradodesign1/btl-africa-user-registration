-- BTL Africa: replace the former campaign-claim case workflow with
-- date-based attendance claims that materialize approved attendance/report rows.

-- Remove the former workflow from Realtime before dropping its tables.
do $migration$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_claims') then
    alter publication supabase_realtime drop table public.campaign_claims;
  end if;
end;
$migration$;

-- Remove all former claim RPC overloads before dropping their dependent tables.
drop function if exists public.create_campaign_claim(text, uuid, text);
drop function if exists public.create_campaign_claim(text, uuid, text, text, text);
drop function if exists public.list_campaign_claims(text);
drop function if exists public.list_my_campaign_claims(text);
drop function if exists public.claim_manager_can_access(text, uuid);
drop function if exists public.list_campaign_claim_messages(text, uuid);
drop function if exists public.add_campaign_claim_message(text, uuid, text, text, text);
drop function if exists public.transition_campaign_claim(uuid, text, text, text);
drop function if exists public.review_campaign_claim(uuid, text, text, text);
drop function if exists public.mark_campaign_claim_read(text, uuid);

-- The old data and its complete audit trail are intentionally removed.
drop table if exists public.campaign_claim_reads cascade;
drop table if exists public.campaign_claim_events cascade;
drop table if exists public.campaign_claim_messages cascade;
drop table if exists public.campaign_claims cascade;

-- Keep approved claims tied to the campaign that generated the report. Existing
-- historical reports remain valid because the new columns are nullable.
alter table public.daily_reports
  add column if not exists campaign_id uuid references public.campaigns(id),
  add column if not exists activation_count integer not null default 0,
  add column if not exists activation_details text;

alter table public.ba_daily_attendance
  add column if not exists activation_count integer not null default 0,
  add column if not exists activation_details text;

create table public.attendance_claims (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id),
  campaign_id uuid not null references public.campaigns(id),
  claim_date date not null,
  arrival_time text not null,
  departure_time text not null,
  activation_count integer not null default 0 check (activation_count >= 0),
  activation_details text not null check (char_length(trim(activation_details)) >= 3),
  closing_comment text not null check (char_length(trim(closing_comment)) >= 3),
  shop_id text references public.shops(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by text references public.users(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, campaign_id, claim_date)
);

create index attendance_claims_status_created_at_idx
  on public.attendance_claims (status, created_at desc);
create index attendance_claims_campaign_date_idx
  on public.attendance_claims (campaign_id, claim_date desc);
create index attendance_claims_user_idx
  on public.attendance_claims (user_id, created_at desc);

alter table public.attendance_claims enable row level security;
revoke all on table public.attendance_claims from anon, authenticated;

-- Publish the new notification source through Realtime.
do $migration$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_claims') then
    alter publication supabase_realtime add table public.attendance_claims;
  end if;
end;
$migration$;

create or replace function public.create_attendance_claim(
  p_user_id text,
  p_campaign_id uuid,
  p_claim_date date,
  p_arrival_time text,
  p_departure_time text,
  p_activation_count integer,
  p_activation_details text,
  p_closing_comment text,
  p_shop_id text default null
)
returns public.attendance_claims
language plpgsql
security definer
set search_path = public
as $function$
declare
  target_category text;
  campaign_status text;
  campaign_start date;
  campaign_end date;
  claim_row public.attendance_claims;
begin
  select u.user_category into target_category
  from public.users u
  where u.id = p_user_id and u.role = 'agent' and u.is_active = true;
  if target_category is null then
    raise exception 'agent_required' using errcode = '42501';
  end if;

  select c.status, c.starts_on, c.ends_on
    into campaign_status, campaign_start, campaign_end
  from public.campaigns c
  where c.id = p_campaign_id;
  if campaign_status is null or campaign_status not in ('active', 'draft') then
    raise exception 'campaign_not_available' using errcode = '22023';
  end if;
  if campaign_start is not null and p_claim_date < campaign_start then
    raise exception 'claim_date_outside_campaign' using errcode = '22023';
  end if;
  if campaign_end is not null and p_claim_date > campaign_end then
    raise exception 'claim_date_outside_campaign' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.campaign_pauses pause
    where pause.campaign_id = p_campaign_id
      and p_claim_date between pause.starts_on and pause.ends_on
  ) then
    raise exception 'campaign_paused_on_claim_date' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.user_campaign_assignments a
    where a.user_id = p_user_id and a.campaign_id = p_campaign_id and a.is_active = true
  ) and not exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = p_user_id and scoped.campaign_id = p_campaign_id and scoped.is_active = true
  ) then
    raise exception 'campaign_assignment_required' using errcode = '42501';
  end if;

  if p_arrival_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or p_departure_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_claim_times' using errcode = '22023';
  end if;
  if p_activation_count is null or p_activation_count < 0 then
    raise exception 'invalid_activation_count' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_activation_details, ''))) < 3 then
    raise exception 'activation_details_required' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_closing_comment, ''))) < 3 then
    raise exception 'closing_comment_required' using errcode = '22023';
  end if;

  -- A claim is only valid for a genuinely absent day. A previous pointage or
  -- report must be corrected through the existing operational data flow.
  if target_category = 'hostess' and exists (
    select 1 from public.daily_reports report
    where report.agent_id = p_user_id and report.date = p_claim_date::text
      and (report.campaign_id = p_campaign_id or report.campaign_id is null)
      and (report.arrival_time is not null or report.departure_time is not null or report.pointage_photo is not null)
  ) then
    raise exception 'attendance_already_exists' using errcode = '23505';
  end if;
  if target_category <> 'hostess' and exists (
    select 1
    from public.ba_daily_attendance attendance
    join public.campaign_runs run on run.id = attendance.campaign_run_id
    where attendance.ba_id = p_user_id and run.campaign_id = p_campaign_id and attendance.activity_date = p_claim_date
  ) then
    raise exception 'attendance_already_exists' using errcode = '23505';
  end if;

  insert into public.attendance_claims (
    user_id, campaign_id, claim_date, arrival_time, departure_time,
    activation_count, activation_details, closing_comment, shop_id
  ) values (
    p_user_id, p_campaign_id, p_claim_date, p_arrival_time, p_departure_time,
    p_activation_count, trim(p_activation_details), trim(p_closing_comment), nullif(trim(p_shop_id), '')
  ) returning * into claim_row;
  return claim_row;
exception
  when unique_violation then
    raise exception 'attendance_claim_already_submitted' using errcode = '23505';
end;
$function$;

grant execute on function public.create_attendance_claim(text, uuid, date, text, text, integer, text, text, text) to anon, authenticated;

create or replace function public.list_attendance_claims(p_viewer_id text)
returns table (
  id uuid,
  user_id text,
  campaign_id uuid,
  claim_date date,
  arrival_time text,
  departure_time text,
  activation_count integer,
  activation_details text,
  closing_comment text,
  shop_id text,
  status text,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  created_at timestamptz,
  updated_at timestamptz,
  can_review boolean
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  viewer_role text;
begin
  select u.role into viewer_role from public.users u where u.id = p_viewer_id;
  if viewer_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'manager_required' using errcode = '42501';
  end if;

  return query
    select r.id, r.user_id, r.campaign_id, r.claim_date, r.arrival_time, r.departure_time,
           r.activation_count, r.activation_details, r.closing_comment, r.shop_id,
           r.status, r.reviewed_at, r.reviewed_by, r.review_note, r.created_at, r.updated_at,
           (viewer_role in ('admin', 'super_admin') or (
             viewer_role = 'supervisor' and exists (
               select 1 from public.agent_campaign_supervisor_assignments scoped
               where scoped.agent_id = r.user_id and scoped.campaign_id = r.campaign_id
                 and scoped.supervisor_id = p_viewer_id and scoped.is_active = true
             )
           )) as can_review
    from public.attendance_claims r
    where viewer_role in ('admin', 'super_admin', 'sub_admin')
       or exists (
         select 1 from public.agent_campaign_supervisor_assignments scoped
         where scoped.agent_id = r.user_id and scoped.campaign_id = r.campaign_id
           and scoped.supervisor_id = p_viewer_id and scoped.is_active = true
       )
    order by r.status = 'pending' desc, r.updated_at desc, r.created_at desc;
end;
$function$;

grant execute on function public.list_attendance_claims(text) to anon, authenticated;

create or replace function public.list_my_attendance_claims(p_agent_id text)
returns table (
  id uuid,
  user_id text,
  campaign_id uuid,
  claim_date date,
  arrival_time text,
  departure_time text,
  activation_count integer,
  activation_details text,
  closing_comment text,
  shop_id text,
  status text,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  created_at timestamptz,
  updated_at timestamptz,
  can_review boolean
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
    select r.id, r.user_id, r.campaign_id, r.claim_date, r.arrival_time, r.departure_time,
           r.activation_count, r.activation_details, r.closing_comment, r.shop_id,
           r.status, r.reviewed_at, r.reviewed_by, r.review_note, r.created_at, r.updated_at,
           false
    from public.attendance_claims r
    where r.user_id = p_agent_id
    order by r.claim_date desc, r.created_at desc;
end;
$function$;

grant execute on function public.list_my_attendance_claims(text) to anon, authenticated;

create or replace function public.review_attendance_claim(
  p_claim_id uuid,
  p_manager_id text,
  p_status text,
  p_review_note text default null,
  p_shop_id text default null
)
returns public.attendance_claims
language plpgsql
security definer
set search_path = public
as $function$
declare
  manager_role text;
  claim_row public.attendance_claims;
  updated_row public.attendance_claims;
  target_category text;
  resolved_shop_id text;
  resolved_shop_name text;
  run_id uuid;
  arrival_at timestamptz;
  departure_at timestamptz;
  generated_report_id text;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id;
  if manager_role not in ('admin', 'super_admin', 'supervisor') then
    raise exception 'attendance_claim_review_forbidden' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid_attendance_claim_status' using errcode = '22023';
  end if;

  select * into claim_row from public.attendance_claims where id = p_claim_id for update;
  if not found then raise exception 'attendance_claim_not_found' using errcode = 'P0002'; end if;
  if claim_row.status <> 'pending' then raise exception 'attendance_claim_not_pending' using errcode = 'P0002'; end if;

  if manager_role = 'supervisor' and not exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = claim_row.user_id and scoped.campaign_id = claim_row.campaign_id
      and scoped.supervisor_id = p_manager_id and scoped.is_active = true
  ) then
    raise exception 'attendance_claim_outside_manager_scope' using errcode = '42501';
  end if;

  if p_status = 'rejected' and char_length(trim(coalesce(p_review_note, ''))) < 3 then
    raise exception 'rejection_note_required' using errcode = '22023';
  end if;

  if p_status = 'approved' then
    select u.user_category into target_category from public.users u where u.id = claim_row.user_id and u.role = 'agent';
    if target_category is null then raise exception 'agent_required' using errcode = '22023'; end if;
    resolved_shop_id := nullif(trim(coalesce(p_shop_id, claim_row.shop_id)), '');
    if resolved_shop_id is null then
      select u.permanent_shop_id into resolved_shop_id from public.users u where u.id = claim_row.user_id;
    end if;
    if resolved_shop_id is not null and not exists (select 1 from public.shops s where s.id = resolved_shop_id) then
      raise exception 'shop_not_found' using errcode = '22023';
    end if;
    select s.name into resolved_shop_name from public.shops s where s.id = resolved_shop_id;

    if target_category = 'hostess' then
      generated_report_id := 'claim-' || replace(claim_row.id::text, '-', '');
      insert into public.daily_reports (
        id, date, agent_id, agent_name, shop_id, shop_name, priv, roam, bund, amount,
        comment, arrival_time, departure_time, campaign_id, activation_count, activation_details
      )
      select generated_report_id, claim_row.claim_date::text, u.id, u.full_name,
             resolved_shop_id, resolved_shop_name, 0, 0, 0, 0,
             claim_row.closing_comment, claim_row.arrival_time, claim_row.departure_time,
             claim_row.campaign_id, claim_row.activation_count, claim_row.activation_details
      from public.users u where u.id = claim_row.user_id;
    else
      select run.id into run_id
      from public.campaign_runs run
      where run.campaign_id = claim_row.campaign_id
        and claim_row.claim_date between run.starts_on and run.ends_on
      order by case when run.status = 'active' then 0 else 1 end, run.starts_on desc
      limit 1;
      if run_id is null then raise exception 'campaign_run_required' using errcode = '22023'; end if;
      if exists (select 1 from public.ba_daily_attendance a where a.campaign_run_id = run_id and a.ba_id = claim_row.user_id and a.activity_date = claim_row.claim_date) then
        raise exception 'attendance_already_exists' using errcode = '23505';
      end if;
      arrival_at := (claim_row.claim_date::text || ' ' || claim_row.arrival_time)::timestamp at time zone 'Africa/Kinshasa';
      departure_at := (claim_row.claim_date::text || ' ' || claim_row.departure_time)::timestamp at time zone 'Africa/Kinshasa';
      if departure_at <= arrival_at then raise exception 'invalid_claim_time_order' using errcode = '22023'; end if;
      insert into public.ba_daily_attendance (
        campaign_run_id, ba_id, activity_date, status, checkin_at, checkout_at,
        closing_comment, activation_count, activation_details
      ) values (
        run_id, claim_row.user_id, claim_row.claim_date, 'closed', arrival_at, departure_at,
        claim_row.closing_comment, claim_row.activation_count, claim_row.activation_details
      );
    end if;
  end if;

  update public.attendance_claims
  set status = p_status,
      reviewed_at = now(),
      reviewed_by = p_manager_id,
      review_note = nullif(trim(p_review_note), ''),
      shop_id = case when p_status = 'approved' then coalesce(nullif(trim(p_shop_id), ''), shop_id) else shop_id end,
      updated_at = now()
  where id = claim_row.id
  returning * into updated_row;
  return updated_row;
end;
$function$;

grant execute on function public.review_attendance_claim(uuid, text, text, text, text) to anon, authenticated;
