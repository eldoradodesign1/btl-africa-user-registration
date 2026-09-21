-- BTL Africa: secure password storage and re-authenticated profile changes.
-- Run after 202609210001_registration_requests.sql and 202609210004_user_profile_updates.sql.

create extension if not exists pgcrypto;

-- Migrate legacy plaintext values once. bcrypt hashes start with $2a$, $2b$ or $2y$.
update public.users
set password_hash = crypt(password_hash, gen_salt('bf', 12))
where password_hash is not null
  and password_hash !~ '^\$2[aby]\$';

update public.user_registration_requests
set password_hash = crypt(password_hash, gen_salt('bf', 12))
where password_hash is not null
  and password_hash !~ '^\$2[aby]\$';

-- The browser receives only the safe profile fields; password_hash never leaves this function.
drop function if exists public.authenticate_user(text, text);
create function public.authenticate_user(p_phone text, p_password text)
returns table (
  id text,
  full_name text,
  phone text,
  role text,
  user_category text,
  supervisor_id text,
  permanent_shop_id text,
  avatar_url text,
  profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_phone is null or p_password is null then
    return;
  end if;

  return query
    select u.id, u.full_name, u.phone, u.role, u.user_category,
      u.supervisor_id, u.permanent_shop_id, u.avatar_url, u.profile_updated_at
    from public.users u
    where u.phone = p_phone
      and u.password_hash is not null
      and crypt(p_password, u.password_hash) = u.password_hash;
end;
$function$;

grant execute on function public.authenticate_user(text, text) to anon, authenticated;

-- Manual account creation is also hashed inside PostgreSQL, never in the browser.
drop function if exists public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text);
create function public.create_user_by_super_admin(
  p_creator_id text,
  p_id text,
  p_full_name text,
  p_phone text,
  p_password text,
  p_role text,
  p_user_category text default null,
  p_supervisor_id text default null,
  p_permanent_shop_id text default null
)
returns table (
  id text,
  full_name text,
  phone text,
  role text,
  user_category text,
  supervisor_id text,
  permanent_shop_id text,
  avatar_url text,
  profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.users u where u.id = p_creator_id and u.role = 'super_admin') then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;
  if p_id is null or char_length(trim(p_id)) < 1 then
    raise exception 'user_id_invalid' using errcode = '22023';
  end if;
  if char_length(trim(p_full_name)) < 2 then
    raise exception 'full_name_invalid' using errcode = '22023';
  end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'password_invalid' using errcode = '22023';
  end if;
  if p_role not in ('agent', 'supervisor', 'sub_admin', 'admin', 'super_admin') then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  if p_user_category is not null and p_user_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations') then
    raise exception 'category_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.phone = p_phone or u.id = p_id) then
    raise exception 'user_already_registered' using errcode = '23505';
  end if;

  insert into public.users (id, full_name, phone, password_hash, role, user_category, supervisor_id, permanent_shop_id)
  values (p_id, trim(p_full_name), p_phone, crypt(p_password, gen_salt('bf', 12)), p_role, p_user_category, p_supervisor_id, p_permanent_shop_id);

  return query
    select u.id, u.full_name, u.phone, u.role, u.user_category,
      u.supervisor_id, u.permanent_shop_id, u.avatar_url, u.profile_updated_at
    from public.users u where u.id = p_id;
end;
$function$;

grant execute on function public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- Profile changes require the current password. A stolen profile id alone is not enough.
drop function if exists public.update_my_profile(text, text, text, text, text);
drop function if exists public.update_my_profile(text, text, text, text, text, text);
create function public.update_my_profile(
  p_user_id text,
  p_full_name text,
  p_phone text,
  p_password text default null,
  p_avatar_url text default null,
  p_current_password text default null
)
returns table (
  id text,
  full_name text,
  phone text,
  role text,
  user_category text,
  supervisor_id text,
  permanent_shop_id text,
  avatar_url text,
  profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  current_hash text;
begin
  select u.password_hash into current_hash
  from public.users u
  where u.id = p_user_id
  for update;

  if current_hash is null or p_current_password is null or crypt(p_current_password, current_hash) <> current_hash then
    raise exception 'current_password_invalid' using errcode = '42501';
  end if;
  if char_length(trim(p_full_name)) < 2 then
    raise exception 'full_name_invalid' using errcode = '22023';
  end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.phone = p_phone and u.id <> p_user_id) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;
  if p_password is not null and char_length(p_password) < 6 then
    raise exception 'password_invalid' using errcode = '22023';
  end if;
  if p_avatar_url is not null and char_length(p_avatar_url) > 700000 then
    raise exception 'avatar_too_large' using errcode = '22023';
  end if;

  update public.users u
  set full_name = trim(p_full_name),
      phone = p_phone,
      password_hash = case when nullif(p_password, '') is not null then crypt(p_password, gen_salt('bf', 12)) else u.password_hash end,
      avatar_url = p_avatar_url,
      profile_updated_at = now()
  where u.id = p_user_id;

  return query
    select u.id, u.full_name, u.phone, u.role, u.user_category,
      u.supervisor_id, u.permanent_shop_id, u.avatar_url, u.profile_updated_at
    from public.users u where u.id = p_user_id;
end;
$function$;

grant execute on function public.update_my_profile(text, text, text, text, text, text) to anon, authenticated;

-- New registration requests are hashed at insertion time too.
create or replace function public.create_registration_request(
  p_request_id uuid,
  p_full_name text,
  p_phone text,
  p_password_hash text,
  p_user_category text
)
returns table (
  id uuid, full_name text, phone text, role text, user_category text,
  status text, created_at timestamptz, reviewed_at timestamptz,
  reviewed_by text, review_note text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  created_request public.user_registration_requests;
begin
  if char_length(trim(p_full_name)) < 2 then
    raise exception 'full_name_invalid' using errcode = '22023';
  end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;
  if p_password_hash is null or char_length(p_password_hash) < 6 then
    raise exception 'password_invalid' using errcode = '22023';
  end if;
  if p_user_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations') then
    raise exception 'category_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.phone = p_phone)
    or exists (select 1 from public.user_registration_requests r where r.phone = p_phone and r.status = 'pending') then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  insert into public.user_registration_requests (id, full_name, phone, password_hash, role, user_category)
  values (p_request_id, trim(p_full_name), p_phone, crypt(p_password_hash, gen_salt('bf', 12)), 'agent', p_user_category)
  returning * into created_request;

  return query select created_request.id, created_request.full_name, created_request.phone,
    created_request.role, created_request.user_category, created_request.status,
    created_request.created_at, created_request.reviewed_at, created_request.reviewed_by,
    created_request.review_note;
end;
$function$;

grant execute on function public.create_registration_request(uuid, text, text, text, text) to anon, authenticated;
