-- BTL Africa: reversible management controls for events.
-- Pauses reuse the shared campaign_pauses table already consumed by attendance calendars.

create or replace function public.update_event_campaign(
  p_actor_id text,
  p_campaign_id uuid,
  p_code text,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_event_mode text,
  p_arrival_time time default null,
  p_departure_time time default null,
  p_supervisor_id text default null,
  p_agent_ids text[] default '{}',
  p_outfit_items jsonb default '[]'::jsonb
)
returns public.campaigns
language plpgsql security definer set search_path=public
as $function$
declare actor_role text; updated_campaign public.campaigns; selected_agent text; outfit_row jsonb;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin','sub_admin') then raise exception 'event_editor_not_allowed' using errcode='42501'; end if;
  if not exists(select 1 from public.campaigns where id=p_campaign_id and campaign_type='event') then raise exception 'event_required' using errcode='22023'; end if;
  if p_code !~ '^[a-z0-9][a-z0-9-]{2,79}$' or char_length(trim(p_name)) < 2 then raise exception 'event_identity_invalid' using errcode='22023'; end if;
  if p_starts_on is null or p_ends_on is null or p_starts_on > p_ends_on then raise exception 'event_dates_invalid' using errcode='22023'; end if;
  if p_event_mode not in ('punctual','periodic') then raise exception 'event_mode_invalid' using errcode='22023'; end if;
  if p_event_mode='punctual' and (p_arrival_time is null or p_departure_time is null or p_arrival_time > p_departure_time) then raise exception 'event_times_invalid' using errcode='22023'; end if;
  if p_supervisor_id is not null and not exists(select 1 from public.users where id=p_supervisor_id and role in ('supervisor','sub_admin','admin','super_admin') and is_active) then raise exception 'event_supervisor_invalid' using errcode='22023'; end if;
  update public.campaigns set code=lower(trim(p_code)), name=trim(p_name), starts_on=p_starts_on, ends_on=p_ends_on, event_mode=p_event_mode, event_arrival_time=p_arrival_time, event_departure_time=p_departure_time, event_supervisor_id=p_supervisor_id, event_perimeter='photo_gps_arrival_departure', updated_at=now() where id=p_campaign_id returning * into updated_campaign;
  if p_event_mode='punctual' then
    delete from public.event_days where campaign_id=p_campaign_id;
    insert into public.event_days(campaign_id,event_date,arrival_from,arrival_until,departure_from,departure_until,created_by)
    select p_campaign_id,d::date,p_arrival_time,p_arrival_time,p_departure_time,p_departure_time,p_actor_id from generate_series(p_starts_on::timestamp,p_ends_on::timestamp,interval '1 day') d;
  end if;
  update public.user_campaign_assignments set is_active=false where campaign_id=p_campaign_id and user_id not in (select unnest(coalesce(p_agent_ids,'{}')));
  update public.agent_campaign_supervisor_assignments set is_active=false where campaign_id=p_campaign_id;
  foreach selected_agent in array coalesce(p_agent_ids,'{}') loop
    if exists(select 1 from public.users where id=selected_agent and role='agent' and is_active) then
      insert into public.user_campaign_assignments(user_id,campaign_id,is_active,assigned_at,assigned_by) values(selected_agent,p_campaign_id,true,now(),p_actor_id) on conflict(user_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_actor_id;
      if p_supervisor_id is not null then insert into public.agent_campaign_supervisor_assignments(agent_id,supervisor_id,campaign_id,is_active,assigned_at,assigned_by) values(selected_agent,p_supervisor_id,p_campaign_id,true,now(),p_actor_id) on conflict(agent_id,supervisor_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_actor_id; end if;
    end if;
  end loop;
  if jsonb_typeof(p_outfit_items)<>'array' then raise exception 'event_outfit_invalid' using errcode='22023'; end if;
  delete from public.event_outfit_items where campaign_id=p_campaign_id and item_key not in (select coalesce(value->>'key','') from jsonb_array_elements(p_outfit_items));
  for outfit_row in select value from jsonb_array_elements(p_outfit_items) loop
    insert into public.event_outfit_items(campaign_id,item_key,item_label,provided_by_company) values(p_campaign_id,trim(outfit_row->>'key'),trim(outfit_row->>'label'),coalesce((outfit_row->>'provided_by_company')::boolean,true)) on conflict(campaign_id,item_key) do update set item_label=excluded.item_label,provided_by_company=excluded.provided_by_company,updated_at=now();
  end loop;
  return updated_campaign;
exception when unique_violation then raise exception 'event_code_already_exists' using errcode='23505';
end;
$function$;
grant execute on function public.update_event_campaign(text,uuid,text,text,date,date,text,time,time,text,text[],jsonb) to anon,authenticated;

create or replace function public.set_event_status(p_actor_id text,p_campaign_id uuid,p_status text)
returns public.campaigns
language plpgsql security definer set search_path=public
as $function$
declare actor_role text; row_campaign public.campaigns;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin','sub_admin') then raise exception 'event_status_not_allowed' using errcode='42501'; end if;
  if p_status not in ('active','stopped') then raise exception 'event_status_invalid' using errcode='22023'; end if;
  update public.campaigns set status=p_status,updated_at=now() where id=p_campaign_id returning * into row_campaign;
  if row_campaign.id is null then raise exception 'campaign_not_found' using errcode='P0002'; end if;
  return row_campaign;
end;
$function$;
grant execute on function public.set_event_status(text,uuid,text) to anon,authenticated;

create or replace function public.pause_event_campaign(p_actor_id text,p_campaign_id uuid,p_starts_on date,p_ends_on date,p_reason text default null)
returns boolean
language plpgsql security definer set search_path=public
as $function$
declare actor_role text;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin','sub_admin') then raise exception 'event_pause_not_allowed' using errcode='42501'; end if;
  if p_starts_on is null or p_ends_on is null or p_starts_on>p_ends_on then raise exception 'pause_dates_invalid' using errcode='22023'; end if;
  if not exists(select 1 from public.campaigns where id=p_campaign_id) then raise exception 'campaign_not_found' using errcode='P0002'; end if;
  insert into public.campaign_pauses(campaign_id,starts_on,ends_on,reason,created_by) values(p_campaign_id,p_starts_on,p_ends_on,coalesce(nullif(trim(p_reason),''),'Pause opérationnelle'),p_actor_id);
  return true;
end;
$function$;
grant execute on function public.pause_event_campaign(text,uuid,date,date,text) to anon,authenticated;

create or replace function public.resume_event_campaign(p_actor_id text,p_campaign_id uuid)
returns boolean
language plpgsql security definer set search_path=public
as $function$
declare actor_role text; pause_id uuid;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin','sub_admin') then raise exception 'event_resume_not_allowed' using errcode='42501'; end if;
  select id into pause_id from public.campaign_pauses where campaign_id=p_campaign_id and starts_on<=current_date and ends_on>=current_date order by created_at desc limit 1;
  if pause_id is null then return false; end if;
  delete from public.campaign_pauses where id=pause_id;
  return true;
end;
$function$;
grant execute on function public.resume_event_campaign(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
