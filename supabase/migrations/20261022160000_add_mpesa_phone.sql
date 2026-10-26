-- Numéro M-Pesa distinct du numéro de connexion.
-- Le numéro de connexion (users.phone) est désormais le numéro WhatsApp ; le
-- numéro M-Pesa est facultatif, au format local 08XXXXXXXX. Les comptes
-- existants restent vides : l'interface invite chacun à le renseigner.
-- Compatible avec le front déjà publié : chaque nouveau paramètre a une valeur
-- par défaut et les colonnes ajoutées en sortie sont ignorées par l'ancien code.

alter table public.users add column if not exists mpesa_phone text;
alter table public.user_registration_requests add column if not exists mpesa_phone text;

alter table public.users drop constraint if exists users_mpesa_phone_format;
alter table public.users
  add constraint users_mpesa_phone_format check (mpesa_phone is null or mpesa_phone ~ '^08[0-9]{8}$');
alter table public.user_registration_requests drop constraint if exists user_registration_requests_mpesa_phone_format;
alter table public.user_registration_requests
  add constraint user_registration_requests_mpesa_phone_format check (mpesa_phone is null or mpesa_phone ~ '^08[0-9]{8}$');

-- Inscription : nouveau paramètre p_mpesa_phone, renvoyé en sortie.
drop function if exists public.create_registration_request(uuid, text, text, text, boolean, date, text, text, text, text, text, text, double precision, double precision, text, text, text);
create function public.create_registration_request(
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
  p_user_category text default null,
  p_mpesa_phone text default null
)
returns table (
  id uuid, full_name text, phone text, whatsapp_phone text, whatsapp_same_as_phone boolean, date_of_birth date,
  address text, address_province text, address_commune text, address_quartier text, address_avenue text,
  address_number text, address_latitude double precision, address_longitude double precision, avatar_url text,
  role text, user_category text, status text, created_at timestamp with time zone,
  reviewed_at timestamp with time zone, reviewed_by text, review_note text, mpesa_phone text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  created_request public.user_registration_requests;
  normalized_whatsapp text;
  normalized_mpesa text := nullif(trim(p_mpesa_phone), '');
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
  if normalized_mpesa is not null and normalized_mpesa !~ '^08[0-9]{8}$' then raise exception 'mpesa_phone_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.users u where u.phone = p_phone)
    or exists (select 1 from public.user_registration_requests r where r.phone = p_phone and r.status = 'pending') then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;
  insert into public.user_registration_requests (
    id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone, date_of_birth, address,
    address_province, address_commune, address_quartier, address_avenue, address_number,
    address_latitude, address_longitude, avatar_url, password_hash, role, user_category, mpesa_phone
  ) values (
    p_request_id, trim(p_full_name), p_phone, normalized_whatsapp, coalesce(p_whatsapp_same_as_phone, true),
    p_date_of_birth, nullif(trim(p_address), ''), nullif(trim(p_address_province), ''), nullif(trim(p_address_commune), ''),
    nullif(trim(p_address_quartier), ''), nullif(trim(p_address_avenue), ''), nullif(trim(p_address_number), ''),
    p_address_latitude, p_address_longitude, nullif(trim(p_avatar_url), ''), p_password_hash, 'agent', p_user_category, normalized_mpesa
  ) returning * into created_request;
  return query select created_request.id, created_request.full_name, created_request.phone, created_request.whatsapp_phone,
    created_request.whatsapp_same_as_phone, created_request.date_of_birth, created_request.address,
    created_request.address_province, created_request.address_commune, created_request.address_quartier,
    created_request.address_avenue, created_request.address_number, created_request.address_latitude,
    created_request.address_longitude, created_request.avatar_url, created_request.role, created_request.user_category,
    created_request.status, created_request.created_at, created_request.reviewed_at, created_request.reviewed_by,
    created_request.review_note, created_request.mpesa_phone;
end;
$function$;

-- Liste des demandes en attente : ajoute mpesa_phone en sortie.
drop function if exists public.list_pending_registration_requests(text);
create function public.list_pending_registration_requests(p_reviewer_id text)
returns table (
  id uuid, full_name text, phone text, whatsapp_phone text, whatsapp_same_as_phone boolean, date_of_birth date,
  address text, address_province text, address_commune text, address_quartier text, address_avenue text,
  address_number text, address_latitude double precision, address_longitude double precision, avatar_url text,
  role text, user_category text, status text, created_at timestamp with time zone,
  reviewed_at timestamp with time zone, reviewed_by text, review_note text, mpesa_phone text
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.users u where u.id = p_reviewer_id and u.role = 'super_admin') then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;
  return query select r.id, r.full_name, r.phone, r.whatsapp_phone, r.whatsapp_same_as_phone, r.date_of_birth, r.address,
    r.address_province, r.address_commune, r.address_quartier, r.address_avenue, r.address_number, r.address_latitude,
    r.address_longitude, r.avatar_url, r.role, r.user_category, r.status, r.created_at, r.reviewed_at, r.reviewed_by,
    r.review_note, r.mpesa_phone
  from public.user_registration_requests r
  where r.status = 'pending'
  order by r.created_at asc;
end;
$function$;

-- Validation : recopie mpesa_phone dans le compte créé (signature inchangée).
create or replace function public.approve_registration_request(p_request_id uuid, p_reviewer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r public.user_registration_requests;
  u public.users;
begin
  if not exists (select 1 from public.users x where x.id = p_reviewer_id and x.role = 'super_admin') then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;
  select * into r from public.user_registration_requests x where x.id = p_request_id and x.status = 'pending' for update;
  if not found then raise exception 'registration_request_not_pending' using errcode = 'P0002'; end if;
  insert into public.users (
    id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone, date_of_birth, address, address_province,
    address_commune, address_quartier, address_avenue, address_number, address_latitude, address_longitude,
    avatar_url, password_hash, role, user_category, supervisor_id, permanent_shop_id, mpesa_phone
  ) values (
    r.id::text, r.full_name, r.phone, r.whatsapp_phone, r.whatsapp_same_as_phone, r.date_of_birth, r.address,
    r.address_province, r.address_commune, r.address_quartier, r.address_avenue, r.address_number, r.address_latitude,
    r.address_longitude, r.avatar_url, r.password_hash, 'agent', r.user_category, null, null, r.mpesa_phone
  ) returning * into u;
  update public.user_registration_requests set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer_id where id = r.id;
  return jsonb_build_object(
    'id', u.id, 'full_name', u.full_name, 'phone', u.phone, 'whatsapp_phone', u.whatsapp_phone,
    'whatsapp_same_as_phone', u.whatsapp_same_as_phone, 'date_of_birth', u.date_of_birth, 'address', u.address,
    'address_province', u.address_province, 'address_commune', u.address_commune, 'address_quartier', u.address_quartier,
    'address_avenue', u.address_avenue, 'address_number', u.address_number, 'address_latitude', u.address_latitude,
    'address_longitude', u.address_longitude, 'avatar_url', u.avatar_url, 'role', u.role, 'user_category', u.user_category,
    'supervisor_id', u.supervisor_id, 'permanent_shop_id', u.permanent_shop_id, 'mpesa_phone', u.mpesa_phone
  );
end;
$function$;

-- Profil : p_mpesa_phone null = inchangé (ancien front), '' = effacé.
-- Le numéro WhatsApp suit le numéro de connexion quand ils sont identiques.
drop function if exists public.update_my_profile(text, text, text, text, text, text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, boolean, boolean, boolean);
create function public.update_my_profile(
  p_user_id text,
  p_full_name text,
  p_phone text,
  p_password text default null,
  p_avatar_url text default null,
  p_current_password text default null,
  p_address text default null,
  p_address_province text default null,
  p_address_commune text default null,
  p_address_quartier text default null,
  p_address_avenue text default null,
  p_address_number text default null,
  p_address_latitude double precision default null,
  p_address_longitude double precision default null,
  p_shirt_size text default null,
  p_jacket_size text default null,
  p_skirt_size text default null,
  p_dress_size text default null,
  p_heel_size text default null,
  p_sneaker_size text default null,
  p_ballerina_size text default null,
  p_current_occupation text default null,
  p_accepts_night_work boolean default false,
  p_accepts_overnight_stay boolean default false,
  p_accepts_late_work boolean default false,
  p_mpesa_phone text default null
)
returns table (
  id text, full_name text, phone text, role text, user_category text, supervisor_id text, permanent_shop_id text,
  avatar_url text, address text, address_province text, address_commune text, address_quartier text,
  address_avenue text, address_number text, address_latitude double precision, address_longitude double precision,
  shirt_size text, jacket_size text, skirt_size text, dress_size text, heel_size text, sneaker_size text,
  ballerina_size text, current_occupation text, accepts_night_work boolean, accepts_overnight_stay boolean,
  accepts_late_work boolean, profile_updated_at timestamp with time zone, mpesa_phone text, whatsapp_phone text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  stored_password text;
  normalized_mpesa text := nullif(trim(p_mpesa_phone), '');
begin
  select u.password_hash
    into stored_password
    from public.users as u
    where u.id = p_user_id
    for update;

  if nullif(p_password, '') is not null
     and (stored_password is null or p_current_password is null or stored_password <> p_current_password) then
    raise exception 'current_password_invalid' using errcode = '42501';
  end if;

  if char_length(trim(p_full_name)) < 2 then
    raise exception 'full_name_invalid' using errcode = '22023';
  end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;
  if normalized_mpesa is not null and normalized_mpesa !~ '^08[0-9]{8}$' then
    raise exception 'mpesa_phone_invalid' using errcode = '22023';
  end if;

  update public.users as u
    set full_name = trim(p_full_name),
        phone = p_phone,
        whatsapp_phone = case when u.whatsapp_same_as_phone then p_phone else u.whatsapp_phone end,
        mpesa_phone = case when p_mpesa_phone is null then u.mpesa_phone else normalized_mpesa end,
        password_hash = coalesce(nullif(p_password, ''), u.password_hash),
        avatar_url = p_avatar_url,
        address = nullif(trim(p_address), ''),
        address_province = nullif(trim(p_address_province), ''),
        address_commune = nullif(trim(p_address_commune), ''),
        address_quartier = nullif(trim(p_address_quartier), ''),
        address_avenue = nullif(trim(p_address_avenue), ''),
        address_number = nullif(trim(p_address_number), ''),
        address_latitude = p_address_latitude,
        address_longitude = p_address_longitude,
        shirt_size = nullif(trim(p_shirt_size), ''),
        jacket_size = nullif(trim(p_jacket_size), ''),
        skirt_size = nullif(trim(p_skirt_size), ''),
        dress_size = nullif(trim(p_dress_size), ''),
        heel_size = nullif(trim(p_heel_size), ''),
        sneaker_size = nullif(trim(p_sneaker_size), ''),
        ballerina_size = nullif(trim(p_ballerina_size), ''),
        current_occupation = nullif(trim(p_current_occupation), ''),
        accepts_night_work = coalesce(p_accepts_night_work, false),
        accepts_overnight_stay = coalesce(p_accepts_overnight_stay, false),
        accepts_late_work = coalesce(p_accepts_late_work, false),
        profile_updated_at = now()
    where u.id = p_user_id;

  return query
    select u.id, u.full_name, u.phone, u.role, u.user_category,
           u.supervisor_id, u.permanent_shop_id, u.avatar_url, u.address,
           u.address_province, u.address_commune, u.address_quartier,
           u.address_avenue, u.address_number, u.address_latitude,
           u.address_longitude, u.shirt_size, u.jacket_size, u.skirt_size,
           u.dress_size, u.heel_size, u.sneaker_size, u.ballerina_size,
           u.current_occupation, u.accepts_night_work, u.accepts_overnight_stay,
           u.accepts_late_work, u.profile_updated_at, u.mpesa_phone, u.whatsapp_phone
    from public.users as u
    where u.id = p_user_id;
end;
$function$;

-- Création par un administratif : nouveau paramètre p_mpesa_phone, renvoyé en sortie.
drop function if exists public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text, text, boolean, date, text, text, text, text, text, text, double precision, double precision, text);
create function public.create_user_by_super_admin(
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
  p_address_province text default null,
  p_address_commune text default null,
  p_address_quartier text default null,
  p_address_avenue text default null,
  p_address_number text default null,
  p_address_latitude double precision default null,
  p_address_longitude double precision default null,
  p_avatar_url text default null,
  p_mpesa_phone text default null
)
returns table (
  id text, full_name text, phone text, whatsapp_phone text, whatsapp_same_as_phone boolean, date_of_birth date,
  address text, address_province text, address_commune text, address_quartier text, address_avenue text,
  address_number text, address_latitude double precision, address_longitude double precision, role text,
  user_category text, supervisor_id text, permanent_shop_id text, avatar_url text,
  profile_updated_at timestamp with time zone, mpesa_phone text
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
  normalized_mpesa text := nullif(trim(p_mpesa_phone), '');
begin
  select u.role into creator_role from public.users u where u.id = p_creator_id;
  if creator_role is null or creator_role not in ('admin', 'super_admin', 'supervisor', 'sub_admin') then raise exception 'administrative_creator_required' using errcode = '42501'; end if;
  if creator_role in ('supervisor', 'sub_admin') and p_role <> 'agent' then raise exception 'staff_can_create_agents_only' using errcode = '42501'; end if;
  if char_length(normalized_name) < 2 then raise exception 'full_name_required' using errcode = '22023'; end if;
  if p_phone is null or p_phone !~ '^(08|09)[0-9]{8}$' then raise exception 'phone_invalid' using errcode = '22023'; end if;
  if p_password is null or char_length(p_password) < 6 then raise exception 'password_too_short' using errcode = '22023'; end if;
  if p_role not in ('agent', 'supervisor', 'sub_admin', 'admin', 'super_admin') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_user_category is not null and p_user_category not in ('hostess', 'brand_ambassador', 'hostess_polyvalent', 'operations') then raise exception 'invalid_category' using errcode = '22023'; end if;
  stored_category := case when p_role = 'agent' then p_user_category else coalesce(p_user_category, 'operations') end;
  if stored_category is null then raise exception 'agent_category_required' using errcode = '22023'; end if;
  if coalesce(p_whatsapp_same_as_phone, true) then normalized_whatsapp := p_phone;
  else
    normalized_whatsapp := nullif(trim(p_whatsapp_phone), '');
    if normalized_whatsapp is null or normalized_whatsapp !~ '^(08|09)[0-9]{8}$' then raise exception 'whatsapp_phone_invalid' using errcode = '22023'; end if;
  end if;
  if normalized_mpesa is not null and normalized_mpesa !~ '^08[0-9]{8}$' then raise exception 'mpesa_phone_invalid' using errcode = '22023'; end if;
  if p_supervisor_id is not null and not exists (select 1 from public.users u where u.id = p_supervisor_id and u.role in ('supervisor', 'sub_admin', 'admin', 'super_admin')) then raise exception 'invalid_supervisor' using errcode = '22023'; end if;
  return query insert into public.users (
    id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone, date_of_birth, address, address_province,
    address_commune, address_quartier, address_avenue, address_number, address_latitude, address_longitude,
    avatar_url, password_hash, role, user_category, supervisor_id, permanent_shop_id, mpesa_phone
  ) values (
    p_id, normalized_name, p_phone, normalized_whatsapp, coalesce(p_whatsapp_same_as_phone, true), p_date_of_birth,
    nullif(trim(p_address), ''), nullif(trim(p_address_province), ''), nullif(trim(p_address_commune), ''),
    nullif(trim(p_address_quartier), ''), nullif(trim(p_address_avenue), ''), nullif(trim(p_address_number), ''),
    p_address_latitude, p_address_longitude, nullif(trim(p_avatar_url), ''), p_password, p_role, stored_category,
    p_supervisor_id, case when p_role = 'agent' then nullif(trim(p_permanent_shop_id), '') else null end, normalized_mpesa
  ) returning users.id, users.full_name, users.phone, users.whatsapp_phone, users.whatsapp_same_as_phone,
    users.date_of_birth, users.address, users.address_province, users.address_commune, users.address_quartier,
    users.address_avenue, users.address_number, users.address_latitude, users.address_longitude, users.role,
    users.user_category, users.supervisor_id, users.permanent_shop_id, users.avatar_url, users.profile_updated_at,
    users.mpesa_phone;
end;
$function$;

grant execute on function public.create_registration_request(uuid, text, text, text, boolean, date, text, text, text, text, text, text, double precision, double precision, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.list_pending_registration_requests(text) to anon, authenticated, service_role;
grant execute on function public.update_my_profile(text, text, text, text, text, text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text) to anon, authenticated, service_role;
grant execute on function public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text, text, boolean, date, text, text, text, text, text, text, double precision, double precision, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
