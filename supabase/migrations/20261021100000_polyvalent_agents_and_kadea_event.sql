-- BTL Africa: polyvalent hostesses, removal of BA-Youth, and Kadea training event.
-- The database remains the source of truth; existing BA-Youth rows are normalized to BA.

do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name, con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('users', 'user_registration_requests')
      and pg_get_constraintdef(con.oid) ilike '%brand_ambassador_youth%'
  loop
    execute format('alter table %I.%I drop constraint %I', r.schema_name, r.table_name, r.conname);
  end loop;
end $$;

alter table public.users add constraint users_user_category_check
  check (user_category in ('hostess','hostess_polyvalent','brand_ambassador','operations'));
alter table public.user_registration_requests add constraint registration_user_category_check
  check (user_category in ('hostess','hostess_polyvalent','brand_ambassador','operations'));

update public.users set user_category = 'brand_ambassador' where user_category = 'brand_ambassador_youth';
update public.user_registration_requests set user_category = 'brand_ambassador' where user_category = 'brand_ambassador_youth';
update public.users set user_category = 'hostess_polyvalent', profile_updated_at = now() where id = 'd7d3e439-3273-4e65-8328-05a647b4eec1';

-- Assignment compatibility used by the current campaign-management RPC.
create or replace function public.set_user_campaign_assignments(p_user_id text,p_campaign_ids uuid[],p_manager_id text)
returns setof public.user_campaign_assignments language plpgsql security definer set search_path=public as $function$
declare manager_role text; target_role text; target_category text; selected_campaign uuid; existing_assignment_id uuid;
begin
  select role into manager_role from public.users where id=p_manager_id and is_active;
  if manager_role not in ('admin','super_admin','sub_admin','supervisor') then raise exception 'campaign_manager_required' using errcode='42501'; end if;
  select role,user_category into target_role,target_category from public.users where id=p_user_id and is_active;
  if target_role is distinct from 'agent' or target_category not in ('hostess','hostess_polyvalent','brand_ambassador') then raise exception 'campaigns_are_for_agents_only' using errcode='22023'; end if;
  update public.user_campaign_assignments a set is_active=false where a.user_id=p_user_id and a.is_active and not (a.campaign_id=any(coalesce(p_campaign_ids,'{}'::uuid[])));
  update public.agent_campaign_supervisor_assignments a set is_active=false where a.agent_id=p_user_id and a.is_active and not (a.campaign_id=any(coalesce(p_campaign_ids,'{}'::uuid[])));
  foreach selected_campaign in array coalesce(p_campaign_ids,'{}'::uuid[]) loop
    if not exists(select 1 from public.campaigns c where c.id=selected_campaign and c.status in ('active','draft') and (c.campaign_type='event' or (target_category in ('hostess','hostess_polyvalent') and c.campaign_type='hostess') or (target_category in ('brand_ambassador','hostess_polyvalent') and c.campaign_type='brand_ambassador'))) then raise exception 'campaign_not_available' using errcode='22023'; end if;
    select id into existing_assignment_id from public.user_campaign_assignments where user_id=p_user_id and campaign_id=selected_campaign limit 1;
    if existing_assignment_id is null then insert into public.user_campaign_assignments(id,user_id,campaign_id,is_active,assigned_at,assigned_by) values(gen_random_uuid(),p_user_id,selected_campaign,true,now(),p_manager_id);
    else update public.user_campaign_assignments set is_active=true,assigned_at=now(),assigned_by=p_manager_id where id=existing_assignment_id; end if;
  end loop;
  return query select a.* from public.user_campaign_assignments a where a.user_id=p_user_id and a.is_active order by a.assigned_at desc;
end;
$function$;
grant execute on function public.set_user_campaign_assignments(text,uuid[],text) to anon,authenticated;

create or replace function public.request_campaign_assignment(p_user_id text,p_campaign_id uuid)
returns public.campaign_assignment_requests language plpgsql security definer set search_path=public as $function$
declare requested public.campaign_assignment_requests; target_category text; campaign_type text;
begin
  select u.user_category into target_category from public.users u where u.id=p_user_id and u.role='agent';
  if target_category is null then raise exception 'agent_required' using errcode='42501'; end if;
  select c.campaign_type into campaign_type from public.campaigns c where c.id=p_campaign_id and c.status in ('active','draft');
  if campaign_type is null or not (campaign_type='event' or (target_category in ('hostess','hostess_polyvalent') and campaign_type='hostess') or (target_category in ('brand_ambassador','hostess_polyvalent') and campaign_type='brand_ambassador')) then raise exception 'campaign_category_mismatch' using errcode='22023'; end if;
  if exists(select 1 from public.user_campaign_assignments a where a.user_id=p_user_id and a.campaign_id=p_campaign_id and a.is_active) then raise exception 'already_assigned' using errcode='23505'; end if;
  if exists(select 1 from public.campaign_assignment_requests r where r.user_id=p_user_id and r.campaign_id=p_campaign_id and r.status='pending') then select * into requested from public.campaign_assignment_requests r where r.user_id=p_user_id and r.campaign_id=p_campaign_id and r.status='pending' order by r.requested_at desc limit 1; return requested; end if;
  insert into public.campaign_assignment_requests(user_id,campaign_id) values(p_user_id,p_campaign_id) returning * into requested; return requested;
end;
$function$;
grant execute on function public.request_campaign_assignment(text,uuid) to anon,authenticated;

-- Rename and schedule the requested event. The two dates are intentionally not continuous.
update public.campaigns set name='Formation Kadea - IA', code='formation-kadea-ia', starts_on='2026-10-20', ends_on='2026-10-23', event_mode='periodic', event_arrival_time=null, event_departure_time=null, updated_at=now() where id='fbf86c64-85f6-47de-a7bd-166740844254';
delete from public.event_days where campaign_id='fbf86c64-85f6-47de-a7bd-166740844254';
insert into public.event_days(campaign_id,event_date,arrival_from,arrival_until,departure_from,departure_until)
values
 ('fbf86c64-85f6-47de-a7bd-166740844254','2026-10-20','08:00','08:00','17:00','17:00'),
 ('fbf86c64-85f6-47de-a7bd-166740844254','2026-10-23','08:00','08:00','13:00','13:00');
notify pgrst,'reload schema';


-- Extend profile and registration RPC validation.
create or replace function public.update_user_by_admin(
  p_actor_id text,
  p_user_id text,
  p_full_name text,
  p_phone text,
  p_role text,
  p_user_category text default null,
  p_is_active boolean default true,
  p_supervisor_id text default null,
  p_permanent_shop_id text default null
)
returns table (
  id text,
  full_name text,
  phone text,
  whatsapp_phone text,
  whatsapp_same_as_phone boolean,
  date_of_birth date,
  address text,
  address_province text,
  address_commune text,
  address_quartier text,
  address_avenue text,
  address_number text,
  address_latitude double precision,
  address_longitude double precision,
  role text,
  user_category text,
  is_active boolean,
  supervisor_id text,
  permanent_shop_id text,
  avatar_url text,
  profile_updated_at timestamptz,
  shirt_size text,
  jacket_size text,
  skirt_size text,
  dress_size text,
  heel_size text,
  sneaker_size text,
  ballerina_size text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text;
  normalized_name text := trim(p_full_name);
  normalized_phone text := trim(p_phone);
begin
  select u.role into actor_role
  from public.users u
  where u.id = p_actor_id and u.is_active;

  if actor_role not in ('admin', 'super_admin') then
    raise exception 'admin_profile_update_not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if char_length(normalized_name) < 2 then
    raise exception 'full_name_invalid' using errcode = '22023';
  end if;
  if normalized_phone !~ '^(08|09)[0-9]{8}$' then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;
  if p_role not in ('agent', 'supervisor', 'sub_admin', 'admin', 'super_admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_user_category is not null and p_user_category not in ('hostess', 'brand_ambassador', 'hostess_polyvalent', 'operations') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_role = 'agent' and p_user_category is null then
    raise exception 'agent_category_required' using errcode = '22023';
  end if;
  if p_supervisor_id is not null and not exists (
    select 1 from public.users u
    where u.id = p_supervisor_id and u.role in ('supervisor', 'sub_admin', 'admin', 'super_admin')
  ) then
    raise exception 'invalid_supervisor' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.phone = normalized_phone and u.id <> p_user_id) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  update public.users u
  set full_name = normalized_name,
      phone = normalized_phone,
      role = p_role,
      user_category = case when p_role = 'agent' then p_user_category else coalesce(p_user_category, 'operations') end,
      is_active = coalesce(p_is_active, true),
      supervisor_id = p_supervisor_id,
      permanent_shop_id = case when p_role = 'agent' then nullif(trim(p_permanent_shop_id), '') else null end,
      profile_updated_at = now()
  where u.id = p_user_id;

  return query
  select u.id, u.full_name, u.phone, u.whatsapp_phone, u.whatsapp_same_as_phone,
    u.date_of_birth, u.address, u.address_province, u.address_commune, u.address_quartier,
    u.address_avenue, u.address_number, u.address_latitude, u.address_longitude,
    u.role, u.user_category, u.is_active, u.supervisor_id, u.permanent_shop_id,
    u.avatar_url, u.profile_updated_at, u.shirt_size, u.jacket_size, u.skirt_size,
    u.dress_size, u.heel_size, u.sneaker_size, u.ballerina_size
  from public.users u where u.id = p_user_id;
end;
$function$;

grant execute on function public.update_user_by_admin(text, text, text, text, text, text, boolean, text, text) to anon, authenticated;


create or replace function public.create_registration_request(
  p_request_id uuid,
  p_full_name text,
  p_phone text,
  p_whatsapp_phone text,
  p_whatsapp_same_as_phone boolean,
  p_date_of_birth date,
  p_address text,
  p_address_province text default null,
  p_address_commune text default null,
  p_address_quartier text default null,
  p_address_avenue text default null,
  p_address_number text default null,
  p_address_latitude double precision default null,
  p_address_longitude double precision default null,
  p_avatar_url text default null,
  p_password_hash text default null,
  p_user_category text default null
)
returns table (
  id uuid, full_name text, phone text, whatsapp_phone text, whatsapp_same_as_phone boolean,
  date_of_birth date, address text, address_province text, address_commune text,
  address_quartier text, address_avenue text, address_number text,
  address_latitude double precision, address_longitude double precision, avatar_url text,
  role text, user_category text, status text, created_at timestamptz,
  reviewed_at timestamptz, reviewed_by text, review_note text
)
language plpgsql security definer set search_path = public
as $function$
declare
  created_request public.user_registration_requests;
  normalized_whatsapp text;
begin
  if char_length(trim(p_full_name)) < 2 then raise exception 'full_name_invalid' using errcode = '22023'; end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then raise exception 'phone_invalid' using errcode = '22023'; end if;
  if p_password_hash is null or char_length(p_password_hash) < 6 then raise exception 'password_invalid' using errcode = '22023'; end if;
  if p_user_category not in ('hostess', 'brand_ambassador', 'hostess_polyvalent', 'operations') then raise exception 'category_invalid' using errcode = '22023'; end if;
  if coalesce(p_whatsapp_same_as_phone, true) then normalized_whatsapp := p_phone;
  else
    normalized_whatsapp := nullif(trim(p_whatsapp_phone), '');
    if normalized_whatsapp is null or normalized_whatsapp !~ '^(08|09)[0-9]{8}$' then raise exception 'whatsapp_phone_invalid' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.users u where u.phone = p_phone)
    or exists (select 1 from public.user_registration_requests r where r.phone = p_phone and r.status = 'pending') then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;
  insert into public.user_registration_requests (
    id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone, date_of_birth, address,
    address_province, address_commune, address_quartier, address_avenue, address_number,
    address_latitude, address_longitude, avatar_url, password_hash, role, user_category
  ) values (
    p_request_id, trim(p_full_name), p_phone, normalized_whatsapp, coalesce(p_whatsapp_same_as_phone, true),
    p_date_of_birth, nullif(trim(p_address), ''), nullif(trim(p_address_province), ''), nullif(trim(p_address_commune), ''),
    nullif(trim(p_address_quartier), ''), nullif(trim(p_address_avenue), ''), nullif(trim(p_address_number), ''),
    p_address_latitude, p_address_longitude, nullif(trim(p_avatar_url), ''), p_password_hash, 'agent', p_user_category
  ) returning * into created_request;
  return query select created_request.id, created_request.full_name, created_request.phone, created_request.whatsapp_phone,
    created_request.whatsapp_same_as_phone, created_request.date_of_birth, created_request.address,
    created_request.address_province, created_request.address_commune, created_request.address_quartier,
    created_request.address_avenue, created_request.address_number, created_request.address_latitude,
    created_request.address_longitude, created_request.avatar_url, created_request.role, created_request.user_category,
    created_request.status, created_request.created_at, created_request.reviewed_at, created_request.reviewed_by, created_request.review_note;
end;
$function$;
grant execute on function public.create_registration_request(uuid, text, text, text, boolean, date, text, text, text, text, text, text, double precision, double precision, text, text, text) to anon, authenticated;

create or replace function public.create_user_by_super_admin(
  p_id text, p_creator_id text, p_full_name text, p_phone text, p_password text, p_role text,
  p_user_category text default null, p_supervisor_id text default null, p_permanent_shop_id text default null,
  p_whatsapp_phone text default null, p_whatsapp_same_as_phone boolean default true, p_date_of_birth date default null,
  p_address text default null, p_address_province text default null, p_address_commune text default null,
  p_address_quartier text default null, p_address_avenue text default null, p_address_number text default null,
  p_address_latitude double precision default null, p_address_longitude double precision default null, p_avatar_url text default null
)
returns table (
  id text, full_name text, phone text, whatsapp_phone text, whatsapp_same_as_phone boolean, date_of_birth date,
  address text, address_province text, address_commune text, address_quartier text, address_avenue text, address_number text,
  address_latitude double precision, address_longitude double precision, role text, user_category text, supervisor_id text,
  permanent_shop_id text, avatar_url text, profile_updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $function$
declare creator_role text; normalized_name text := trim(p_full_name); stored_category text; normalized_whatsapp text;
begin
  select u.role into creator_role from public.users u where u.id=p_creator_id;
  if creator_role is null or creator_role not in ('admin','super_admin','supervisor','sub_admin') then raise exception 'administrative_creator_required' using errcode='42501'; end if;
  if creator_role in ('supervisor','sub_admin') and p_role <> 'agent' then raise exception 'staff_can_create_agents_only' using errcode='42501'; end if;
  if char_length(normalized_name)<2 then raise exception 'full_name_required' using errcode='22023'; end if;
  if p_phone is null or p_phone !~ '^(08|09)[0-9]{8}$' then raise exception 'phone_invalid' using errcode='22023'; end if;
  if p_password is null or char_length(p_password)<6 then raise exception 'password_too_short' using errcode='22023'; end if;
  if p_role not in ('agent','supervisor','sub_admin','admin','super_admin') then raise exception 'invalid_role' using errcode='22023'; end if;
  if p_user_category is not null and p_user_category not in ('hostess','brand_ambassador','hostess_polyvalent','operations') then raise exception 'invalid_category' using errcode='22023'; end if;
  stored_category := case when p_role='agent' then p_user_category else coalesce(p_user_category,'operations') end;
  if stored_category is null then raise exception 'agent_category_required' using errcode='22023'; end if;
  if coalesce(p_whatsapp_same_as_phone,true) then normalized_whatsapp:=p_phone;
  else normalized_whatsapp:=nullif(trim(p_whatsapp_phone),''); if normalized_whatsapp is null or normalized_whatsapp !~ '^(08|09)[0-9]{8}$' then raise exception 'whatsapp_phone_invalid' using errcode='22023'; end if; end if;
  if p_supervisor_id is not null and not exists (select 1 from public.users u where u.id=p_supervisor_id and u.role in ('supervisor','sub_admin','admin','super_admin')) then raise exception 'invalid_supervisor' using errcode='22023'; end if;
  return query insert into public.users (
    id,full_name,phone,whatsapp_phone,whatsapp_same_as_phone,date_of_birth,address,address_province,address_commune,address_quartier,address_avenue,address_number,address_latitude,address_longitude,avatar_url,password_hash,role,user_category,supervisor_id,permanent_shop_id
  ) values (
    p_id,normalized_name,p_phone,normalized_whatsapp,coalesce(p_whatsapp_same_as_phone,true),p_date_of_birth,nullif(trim(p_address),''),nullif(trim(p_address_province),''),nullif(trim(p_address_commune),''),nullif(trim(p_address_quartier),''),nullif(trim(p_address_avenue),''),nullif(trim(p_address_number),''),p_address_latitude,p_address_longitude,nullif(trim(p_avatar_url),''),p_password,p_role,stored_category,p_supervisor_id,case when p_role='agent' then nullif(trim(p_permanent_shop_id),'') else null end
  ) returning users.id,users.full_name,users.phone,users.whatsapp_phone,users.whatsapp_same_as_phone,users.date_of_birth,users.address,users.address_province,users.address_commune,users.address_quartier,users.address_avenue,users.address_number,users.address_latitude,users.address_longitude,users.role,users.user_category,users.supervisor_id,users.permanent_shop_id,users.avatar_url,users.profile_updated_at;
end;
$function$;
grant execute on function public.create_user_by_super_admin(text,text,text,text,text,text,text,text,text,text,boolean,date,text,text,text,text,text,text,double precision,double precision,text) to anon, authenticated;

-- Profile completion

notify pgrst,'reload schema';


-- Keep operational supervisor links compatible with polyvalent agents.
create or replace function public.sync_agent_campaign_supervisor_assignments(p_agent_id text,p_assignments jsonb,p_manager_id text)
returns setof public.agent_campaign_supervisor_assignments
language plpgsql security definer set search_path=public as $function$
declare manager_role text; target_role text; target_category text; assignment_item jsonb; selected_campaign uuid; selected_supervisor text; existing_id uuid; expected_campaign_type text;
begin
  select role into manager_role from public.users where id=p_manager_id and is_active;
  if manager_role not in ('supervisor','sub_admin','admin','super_admin') then raise exception 'campaign_manager_required' using errcode='42501'; end if;
  select role into target_role from public.users where id=p_agent_id and is_active;
  if target_role is distinct from 'agent' then raise exception 'campaigns_are_for_agents_only' using errcode='22023'; end if;
  if manager_role='supervisor' and not exists(select 1 from public.agent_campaign_supervisor_assignments a where a.agent_id=p_agent_id and a.supervisor_id=p_manager_id and a.is_active) then raise exception 'campaign_supervisor_required' using errcode='42501'; end if;
  for assignment_item in select value from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb)) loop
    selected_campaign := (assignment_item->>'campaign_id')::uuid;
    select case when u.user_category in ('hostess','hostess_polyvalent') then 'hostess' else 'brand_ambassador' end into expected_campaign_type from public.users u where u.id=p_agent_id;
    if not exists(select 1 from public.campaigns c where c.id=selected_campaign and c.status in ('active','draft') and (c.campaign_type='event' or (target_category in ('hostess','hostess_polyvalent') and c.campaign_type='hostess') or (target_category in ('brand_ambassador','hostess_polyvalent') and c.campaign_type='brand_ambassador'))) then raise exception 'campaign_not_available' using errcode='22023'; end if;
    if not exists(select 1 from public.user_campaign_assignments a where a.user_id=p_agent_id and a.campaign_id=selected_campaign and a.is_active) then
      insert into public.user_campaign_assignments(id,user_id,campaign_id,is_active,assigned_at,assigned_by) values(gen_random_uuid(),p_agent_id,selected_campaign,true,now(),p_manager_id) on conflict(user_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_manager_id;
    end if;
    for selected_supervisor in select value from jsonb_array_elements_text(coalesce(assignment_item->'supervisor_ids','[]'::jsonb)) loop
      if not exists(select 1 from public.users u where u.id=selected_supervisor and u.role in ('supervisor','sub_admin','admin','super_admin') and u.is_active) then raise exception 'invalid_campaign_supervisor' using errcode='22023'; end if;
      select a.id into existing_id from public.agent_campaign_supervisor_assignments a where a.agent_id=p_agent_id and a.supervisor_id=selected_supervisor and a.campaign_id=selected_campaign limit 1;
      if existing_id is null then insert into public.agent_campaign_supervisor_assignments(id,agent_id,supervisor_id,campaign_id,is_active,assigned_at,assigned_by) values(gen_random_uuid(),p_agent_id,selected_supervisor,selected_campaign,true,now(),p_manager_id); else update public.agent_campaign_supervisor_assignments set is_active=true,assigned_at=now(),assigned_by=p_manager_id where id=existing_id; end if;
    end loop;
    update public.agent_campaign_supervisor_assignments a set is_active=false where a.agent_id=p_agent_id and a.campaign_id=selected_campaign and a.is_active and not exists(select 1 from jsonb_array_elements_text(coalesce(assignment_item->'supervisor_ids','[]'::jsonb)) s(value) where s.value=a.supervisor_id);
  end loop;
  return query select a.* from public.agent_campaign_supervisor_assignments a where a.agent_id=p_agent_id and a.is_active order by a.assigned_at desc;
end;
$function$;
grant execute on function public.sync_agent_campaign_supervisor_assignments(text,jsonb,text) to anon,authenticated;

create or replace function public.update_campaign_management(p_actor_id text,p_campaign_id uuid,p_code text,p_name text,p_starts_on date,p_ends_on date,p_supervisor_id text,p_agent_ids text[] default '{}')
returns public.campaigns language plpgsql security definer set search_path=public as $function$
declare actor_role text; row_campaign public.campaigns; selected_agent text;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin','sub_admin') then raise exception 'campaign_editor_not_allowed' using errcode='42501'; end if;
  if not exists(select 1 from public.campaigns where id=p_campaign_id) then raise exception 'campaign_not_found' using errcode='P0002'; end if;
  if p_code !~ '^[a-z0-9][a-z0-9-]{2,79}$' or char_length(trim(p_name))<2 or p_starts_on is null or (p_ends_on is not null and p_starts_on>p_ends_on) then raise exception 'campaign_details_invalid' using errcode='22023'; end if;
  if p_supervisor_id is not null and not exists(select 1 from public.users where id=p_supervisor_id and role in ('supervisor','sub_admin','admin','super_admin') and is_active) then raise exception 'campaign_supervisor_invalid' using errcode='22023'; end if;
  update public.campaigns set code=lower(trim(p_code)),name=trim(p_name),starts_on=p_starts_on,ends_on=p_ends_on,event_supervisor_id=case when campaign_type='event' then p_supervisor_id else event_supervisor_id end,updated_at=now() where id=p_campaign_id returning * into row_campaign;
  update public.user_campaign_assignments set is_active=false where campaign_id=p_campaign_id and user_id not in(select unnest(coalesce(p_agent_ids,'{}')));
  foreach selected_agent in array coalesce(p_agent_ids,'{}') loop
    if exists(select 1 from public.users where id=selected_agent and role='agent' and is_active) then
      insert into public.user_campaign_assignments(user_id,campaign_id,is_active,assigned_at,assigned_by) values(selected_agent,p_campaign_id,true,now(),p_actor_id) on conflict(user_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_actor_id;
      if p_supervisor_id is not null then insert into public.agent_campaign_supervisor_assignments(agent_id,supervisor_id,campaign_id,is_active,assigned_at,assigned_by) values(selected_agent,p_supervisor_id,p_campaign_id,true,now(),p_actor_id) on conflict(agent_id,supervisor_id,campaign_id) do update set is_active=true,assigned_at=now(),assigned_by=p_actor_id; end if;
    end if;
  end loop;
  return row_campaign;
end;
$function$;
grant execute on function public.update_campaign_management(text,uuid,text,text,date,date,text,text[]) to anon,authenticated;


notify pgrst,'reload schema';
