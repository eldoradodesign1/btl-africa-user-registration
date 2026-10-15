-- Qualify `id` references because the RPC's RETURNS TABLE declares an output
-- variable named `id`, which otherwise makes PL/pgSQL references ambiguous.
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
  p_ballerina_size text default null
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
  address text,
  address_province text,
  address_commune text,
  address_quartier text,
  address_avenue text,
  address_number text,
  address_latitude double precision,
  address_longitude double precision,
  shirt_size text,
  jacket_size text,
  skirt_size text,
  dress_size text,
  heel_size text,
  sneaker_size text,
  ballerina_size text,
  profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  current_password text;
begin
  select u.password_hash
    into current_password
    from public.users as u
    where u.id = p_user_id
    for update;

  if current_password is null or p_current_password is null or current_password <> p_current_password then
    raise exception 'current_password_invalid' using errcode = '42501';
  end if;
  if char_length(trim(p_full_name)) < 2 then
    raise exception 'full_name_invalid' using errcode = '22023';
  end if;
  if p_phone !~ '^(08|09)[0-9]{8}$' then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;

  update public.users as u
    set full_name = trim(p_full_name),
        phone = p_phone,
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
        profile_updated_at = now()
    where u.id = p_user_id;

  return query
    select u.id, u.full_name, u.phone, u.role, u.user_category,
           u.supervisor_id, u.permanent_shop_id, u.avatar_url, u.address,
           u.address_province, u.address_commune, u.address_quartier,
           u.address_avenue, u.address_number, u.address_latitude,
           u.address_longitude, u.shirt_size, u.jacket_size, u.skirt_size,
           u.dress_size, u.heel_size, u.sneaker_size, u.ballerina_size,
           u.profile_updated_at
    from public.users as u
    where u.id = p_user_id;
end;
$function$;

grant execute on function public.update_my_profile(
  text, text, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, text, text, text, text, text
) to anon, authenticated;

notify pgrst, 'reload schema';
