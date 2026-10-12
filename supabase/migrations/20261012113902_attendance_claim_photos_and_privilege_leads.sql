-- BTL Africa: attendance claims carry the check-in photo and structured activations.
-- Approval materializes the operational rows in the existing shared tables.

alter table public.attendance_claims
  add column if not exists activation_entries jsonb not null default '[]'::jsonb,
  add column if not exists pointage_photo text;

-- Replace the former signature instead of leaving an ambiguous overloaded RPC behind.
drop function if exists public.create_attendance_claim(text, uuid, date, text, text, integer, text, text, text);

create or replace function public.create_attendance_claim(
  p_user_id text,
  p_campaign_id uuid,
  p_claim_date date,
  p_arrival_time text,
  p_departure_time text,
  p_activation_count integer,
  p_activation_details text,
  p_activation_entries jsonb,
  p_closing_comment text,
  p_pointage_photo text default null,
  p_shop_id text default null
)
returns public.attendance_claims
language plpgsql
security definer
set search_path = public
as $function$
declare
  target_category text;
  campaign_code text;
  campaign_status text;
  campaign_start date;
  campaign_end date;
  claim_row public.attendance_claims;
begin
  select u.user_category into target_category
  from public.users u
  where u.id = p_user_id and u.role = 'agent' and u.is_active = true;
  if target_category is null then raise exception 'agent_required' using errcode = '42501'; end if;

  select c.code, c.status, c.starts_on, c.ends_on
    into campaign_code, campaign_status, campaign_start, campaign_end
  from public.campaigns c where c.id = p_campaign_id;
  if campaign_status is null or campaign_status not in ('active', 'draft') then raise exception 'campaign_not_available' using errcode = '22023'; end if;
  if campaign_start is not null and p_claim_date < campaign_start then raise exception 'claim_date_outside_campaign' using errcode = '22023'; end if;
  if campaign_end is not null and p_claim_date > campaign_end then raise exception 'claim_date_outside_campaign' using errcode = '22023'; end if;
  if exists (select 1 from public.campaign_pauses pause where pause.campaign_id = p_campaign_id and p_claim_date between pause.starts_on and pause.ends_on) then raise exception 'campaign_paused_on_claim_date' using errcode = '22023'; end if;
  if not exists (select 1 from public.user_campaign_assignments a where a.user_id = p_user_id and a.campaign_id = p_campaign_id and a.is_active = true)
     and not exists (select 1 from public.agent_campaign_supervisor_assignments scoped where scoped.agent_id = p_user_id and scoped.campaign_id = p_campaign_id and scoped.is_active = true) then raise exception 'campaign_assignment_required' using errcode = '42501'; end if;
  if p_arrival_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_departure_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid_claim_times' using errcode = '22023'; end if;
  if p_activation_count is null or p_activation_count < 0 then raise exception 'invalid_activation_count' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_activation_details, ''))) < 3 and p_activation_count > 0 then raise exception 'activation_details_required' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_closing_comment, ''))) < 3 then raise exception 'closing_comment_required' using errcode = '22023'; end if;

  if campaign_code = 'vodacom-privilege' and target_category = 'hostess' then
    if jsonb_typeof(coalesce(p_activation_entries, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_activation_entries, '[]'::jsonb)) <> p_activation_count then
      raise exception 'activation_entries_count_mismatch' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(p_activation_entries, '[]'::jsonb)) entry
      where btrim(coalesce(entry->>'msisdn', '')) !~ '^(08|09)[0-9]{8}$'
         or btrim(coalesce(entry->>'action_type', '')) = ''
    ) then
      raise exception 'invalid_activation_entry' using errcode = '22023';
    end if;
  end if;

  if target_category = 'hostess' and exists (
    select 1 from public.daily_reports report
    where report.agent_id = p_user_id and report.date = p_claim_date::text
      and (report.campaign_id = p_campaign_id or report.campaign_id is null)
      and (report.arrival_time is not null or report.departure_time is not null or report.pointage_photo is not null)
  ) then raise exception 'attendance_already_exists' using errcode = '23505'; end if;
  if target_category <> 'hostess' and exists (
    select 1 from public.ba_daily_attendance attendance
    join public.campaign_runs run on run.id = attendance.campaign_run_id
    where attendance.ba_id = p_user_id and run.campaign_id = p_campaign_id and attendance.activity_date = p_claim_date
  ) then raise exception 'attendance_already_exists' using errcode = '23505'; end if;

  insert into public.attendance_claims (
    user_id, campaign_id, claim_date, arrival_time, departure_time,
    activation_count, activation_details, activation_entries, closing_comment, pointage_photo, shop_id
  ) values (
    p_user_id, p_campaign_id, p_claim_date, p_arrival_time, p_departure_time,
    p_activation_count, trim(coalesce(p_activation_details, '')), coalesce(p_activation_entries, '[]'::jsonb),
    trim(p_closing_comment), nullif(trim(p_pointage_photo), ''), nullif(trim(p_shop_id), '')
  ) returning * into claim_row;
  return claim_row;
exception when unique_violation then
  raise exception 'attendance_claim_already_submitted' using errcode = '23505';
end;
$function$;

grant execute on function public.create_attendance_claim(text, uuid, date, text, text, integer, text, jsonb, text, text, text) to anon, authenticated;

-- Return the new fields to responsible users and to the requesting agent.
drop function if exists public.list_attendance_claims(text);
create or replace function public.list_attendance_claims(p_viewer_id text)
returns table (
  id uuid, user_id text, campaign_id uuid, claim_date date, arrival_time text, departure_time text,
  activation_count integer, activation_details text, activation_entries jsonb, closing_comment text,
  pointage_photo text, shop_id text, status text, reviewed_at timestamptz, reviewed_by text,
  review_note text, created_at timestamptz, updated_at timestamptz, can_review boolean
)
language plpgsql security definer set search_path = public
as $function$
declare viewer_role text;
begin
  select u.role into viewer_role from public.users u where u.id = p_viewer_id;
  if viewer_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then raise exception 'manager_required' using errcode = '42501'; end if;
  return query
    select r.id, r.user_id, r.campaign_id, r.claim_date, r.arrival_time, r.departure_time,
      r.activation_count, r.activation_details, r.activation_entries, r.closing_comment,
      r.pointage_photo, r.shop_id, r.status, r.reviewed_at, r.reviewed_by, r.review_note,
      r.created_at, r.updated_at,
      (viewer_role in ('admin', 'super_admin', 'sub_admin') or (viewer_role = 'supervisor' and exists (
        select 1 from public.agent_campaign_supervisor_assignments scoped
        where scoped.agent_id = r.user_id and scoped.campaign_id = r.campaign_id
          and scoped.supervisor_id = p_viewer_id and scoped.is_active = true
      ))) as can_review
    from public.attendance_claims r
    where viewer_role in ('admin', 'super_admin', 'sub_admin') or exists (
      select 1 from public.agent_campaign_supervisor_assignments scoped
      where scoped.agent_id = r.user_id and scoped.campaign_id = r.campaign_id
        and scoped.supervisor_id = p_viewer_id and scoped.is_active = true
    )
    order by r.status = 'pending' desc, r.updated_at desc, r.created_at desc;
end;
$function$;

grant execute on function public.list_attendance_claims(text) to anon, authenticated;

drop function if exists public.list_my_attendance_claims(text);
create or replace function public.list_my_attendance_claims(p_agent_id text)
returns table (
  id uuid, user_id text, campaign_id uuid, claim_date date, arrival_time text, departure_time text,
  activation_count integer, activation_details text, activation_entries jsonb, closing_comment text,
  pointage_photo text, shop_id text, status text, reviewed_at timestamptz, reviewed_by text,
  review_note text, created_at timestamptz, updated_at timestamptz, can_review boolean
)
language plpgsql security definer set search_path = public
as $function$
begin
  if not exists (select 1 from public.users u where u.id = p_agent_id and u.role = 'agent') then raise exception 'agent_required' using errcode = '42501'; end if;
  return query
    select r.id, r.user_id, r.campaign_id, r.claim_date, r.arrival_time, r.departure_time,
      r.activation_count, r.activation_details, r.activation_entries, r.closing_comment,
      r.pointage_photo, r.shop_id, r.status, r.reviewed_at, r.reviewed_by, r.review_note,
      r.created_at, r.updated_at, false
    from public.attendance_claims r where r.user_id = p_agent_id
    order by r.claim_date desc, r.created_at desc;
end;
$function$;

grant execute on function public.list_my_attendance_claims(text) to anon, authenticated;

create or replace function public.review_attendance_claim(
  p_claim_id uuid, p_manager_id text, p_status text,
  p_review_note text default null, p_shop_id text default null
)
returns public.attendance_claims
language plpgsql security definer set search_path = public
as $function$
declare
  manager_role text;
  claim_row public.attendance_claims;
  updated_row public.attendance_claims;
  target_category text;
  campaign_code text;
  resolved_shop_id text;
  resolved_shop_name text;
  run_id uuid;
  arrival_at timestamptz;
  departure_at timestamptz;
  generated_report_id text;
  privilege_count integer;
  privilege_count_activations integer;
  privilege_count_roaming integer;
  privilege_count_bundle integer;
begin
  select u.role into manager_role from public.users u where u.id = p_manager_id;
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then raise exception 'attendance_claim_review_forbidden' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'invalid_attendance_claim_status' using errcode = '22023'; end if;
  select * into claim_row from public.attendance_claims where id = p_claim_id for update;
  if not found then raise exception 'attendance_claim_not_found' using errcode = 'P0002'; end if;
  if claim_row.status <> 'pending' then raise exception 'attendance_claim_not_pending' using errcode = 'P0002'; end if;
  if manager_role = 'supervisor' and not exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = claim_row.user_id and scoped.campaign_id = claim_row.campaign_id
      and scoped.supervisor_id = p_manager_id and scoped.is_active = true
  ) then raise exception 'attendance_claim_outside_manager_scope' using errcode = '42501'; end if;
  if p_status = 'rejected' and char_length(trim(coalesce(p_review_note, ''))) < 3 then raise exception 'rejection_note_required' using errcode = '22023'; end if;

  if p_status = 'approved' then
    select u.user_category into target_category from public.users u where u.id = claim_row.user_id and u.role = 'agent';
    if target_category is null then raise exception 'agent_required' using errcode = '22023'; end if;
    select c.code into campaign_code from public.campaigns c where c.id = claim_row.campaign_id;
    resolved_shop_id := nullif(trim(coalesce(p_shop_id, claim_row.shop_id)), '');
    if resolved_shop_id is null then select u.permanent_shop_id into resolved_shop_id from public.users u where u.id = claim_row.user_id; end if;
    if campaign_code = 'vodacom-privilege' and resolved_shop_id is null then raise exception 'privilege_shop_required' using errcode = '22023'; end if;
    if resolved_shop_id is not null and not exists (select 1 from public.shops s where s.id = resolved_shop_id) then raise exception 'shop_not_found' using errcode = '22023'; end if;
    select s.name into resolved_shop_name from public.shops s where s.id = resolved_shop_id;

    if target_category = 'hostess' then
      generated_report_id := 'claim-' || replace(claim_row.id::text, '-', '');
      if campaign_code = 'vodacom-privilege' then
        if jsonb_typeof(claim_row.activation_entries) <> 'array' or jsonb_array_length(claim_row.activation_entries) <> claim_row.activation_count then raise exception 'activation_entries_count_mismatch' using errcode = '22023'; end if;
        if exists (select 1 from jsonb_array_elements(claim_row.activation_entries) entry where btrim(coalesce(entry->>'msisdn', '')) !~ '^(08|09)[0-9]{8}$' or btrim(coalesce(entry->>'action_type', '')) = '') then raise exception 'invalid_activation_entry' using errcode = '22023'; end if;
        insert into public.leads (id, timestamp, agent_id, shop_id, client_name, msisdn, action_type, bundle_type, amount, status)
        select gen_random_uuid()::text, (claim_row.claim_date::text || ' ' || claim_row.arrival_time)::timestamp at time zone 'Africa/Kinshasa', claim_row.user_id, resolved_shop_id, 'Anonyme', btrim(entry->>'msisdn'), btrim(entry->>'action_type'), null, null, 'pending'
        from jsonb_array_elements(claim_row.activation_entries) entry;
        select count(*)::integer into privilege_count_activations from jsonb_array_elements(claim_row.activation_entries) entry where lower(entry->>'action_type') like '%privil%';
        select count(*)::integer into privilege_count_roaming from jsonb_array_elements(claim_row.activation_entries) entry where lower(entry->>'action_type') like '%roam%';
        select count(*)::integer into privilege_count_bundle from jsonb_array_elements(claim_row.activation_entries) entry where lower(entry->>'action_type') like '%bundle%';
        privilege_count := coalesce(privilege_count_activations, 0);
      else
        privilege_count := claim_row.activation_count;
        privilege_count_roaming := 0;
        privilege_count_bundle := 0;
      end if;
      insert into public.daily_reports (
        id, date, agent_id, agent_name, shop_id, shop_name, priv, roam, bund, amount,
        comment, arrival_time, departure_time, pointage_photo, campaign_id, activation_count, activation_details
      )
      select generated_report_id, claim_row.claim_date::text, u.id, u.full_name,
        resolved_shop_id, resolved_shop_name, privilege_count, coalesce(privilege_count_roaming, 0), coalesce(privilege_count_bundle, 0), claim_row.activation_count,
        claim_row.closing_comment, claim_row.arrival_time, claim_row.departure_time, claim_row.pointage_photo,
        claim_row.campaign_id, claim_row.activation_count, claim_row.activation_details
      from public.users u where u.id = claim_row.user_id;
    else
      select run.id into run_id from public.campaign_runs run
      where run.campaign_id = claim_row.campaign_id and claim_row.claim_date between run.starts_on and run.ends_on
      order by case when run.status = 'active' then 0 else 1 end, run.starts_on desc limit 1;
      if run_id is null then raise exception 'campaign_run_required' using errcode = '22023'; end if;
      if exists (select 1 from public.ba_daily_attendance a where a.campaign_run_id = run_id and a.ba_id = claim_row.user_id and a.activity_date = claim_row.claim_date) then raise exception 'attendance_already_exists' using errcode = '23505'; end if;
      arrival_at := (claim_row.claim_date::text || ' ' || claim_row.arrival_time)::timestamp at time zone 'Africa/Kinshasa';
      departure_at := (claim_row.claim_date::text || ' ' || claim_row.departure_time)::timestamp at time zone 'Africa/Kinshasa';
      if departure_at <= arrival_at then raise exception 'invalid_claim_time_order' using errcode = '22023'; end if;
      insert into public.ba_daily_attendance (campaign_run_id, ba_id, activity_date, status, checkin_at, checkin_photo_path, checkout_at, closing_comment, activation_count, activation_details)
      values (run_id, claim_row.user_id, claim_row.claim_date, 'closed', arrival_at, claim_row.pointage_photo, departure_at, claim_row.closing_comment, claim_row.activation_count, claim_row.activation_details);
    end if;
  end if;

  update public.attendance_claims
  set status = p_status, reviewed_at = now(), reviewed_by = p_manager_id,
      review_note = nullif(trim(p_review_note), ''),
      shop_id = case when p_status = 'approved' then coalesce(nullif(trim(p_shop_id), ''), shop_id) else shop_id end,
      updated_at = now()
  where id = claim_row.id returning * into updated_row;
  return updated_row;
end;
$function$;

grant execute on function public.review_attendance_claim(uuid, text, text, text, text) to anon, authenticated;
