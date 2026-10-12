-- BTL Africa: integrate sick/non-working attendance resolutions.
-- The existing five-argument review RPC remains available for older clients.

create or replace function public.list_campaign_attendance_overrides(
  p_viewer_id text,
  p_campaign_id uuid,
  p_agent_id text default null
)
returns table (
  id uuid,
  campaign_id uuid,
  agent_id text,
  activity_date date,
  status text,
  reason text,
  created_by text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  viewer_role text;
begin
  select u.role into viewer_role from public.users u where u.id = p_viewer_id;
  if viewer_role is null then raise exception 'viewer_required' using errcode = '42501'; end if;
  if viewer_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor', 'agent') then
    raise exception 'attendance_override_forbidden' using errcode = '42501';
  end if;
  if viewer_role = 'agent' and coalesce(p_agent_id, p_viewer_id) <> p_viewer_id then
    raise exception 'attendance_override_forbidden' using errcode = '42501';
  end if;

  return query
  select o.id, o.campaign_id, o.agent_id, o.activity_date, o.status, o.reason,
    o.created_by, o.created_at, o.updated_at
  from public.campaign_attendance_overrides o
  where o.campaign_id = p_campaign_id
    and (p_agent_id is null or o.agent_id = p_agent_id)
    and (
      viewer_role in ('admin', 'super_admin', 'sub_admin')
      or o.agent_id = p_viewer_id
      or exists (
        select 1
        from public.agent_campaign_supervisor_assignments scoped
        where scoped.agent_id = o.agent_id
          and scoped.campaign_id = o.campaign_id
          and scoped.supervisor_id = p_viewer_id
          and scoped.is_active = true
      )
    )
  order by o.activity_date;
end;
$function$;

grant execute on function public.list_campaign_attendance_overrides(text, uuid, text) to anon, authenticated;

drop function if exists public.review_attendance_claim(uuid, text, text, text, text, text);
create function public.review_attendance_claim(
  p_claim_id uuid,
  p_manager_id text,
  p_status text,
  p_review_note text default null,
  p_shop_id text default null,
  p_attendance_status text default null
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
  if manager_role not in ('admin', 'super_admin', 'sub_admin', 'supervisor') then
    raise exception 'attendance_claim_review_forbidden' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid_attendance_claim_status' using errcode = '22023';
  end if;
  if p_attendance_status is not null and p_attendance_status not in ('sick', 'non_working') then
    raise exception 'invalid_attendance_override_status' using errcode = '22023';
  end if;
  if p_status = 'rejected' and p_attendance_status is not null then
    raise exception 'attendance_override_requires_approval' using errcode = '22023';
  end if;

  select * into claim_row from public.attendance_claims where id = p_claim_id for update;
  if not found then raise exception 'attendance_claim_not_found' using errcode = 'P0002'; end if;
  if claim_row.status <> 'pending' then raise exception 'attendance_claim_not_pending' using errcode = 'P0002'; end if;
  if manager_role = 'supervisor' and not exists (
    select 1 from public.agent_campaign_supervisor_assignments scoped
    where scoped.agent_id = claim_row.user_id
      and scoped.campaign_id = claim_row.campaign_id
      and scoped.supervisor_id = p_manager_id
      and scoped.is_active = true
  ) then raise exception 'attendance_claim_outside_manager_scope' using errcode = '42501'; end if;
  if (p_status = 'rejected' or p_attendance_status is not null)
     and char_length(trim(coalesce(p_review_note, ''))) < 3 then
    raise exception 'review_note_required' using errcode = '22023';
  end if;

  if p_status = 'approved' then
    select u.user_category into target_category
    from public.users u where u.id = claim_row.user_id and u.role = 'agent';
    if target_category is null then raise exception 'agent_required' using errcode = '22023'; end if;

    select c.code into campaign_code from public.campaigns c where c.id = claim_row.campaign_id;

    if p_attendance_status is not null then
      insert into public.campaign_attendance_overrides (
        campaign_id, agent_id, activity_date, status, reason, created_by
      ) values (
        claim_row.campaign_id, claim_row.user_id, claim_row.claim_date,
        p_attendance_status, trim(p_review_note), p_manager_id
      )
      on conflict (campaign_id, agent_id, activity_date) do update set
        status = excluded.status,
        reason = excluded.reason,
        created_by = excluded.created_by,
        updated_at = now();
    else
      delete from public.campaign_attendance_overrides
      where campaign_id = claim_row.campaign_id
        and agent_id = claim_row.user_id
        and activity_date = claim_row.claim_date;

      resolved_shop_id := nullif(trim(coalesce(p_shop_id, claim_row.shop_id)), '');
      if resolved_shop_id is null then
        select u.permanent_shop_id into resolved_shop_id from public.users u where u.id = claim_row.user_id;
      end if;
      if campaign_code = 'vodacom-privilege' and resolved_shop_id is null then
        raise exception 'privilege_shop_required' using errcode = '22023';
      end if;
      if resolved_shop_id is not null and not exists (select 1 from public.shops s where s.id = resolved_shop_id) then
        raise exception 'shop_not_found' using errcode = '22023';
      end if;
      select s.name into resolved_shop_name from public.shops s where s.id = resolved_shop_id;

      if target_category = 'hostess' then
        generated_report_id := 'claim-' || replace(claim_row.id::text, '-', '');
        if campaign_code = 'vodacom-privilege' then
          if jsonb_typeof(claim_row.activation_entries) <> 'array'
             or jsonb_array_length(claim_row.activation_entries) <> claim_row.activation_count then
            raise exception 'activation_entries_count_mismatch' using errcode = '22023';
          end if;
          if exists (
            select 1 from jsonb_array_elements(claim_row.activation_entries) entry
            where btrim(coalesce(entry->>'msisdn', '')) !~ '^(08|09)[0-9]{8}$'
               or btrim(coalesce(entry->>'action_type', '')) = ''
          ) then raise exception 'invalid_activation_entry' using errcode = '22023'; end if;
          insert into public.leads (id, timestamp, agent_id, shop_id, client_name, msisdn, action_type, bundle_type, amount, status)
          select gen_random_uuid()::text,
            (claim_row.claim_date::text || ' ' || claim_row.arrival_time)::timestamp at time zone 'Africa/Kinshasa',
            claim_row.user_id, resolved_shop_id, 'Anonyme', btrim(entry->>'msisdn'),
            btrim(entry->>'action_type'), null, null, 'pending'
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
          resolved_shop_id, resolved_shop_name, privilege_count, coalesce(privilege_count_roaming, 0),
          coalesce(privilege_count_bundle, 0), claim_row.activation_count, claim_row.closing_comment,
          claim_row.arrival_time, claim_row.departure_time, claim_row.pointage_photo,
          claim_row.campaign_id, claim_row.activation_count, claim_row.activation_details
        from public.users u where u.id = claim_row.user_id;
      else
        select run.id into run_id from public.campaign_runs run
        where run.campaign_id = claim_row.campaign_id
          and claim_row.claim_date between run.starts_on and run.ends_on
        order by case when run.status = 'active' then 0 else 1 end, run.starts_on desc limit 1;
        if run_id is null then raise exception 'campaign_run_required' using errcode = '22023'; end if;
        if exists (
          select 1 from public.ba_daily_attendance a
          where a.campaign_run_id = run_id and a.ba_id = claim_row.user_id and a.activity_date = claim_row.claim_date
        ) then raise exception 'attendance_already_exists' using errcode = '23505'; end if;
        arrival_at := (claim_row.claim_date::text || ' ' || claim_row.arrival_time)::timestamp at time zone 'Africa/Kinshasa';
        departure_at := (claim_row.claim_date::text || ' ' || claim_row.departure_time)::timestamp at time zone 'Africa/Kinshasa';
        if departure_at <= arrival_at then raise exception 'invalid_claim_time_order' using errcode = '22023'; end if;
        insert into public.ba_daily_attendance (
          campaign_run_id, ba_id, activity_date, status, checkin_at, checkin_photo_path,
          checkout_at, closing_comment, activation_count, activation_details
        ) values (
          run_id, claim_row.user_id, claim_row.claim_date, 'closed', arrival_at,
          claim_row.pointage_photo, departure_at, claim_row.closing_comment,
          claim_row.activation_count, claim_row.activation_details
        );
      end if;
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

grant execute on function public.review_attendance_claim(uuid, text, text, text, text, text) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'campaign_attendance_overrides'
  ) then
    alter publication supabase_realtime add table public.campaign_attendance_overrides;
  end if;
end
$$;
