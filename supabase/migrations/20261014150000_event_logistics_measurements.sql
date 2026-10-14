-- BTL Africa: event logistics, outfit selection and agent measurements.
-- This migration extends the existing shared schema without changing legacy campaign assignment tables.

alter table public.users
  add column if not exists shirt_size text,
  add column if not exists jacket_size text,
  add column if not exists skirt_size text,
  add column if not exists dress_size text,
  add column if not exists heel_size text,
  add column if not exists sneaker_size text,
  add column if not exists ballerina_size text;

alter table public.campaigns
  add column if not exists event_mode text,
  add column if not exists event_arrival_time time,
  add column if not exists event_departure_time time,
  add column if not exists event_supervisor_id text references public.users(id),
  add column if not exists event_perimeter text;

update public.campaigns
set event_mode = coalesce(event_mode, 'periodic'),
    event_perimeter = coalesce(event_perimeter, 'photo_gps_arrival_departure')
where campaign_type = 'event';

alter table public.campaigns
  drop constraint if exists campaigns_event_mode_check,
  add constraint campaigns_event_mode_check check (event_mode is null or event_mode in ('punctual', 'periodic'));

create table if not exists public.event_outfit_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  item_key text not null,
  item_label text not null,
  provided_by_company boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_outfit_campaign_item_unique unique (campaign_id, item_key)
);
create index if not exists event_outfit_items_campaign_idx on public.event_outfit_items(campaign_id);
alter table public.event_outfit_items enable row level security;
revoke all on table public.event_outfit_items from anon, authenticated;

-- Recreate the event creation RPC with the complete logistics contract.
drop function if exists public.create_event_campaign(text, text, text, date, date, jsonb);
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
language plpgsql security definer set search_path = public
as $function$
declare
  creator_role text;
  created_campaign public.campaigns;
  outfit_row jsonb;
  agent_id text;
begin
  select role into creator_role from public.users where id = p_creator_id and is_active = true;
  if creator_role is null or creator_role not in ('admin','super_admin','sub_admin') then
    raise exception 'event_creator_not_allowed' using errcode='42501';
  end if;
  if p_event_mode not in ('punctual','periodic') then raise exception 'event_mode_invalid' using errcode='22023'; end if;
  if p_starts_on is null or p_ends_on is null or p_starts_on > p_ends_on then raise exception 'event_dates_invalid' using errcode='22023'; end if;
  if p_event_mode = 'punctual' and (p_arrival_time is null or p_departure_time is null) then raise exception 'event_times_required' using errcode='22023'; end if;
  if p_event_mode = 'punctual' and p_arrival_time > p_departure_time then raise exception 'event_time_window_invalid' using errcode='22023'; end if;
  if p_supervisor_id is not null and not exists (select 1 from public.users where id=p_supervisor_id and role in ('supervisor','sub_admin','admin','super_admin') and is_active) then raise exception 'event_supervisor_invalid' using errcode='22023'; end if;

  insert into public.campaigns(code,name,campaign_type,status,starts_on,ends_on,event_mode,event_arrival_time,event_departure_time,event_supervisor_id,event_perimeter)
  values(lower(trim(p_code)),trim(p_name),'event','active',p_starts_on,p_ends_on,p_event_mode,p_arrival_time,p_departure_time,p_supervisor_id,'photo_gps_arrival_departure')
  returning * into created_campaign;

  if p_event_mode = 'punctual' then
    insert into public.event_days(campaign_id,event_date,arrival_from,arrival_until,departure_from,departure_until)
    select created_campaign.id, d::date, p_arrival_time, p_arrival_time, p_departure_time, p_departure_time
    from generate_series(p_starts_on::timestamp, p_ends_on::timestamp, interval '1 day') d;
  end if;

  foreach agent_id in array coalesce(p_agent_ids, '{}') loop
    if exists (select 1 from public.users where id=agent_id and role='agent' and is_active) then
      insert into public.user_campaign_assignments(user_id,campaign_id,is_active,assigned_at,assigned_by)
      values(agent_id,created_campaign.id,true,now(),p_creator_id)
      on conflict (user_id,campaign_id) do update set is_active=true, assigned_at=now(), assigned_by=p_creator_id;
      if p_supervisor_id is not null then
        insert into public.agent_campaign_supervisor_assignments(agent_id,supervisor_id,campaign_id,is_active,assigned_at,assigned_by)
        values(agent_id,p_supervisor_id,created_campaign.id,true,now(),p_creator_id)
        on conflict (agent_id,supervisor_id,campaign_id) do update set is_active=true, assigned_at=now(), assigned_by=p_creator_id;
      end if;
    end if;
  end loop;

  if jsonb_typeof(p_outfit_items) <> 'array' then raise exception 'event_outfit_invalid' using errcode='22023'; end if;
  for outfit_row in select value from jsonb_array_elements(p_outfit_items) loop
    if nullif(trim(outfit_row->>'key'),'') is not null and nullif(trim(outfit_row->>'label'),'') is not null then
      insert into public.event_outfit_items(campaign_id,item_key,item_label,provided_by_company)
      values(created_campaign.id,trim(outfit_row->>'key'),trim(outfit_row->>'label'),coalesce((outfit_row->>'provided_by_company')::boolean,true));
    end if;
  end loop;
  return created_campaign;
exception when unique_violation then
  raise exception 'event_code_already_exists' using errcode='23505';
end;
$function$;
grant execute on function public.create_event_campaign(text,text,text,date,date,text,time,time,text,text[],jsonb) to anon, authenticated;

create or replace function public.list_event_outfit_items(p_campaign_id uuid)
returns table(id uuid,campaign_id uuid,item_key text,item_label text,provided_by_company boolean)
language sql security definer set search_path=public as $function$
  select id,campaign_id,item_key,item_label,provided_by_company from public.event_outfit_items where campaign_id=p_campaign_id order by item_label;
$function$;
grant execute on function public.list_event_outfit_items(uuid) to anon, authenticated;

create or replace function public.set_event_outfit_supply(p_actor_id text,p_campaign_id uuid,p_item_key text,p_provided_by_company boolean)
returns boolean
language plpgsql security definer set search_path=public as $function$
begin
  if not exists(select 1 from public.users where id=p_actor_id and role in ('admin','super_admin','sub_admin') and is_active) then raise exception 'event_supply_not_allowed' using errcode='42501'; end if;
  update public.event_outfit_items set provided_by_company=p_provided_by_company, updated_at=now() where campaign_id=p_campaign_id and item_key=p_item_key;
  return found;
end;
$function$;
grant execute on function public.set_event_outfit_supply(text,uuid,text,boolean) to anon, authenticated;

-- Add measurements to the existing password-confirmed profile RPC.
drop function if exists public.update_my_profile(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision);
create or replace function public.update_my_profile(
  p_user_id text,p_full_name text,p_phone text,p_password text default null,p_avatar_url text default null,
  p_current_password text default null,p_address text default null,p_address_province text default null,p_address_commune text default null,
  p_address_quartier text default null,p_address_avenue text default null,p_address_number text default null,p_address_latitude double precision default null,p_address_longitude double precision default null,
  p_shirt_size text default null,p_jacket_size text default null,p_skirt_size text default null,p_dress_size text default null,p_heel_size text default null,p_sneaker_size text default null,p_ballerina_size text default null
)
returns table(id text,full_name text,phone text,role text,user_category text,supervisor_id text,permanent_shop_id text,avatar_url text,address text,address_province text,address_commune text,address_quartier text,address_avenue text,address_number text,address_latitude double precision,address_longitude double precision,shirt_size text,jacket_size text,skirt_size text,dress_size text,heel_size text,sneaker_size text,ballerina_size text,profile_updated_at timestamptz)
language plpgsql security definer set search_path=public as $function$
declare current_password text;
begin
  select password_hash into current_password from public.users where id=p_user_id for update;
  if current_password is null or p_current_password is null or current_password<>p_current_password then raise exception 'current_password_invalid' using errcode='42501'; end if;
  if char_length(trim(p_full_name))<2 then raise exception 'full_name_invalid' using errcode='22023'; end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then raise exception 'phone_invalid' using errcode='22023'; end if;
  update public.users set full_name=trim(p_full_name),phone=p_phone,password_hash=coalesce(nullif(p_password,''),password_hash),avatar_url=p_avatar_url,address=nullif(trim(p_address),''),address_province=nullif(trim(p_address_province),''),address_commune=nullif(trim(p_address_commune),''),address_quartier=nullif(trim(p_address_quartier),''),address_avenue=nullif(trim(p_address_avenue),''),address_number=nullif(trim(p_address_number),''),address_latitude=p_address_latitude,address_longitude=p_address_longitude,shirt_size=nullif(trim(p_shirt_size),''),jacket_size=nullif(trim(p_jacket_size),''),skirt_size=nullif(trim(p_skirt_size),''),dress_size=nullif(trim(p_dress_size),''),heel_size=nullif(trim(p_heel_size),''),sneaker_size=nullif(trim(p_sneaker_size),''),ballerina_size=nullif(trim(p_ballerina_size),''),profile_updated_at=now() where id=p_user_id;
  return query select u.id,u.full_name,u.phone,u.role,u.user_category,u.supervisor_id,u.permanent_shop_id,u.avatar_url,u.address,u.address_province,u.address_commune,u.address_quartier,u.address_avenue,u.address_number,u.address_latitude,u.address_longitude,u.shirt_size,u.jacket_size,u.skirt_size,u.dress_size,u.heel_size,u.sneaker_size,u.ballerina_size,u.profile_updated_at from public.users u where u.id=p_user_id;
end;
$function$;
grant execute on function public.update_my_profile(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text) to anon, authenticated;

notify pgrst,'reload schema';
