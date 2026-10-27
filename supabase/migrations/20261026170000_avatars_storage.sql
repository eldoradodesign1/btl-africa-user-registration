-- Photos de profil dans Supabase Storage au lieu de data URL (base64) en base.
-- Les fichiers vont dans le bucket public « avatars » sous « <id>/<nom>.jpg »
-- (id du compte, identique à l'id de la demande d'inscription validée) ;
-- users.avatar_url et user_registration_requests.avatar_url gardent l'URL
-- publique, utilisable telle quelle comme src d'image par tous les modules.
--
-- Compatible avec le front déjà publié : les RPC acceptent encore une data URL
-- pendant la transition (scripts/migrate-avatars.mjs les convertit ensuite).
-- Signatures et types de retour inchangés ; approve_registration_request n'est
-- pas modifiée : elle recopie l'URL de la demande, déjà au bon format.
--
-- Aucune photo n'est perdue : avant toute modification, une copie intacte de
-- chaque data URL est gardée dans avatar_legacy_backups ; la reprise ne remplace
-- une valeur que si cette copie existe et que le fichier a été relu depuis Storage.

-- 0. Sauvegarde des photos d'origine (invisible des clients : RLS sans politique,
-- aucun droit pour anon/authenticated). À supprimer seulement sur décision
-- explicite, une fois toutes les photos vérifiées dans l'application.
create table if not exists public.avatar_legacy_backups (
  source text not null check (source in ('users', 'user_registration_requests')),
  row_id text not null,
  md5 text not null,
  avatar_url text not null,
  backed_up_at timestamptz not null default now(),
  storage_url text,
  verified_at timestamptz,
  primary key (source, row_id, md5)
);
alter table public.avatar_legacy_backups enable row level security;
revoke all on public.avatar_legacy_backups from public, anon, authenticated;
comment on table public.avatar_legacy_backups is
  'Copie intacte des photos de profil en data URL avant leur passage dans Storage (bucket avatars). storage_url/verified_at : fichier relu avec succès. Ne pas supprimer sans accord explicite.';

insert into public.avatar_legacy_backups (source, row_id, md5, avatar_url)
select 'users', u.id, md5(u.avatar_url), u.avatar_url
  from public.users u where u.avatar_url like 'data:%'
union all
select 'user_registration_requests', r.id::text, md5(r.avatar_url), r.avatar_url
  from public.user_registration_requests r where r.avatar_url like 'data:%'
on conflict do nothing;

-- 1. Bucket public en lecture : l'URL publique sert directement l'image, sans
-- politique SELECT. JPEG uniquement (resizeImage et la reprise produisent du
-- JPEG 640 px, ~50-150 Ko) et 1 Mo maximum par fichier.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Écriture : la connexion est applicative (clé publishable, rôle anon), sans
-- session Supabase Auth ; Storage ne peut donc pas savoir qui envoie. On autorise
-- seulement l'ajout de nouveaux fichiers « <id>/<nom>.jpg ». Sans politique
-- UPDATE ni DELETE, une photo existante ne peut être ni remplacée ni supprimée
-- depuis le client : chaque nouvelle photo a un nouveau nom.
drop policy if exists avatars_insert_app on storage.objects;
create policy avatars_insert_app on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'avatars'
    and name ~ '^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}\.jpg$'
  );

-- 3. Valeur acceptée pour avatar_url : null, URL publique du bucket avatars,
-- ou data URL d'image envoyée par l'ancien front (transition uniquement).
create or replace function public.normalize_avatar_url(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $function$
declare
  v text := nullif(trim(p_value), '');
begin
  if v is null then
    return null;
  end if;
  if v ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}\.jpg$' then
    return v;
  end if;
  -- Transition : ancien front encore en cache sur certains téléphones.
  if v ~ '^data:image/[a-z0-9.+-]+;base64,' then
    return v;
  end if;
  raise exception 'avatar_url_invalid' using errcode = '22023';
end;
$function$;

revoke execute on function public.normalize_avatar_url(text) from public, anon, authenticated;

comment on column public.users.avatar_url is
  'URL publique du bucket Storage avatars (<id>/<nom>.jpg). Data URL héritée tolérée pendant la transition.';
comment on column public.user_registration_requests.avatar_url is
  'URL publique du bucket Storage avatars (<id>/<nom>.jpg). Data URL héritée tolérée pendant la transition.';

-- 4. Inscription : avatar passé par normalize_avatar_url (seul changement).
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
    p_address_latitude, p_address_longitude, public.normalize_avatar_url(p_avatar_url), p_password_hash, 'agent', p_user_category, normalized_mpesa
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

-- 5. Profil : avatar passé par normalize_avatar_url (seul changement).
create or replace function public.update_my_profile(
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
        avatar_url = public.normalize_avatar_url(p_avatar_url),
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

-- 6. Création par un administratif : avatar passé par normalize_avatar_url (seul changement).
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
    p_address_latitude, p_address_longitude, public.normalize_avatar_url(p_avatar_url), p_password, p_role, stored_category,
    p_supervisor_id, case when p_role = 'agent' then nullif(trim(p_permanent_shop_id), '') else null end, normalized_mpesa
  ) returning users.id, users.full_name, users.phone, users.whatsapp_phone, users.whatsapp_same_as_phone,
    users.date_of_birth, users.address, users.address_province, users.address_commune, users.address_quartier,
    users.address_avenue, users.address_number, users.address_latitude, users.address_longitude, users.role,
    users.user_category, users.supervisor_id, users.permanent_shop_id, users.avatar_url, users.profile_updated_at,
    users.mpesa_phone;
end;
$function$;

notify pgrst, 'reload schema';
