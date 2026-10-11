-- BTL Africa: OPS/sub_admin can review attendance claims like admins.
-- Supervisors remain restricted to the agents they supervise operationally by campaign.

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
           (viewer_role in ('admin', 'super_admin', 'sub_admin') or (
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
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
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
      if exists (select 1 from public.ba_daily_attendance a where a.campaign_run_id = run_id and a.ba_id = claim_row.user_id and a.activity_date = claim_row.claim_date) then raise exception 'attendance_already_exists' using errcode = '23505'; end if;
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
