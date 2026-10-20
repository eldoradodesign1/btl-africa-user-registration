-- BTL Africa: fix create_event_campaign when an event includes agents.
-- The previous RPC used agent_id both as a PL/pgSQL variable and as a
-- table-column reference, which caused PostgreSQL error 42702.
create or replace function public.create_event_campaign(
  p_creator_id text,
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
declare
  creator_role text;
  created_campaign public.campaigns;
  outfit_row jsonb;
  v_agent_id text;
begin
  select u.role into creator_role from public.users u where u.id=p_creator_id and u.is_active=true;
  if creator_role is null or creator_role not in ('admin','super_admin','sub_admin') then raise exception 'event_creator_not_allowed' using errcode='42501'; end if;
  if p_event_mode not in ('punctual','periodic') then raise exception 'event_mode_invalid' using errcode='22023'; end if;
  if p_starts_on is null or p_ends_on is null or p_starts_on>p_ends_on then raise exception 'event_dates_invalid' using errcode='22023'; end if;
  if p_event_mode='punctual' and (p_arrival_time is null or p_departure_time is null) then raise exception 'event_times_required' using errcode='22023'; end if;
  if p_event_mode='punctual' and p_arrival_time>p_departure_time then raise exception 'event_time_window_invalid' using errcode='22023'; end if;
  if p_supervisor_id is not null and not exists(select 1 from public.users u where u.id=p_supervisor_id and u.role in ('supervisor','sub_admin','admin','super_admin') and u.is_active) then raise exception 'event_supervisor_invalid' using errcode='22023'; end if;
  insert into public.campaigns(code,name,campaign_type,status,starts_on,ends_on,event_mode,event_arrival_time,event_departure_time,event_supervisor_id,event_perimeter)
  values(lower(trim(p_code)),trim(p_name),'event','active',p_starts_on,p_ends_on,p_event_mode,p_arrival_time,p_departure_time,p_supervisor_id,'photo_gps_arrival_departure') returning * into created_campaign;
  if p_event_mode='punctual' then
    insert into public.event_days(campaign_id,event_date,arrival_from,arrival_until,departure_from,departure_until)
    select created_campaign.id,d::date,p_arrival_time,p_arrival_time,p_departure_time,p_departure_time from generate_series(p_starts_on::timestamp,p_ends_on::timestamp,interval '1 day') d;
  end if;
  foreach v_agent_id in array coalesce(p_agent_ids,'{}') loop
    if exists(select 1 from public.users u where u.id=v_agent_id and u.role='agent' and u.is_active) then
      insert into public.user_campaign_assignments(user_id,campaign_id,is_active,assigned_at,assigned_by)
      values(v_agent_id,created_campaign.id,true,now(),p_creator_id)
      on conflict(user_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_creator_id;
      if p_supervisor_id is not null then
        insert into public.agent_campaign_supervisor_assignments(agent_id,supervisor_id,campaign_id,is_active,assigned_at,assigned_by)
        values(v_agent_id,p_supervisor_id,created_campaign.id,true,now(),p_creator_id)
        on conflict(agent_id,supervisor_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_creator_id;
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_outfit_items)<>'array' then raise exception 'event_outfit_invalid' using errcode='22023'; end if;
  for outfit_row in select value from jsonb_array_elements(p_outfit_items) loop
    if nullif(trim(outfit_row->>'key'),'') is not null and nullif(trim(outfit_row->>'label'),'') is not null then
      insert into public.event_outfit_items(campaign_id,item_key,item_label,provided_by_company)
      values(created_campaign.id,trim(outfit_row->>'key'),trim(outfit_row->>'label'),coalesce((outfit_row->>'provided_by_company')::boolean,true));
    end if;
  end loop;
  return created_campaign;
exception when unique_violation then raise exception 'event_code_already_exists' using errcode='23505';
end;
$function$;
grant execute on function public.create_event_campaign(text,text,text,date,date,text,time,time,text,text[],jsonb) to anon,authenticated;
notify pgrst,'reload schema';
