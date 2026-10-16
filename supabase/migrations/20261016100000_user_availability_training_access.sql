-- BTL Africa: user availability preferences and explicit training module access.
-- Existing users remain valid: all new columns are nullable/defaulted.
alter table public.users
  add column if not exists current_occupation text,
  add column if not exists accepts_night_work boolean not null default false,
  add column if not exists accepts_overnight_stay boolean not null default false,
  add column if not exists accepts_late_work boolean not null default false;

create table if not exists public.training_module_access (
  user_id text not null references public.users(id) on delete cascade,
  module_code text not null,
  granted boolean not null default true,
  granted_by text references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_code)
);
create index if not exists training_module_access_user_idx on public.training_module_access(user_id);

create or replace function public.list_training_module_access(p_actor_id text, p_user_id text)
returns table(user_id text,module_code text,granted boolean,granted_by text,granted_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path=public as $function$
declare actor_role text;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin') then raise exception 'training_access_not_allowed' using errcode='42501'; end if;
  return query select a.user_id,a.module_code,a.granted,a.granted_by,a.granted_at,a.updated_at from public.training_module_access a where a.user_id=p_user_id order by a.module_code;
end;
$function$;
grant execute on function public.list_training_module_access(text,text) to anon, authenticated;

create or replace function public.set_training_module_access(p_actor_id text,p_user_id text,p_module_codes text[])
returns setof public.training_module_access
language plpgsql security definer set search_path=public as $function$
declare actor_role text;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin') then raise exception 'training_access_not_allowed' using errcode='42501'; end if;
  if not exists(select 1 from public.users where id=p_user_id) then raise exception 'training_user_not_found' using errcode='22023'; end if;
  delete from public.training_module_access where user_id=p_user_id;
  insert into public.training_module_access(user_id,module_code,granted,granted_by,granted_at,updated_at)
  select p_user_id,trim(code),true,p_actor_id,now(),now() from unnest(coalesce(p_module_codes,'{}')) code where trim(code)<>'';
  return query select a.user_id,a.module_code,a.granted,a.granted_by,a.granted_at,a.updated_at from public.training_module_access a where a.user_id=p_user_id order by a.module_code;
end;
$function$;
grant execute on function public.set_training_module_access(text,text,text[]) to anon, authenticated;

-- Extend the password-confirmed profile RPC with the four survey answers.
drop function if exists public.update_my_profile(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text);
create or replace function public.update_my_profile(
  p_user_id text,p_full_name text,p_phone text,p_password text default null,p_avatar_url text default null,p_current_password text default null,
  p_address text default null,p_address_province text default null,p_address_commune text default null,p_address_quartier text default null,p_address_avenue text default null,p_address_number text default null,
  p_address_latitude double precision default null,p_address_longitude double precision default null,
  p_shirt_size text default null,p_jacket_size text default null,p_skirt_size text default null,p_dress_size text default null,p_heel_size text default null,p_sneaker_size text default null,p_ballerina_size text default null,
  p_current_occupation text default null,p_accepts_night_work boolean default false,p_accepts_overnight_stay boolean default false,p_accepts_late_work boolean default false
)
returns table(id text,full_name text,phone text,role text,user_category text,supervisor_id text,permanent_shop_id text,avatar_url text,address text,address_province text,address_commune text,address_quartier text,address_avenue text,address_number text,address_latitude double precision,address_longitude double precision,shirt_size text,jacket_size text,skirt_size text,dress_size text,heel_size text,sneaker_size text,ballerina_size text,current_occupation text,accepts_night_work boolean,accepts_overnight_stay boolean,accepts_late_work boolean,profile_updated_at timestamptz)
language plpgsql security definer set search_path=public as $function$
declare current_password text;
begin
  select password_hash into current_password from public.users where id=p_user_id for update;
  if current_password is null or p_current_password is null or current_password<>p_current_password then raise exception 'current_password_invalid' using errcode='42501'; end if;
  if char_length(trim(p_full_name))<2 then raise exception 'full_name_invalid' using errcode='22023'; end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then raise exception 'phone_invalid' using errcode='22023'; end if;
  update public.users set full_name=trim(p_full_name),phone=p_phone,password_hash=coalesce(nullif(p_password,''),password_hash),avatar_url=p_avatar_url,address=nullif(trim(p_address),''),address_province=nullif(trim(p_address_province),''),address_commune=nullif(trim(p_address_commune),''),address_quartier=nullif(trim(p_address_quartier),''),address_avenue=nullif(trim(p_address_avenue),''),address_number=nullif(trim(p_address_number),''),address_latitude=p_address_latitude,address_longitude=p_address_longitude,shirt_size=nullif(trim(p_shirt_size),''),jacket_size=nullif(trim(p_jacket_size),''),skirt_size=nullif(trim(p_skirt_size),''),dress_size=nullif(trim(p_dress_size),''),heel_size=nullif(trim(p_heel_size),''),sneaker_size=nullif(trim(p_sneaker_size),''),ballerina_size=nullif(trim(p_ballerina_size),''),current_occupation=nullif(trim(p_current_occupation),''),accepts_night_work=coalesce(p_accepts_night_work,false),accepts_overnight_stay=coalesce(p_accepts_overnight_stay,false),accepts_late_work=coalesce(p_accepts_late_work,false),profile_updated_at=now() where id=p_user_id;
  return query select u.id,u.full_name,u.phone,u.role,u.user_category,u.supervisor_id,u.permanent_shop_id,u.avatar_url,u.address,u.address_province,u.address_commune,u.address_quartier,u.address_avenue,u.address_number,u.address_latitude,u.address_longitude,u.shirt_size,u.jacket_size,u.skirt_size,u.dress_size,u.heel_size,u.sneaker_size,u.ballerina_size,u.current_occupation,u.accepts_night_work,u.accepts_overnight_stay,u.accepts_late_work,u.profile_updated_at from public.users u where u.id=p_user_id;
end;
$function$;
grant execute on function public.update_my_profile(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,boolean,boolean,boolean) to anon, authenticated;
notify pgrst,'reload schema';
