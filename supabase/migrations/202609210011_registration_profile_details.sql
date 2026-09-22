-- BTL Africa: registration profile details.
-- Adds M-Pesa/WhatsApp, birth date, address and profile photo to both
-- self-service registration requests and public.users.

alter table public.users
  add column if not exists whatsapp_phone text,
  add column if not exists whatsapp_same_as_phone boolean not null default true,
  add column if not exists date_of_birth date,
  add column if not exists address text,
  add column if not exists avatar_url text;

alter table public.user_registration_requests
  add column if not exists whatsapp_phone text,
  add column if not exists whatsapp_same_as_phone boolean not null default true,
  add column if not exists date_of_birth date,
  add column if not exists address text,
  add column if not exists avatar_url text;

-- Replace the old five-argument public signup RPC with the extended contract.
drop function if exists public.create_registration_request(uuid, text, text, text, text);
drop function if exists public.create_registration_request(uuid, text, text, boolean, date, text, text, text, text, text);

create or replace function public.create_registration_request(
  p_request_id uuid,
  p_full_name text,
  p_phone text,
  p_whatsapp_phone text,
  p_whatsapp_same_as_phone boolean,
  p_date_of_birth date,
  p_address text,
  p_avatar_url text,
  p_password_hash text,
  p_user_category text
)
returns table (
  id uuid,
  full_name text,
  phone text,
  whatsapp_phone text,
  whatsapp_same_as_phone boolean,
  date_of_birth date,
  address text,
  avatar_url text,
  role text,
  user_category text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  created_request public.user_registration_requests;
  normalized_whatsapp text;
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

  if coalesce(p_whatsapp_same_as_phone, true) then
    normalized_whatsapp := p_phone;
  else
    normalized_whatsapp := nullif(trim(p_whatsapp_phone), '');
    if normalized_whatsapp is null or normalized_whatsapp !~ '^(08|09)[0-9]{8}$' then
      raise exception 'whatsapp_phone_invalid' using errcode = '22023';
    end if;
  end if;

  if exists (select 1 from public.users u where u.phone = p_phone)
    or exists (select 1 from public.user_registration_requests r where r.phone = p_phone and r.status = 'pending') then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  insert into public.user_registration_requests (
    id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone,
    date_of_birth, address, avatar_url, password_hash, role, user_category
  )
  values (
    p_request_id, trim(p_full_name), p_phone, normalized_whatsapp,
    coalesce(p_whatsapp_same_as_phone, true), p_date_of_birth,
    nullif(trim(p_address), ''), nullif(trim(p_avatar_url), ''),
    p_password_hash, 'agent', p_user_category
  )
  returning * into created_request;

  return query select created_request.id, created_request.full_name,
    created_request.phone, created_request.whatsapp_phone,
    created_request.whatsapp_same_as_phone, created_request.date_of_birth,
    created_request.address, created_request.avatar_url, created_request.role,
    created_request.user_category, created_request.status,
    created_request.created_at, created_request.reviewed_at,
    created_request.reviewed_by, created_request.review_note;
end;
$function$;

grant execute on function public.create_registration_request(uuid, text, text, text, boolean, date, text, text, text, text) to anon, authenticated;

-- Recreate reviewer RPCs with the extended request shape.
drop function if exists public.list_pending_registration_requests(text);
create or replace function public.list_pending_registration_requests(p_reviewer_id text)
returns table (
  id uuid,
  full_name text,
  phone text,
  whatsapp_phone text,
  whatsapp_same_as_phone boolean,
  date_of_birth date,
  address text,
  avatar_url text,
  role text,
  user_category text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.users u where u.id = p_reviewer_id and u.role = 'super_admin') then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;
  return query
    select r.id, r.full_name, r.phone, r.whatsapp_phone,
      r.whatsapp_same_as_phone, r.date_of_birth, r.address, r.avatar_url,
      r.role, r.user_category, r.status, r.created_at, r.reviewed_at,
      r.reviewed_by, r.review_note
    from public.user_registration_requests r
    where r.status = 'pending'
    order by r.created_at asc;
end;
$function$;

grant execute on function public.list_pending_registration_requests(text) to anon, authenticated;

create or replace function public.approve_registration_request(p_request_id uuid, p_reviewer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  request_row public.user_registration_requests;
  approved_user public.users;
begin
  if not exists (select 1 from public.users u where u.id = p_reviewer_id and u.role = 'super_admin') then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;

  select * into request_row from public.user_registration_requests r
  where r.id = p_request_id and r.status = 'pending'
  for update;
  if not found then
    raise exception 'registration_request_not_pending' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.users u where u.phone = request_row.phone) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  insert into public.users (
    id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone,
    date_of_birth, address, avatar_url, password_hash, role, user_category,
    supervisor_id, permanent_shop_id
  )
  values (
    request_row.id::text, request_row.full_name, request_row.phone,
    request_row.whatsapp_phone, request_row.whatsapp_same_as_phone,
    request_row.date_of_birth, request_row.address, request_row.avatar_url,
    request_row.password_hash, 'agent', request_row.user_category, null, null
  )
  returning * into approved_user;

  update public.user_registration_requests r
  set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer_id
  where r.id = request_row.id;

  return jsonb_build_object(
    'id', approved_user.id,
    'full_name', approved_user.full_name,
    'phone', approved_user.phone,
    'whatsapp_phone', approved_user.whatsapp_phone,
    'whatsapp_same_as_phone', approved_user.whatsapp_same_as_phone,
    'date_of_birth', approved_user.date_of_birth,
    'address', approved_user.address,
    'avatar_url', approved_user.avatar_url,
    'role', approved_user.role,
    'user_category', approved_user.user_category,
    'supervisor_id', approved_user.supervisor_id,
    'permanent_shop_id', approved_user.permanent_shop_id
  );
end;
$function$;

grant execute on function public.approve_registration_request(uuid, text) to anon, authenticated;

-- Replace the existing nine-argument superadmin creation RPC.
drop function if exists public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text);
drop function if exists public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text, text, boolean, date, text, text);

create or replace function public.create_user_by_super_admin(
  p_id text,
  p_creator_id text,
  p_full_name text,
  p_phone text,
  p_password text,
  p_role text,
  p_user_category text default null,
  p_supervisor_id text default null,
  p_permanent_shop_id text default null,
  p_whatsapp_phone text default null,
  p_whatsapp_same_as_phone boolean default true,
  p_date_of_birth date default null,
  p_address text default null,
  p_avatar_url text default null
)
returns table (
  id text,
  full_name text,
  phone text,
  whatsapp_phone text,
  whatsapp_same_as_phone boolean,
  date_of_birth date,
  address text,
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
  creator_role text;
  normalized_name text := trim(p_full_name);
  stored_category text;
  normalized_whatsapp text;
begin
  select u.role into creator_role from public.users u where u.id = p_creator_id;
  if creator_role is distinct from 'super_admin' then raise exception 'super_admin_required' using errcode = '42501'; end if;
  if char_length(normalized_name) < 2 then raise exception 'full_name_required' using errcode = '22023'; end if;
  if p_phone is null or p_phone !~ '^(08|09)[0-9]{8}$' then raise exception 'phone_invalid' using errcode = '22023'; end if;
  if p_password is null or char_length(p_password) < 6 then raise exception 'password_too_short' using errcode = '22023'; end if;
  if p_role not in ('agent', 'supervisor', 'sub_admin', 'admin', 'super_admin') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_user_category is not null and p_user_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations') then raise exception 'invalid_category' using errcode = '22023'; end if;

  stored_category := case when p_role = 'agent' then p_user_category else coalesce(p_user_category, 'operations') end;
  if stored_category is null then raise exception 'agent_category_required' using errcode = '22023'; end if;
  if coalesce(p_whatsapp_same_as_phone, true) then normalized_whatsapp := p_phone;
  else
    normalized_whatsapp := nullif(trim(p_whatsapp_phone), '');
    if normalized_whatsapp is null or normalized_whatsapp !~ '^(08|09)[0-9]{8}$' then raise exception 'whatsapp_phone_invalid' using errcode = '22023'; end if;
  end if;
  if p_supervisor_id is not null and not exists (select 1 from public.users u where u.id = p_supervisor_id and u.role in ('supervisor', 'sub_admin', 'admin', 'super_admin')) then raise exception 'invalid_supervisor' using errcode = '22023'; end if;

  return query
    insert into public.users (
      id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone,
      date_of_birth, address, avatar_url, password_hash, role, user_category,
      supervisor_id, permanent_shop_id
    )
    values (
      p_id, normalized_name, p_phone, normalized_whatsapp,
      coalesce(p_whatsapp_same_as_phone, true), p_date_of_birth,
      nullif(trim(p_address), ''), nullif(trim(p_avatar_url), ''), p_password,
      p_role, stored_category, p_supervisor_id,
      case when p_role = 'agent' then nullif(trim(p_permanent_shop_id), '') else null end
    )
    returning users.id, users.full_name, users.phone, users.whatsapp_phone,
      users.whatsapp_same_as_phone, users.date_of_birth, users.address,
      users.role, users.user_category, users.supervisor_id,
      users.permanent_shop_id, users.avatar_url, users.profile_updated_at;
end;
$function$;

grant execute on function public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text, text, boolean, date, text, text) to anon, authenticated;
