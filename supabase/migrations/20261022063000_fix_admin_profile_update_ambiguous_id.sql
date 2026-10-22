-- Fix the admin profile update RPC: the users.id reference in the
-- user-not-found guard conflicts with the RETURNS TABLE id variable.
-- No business rule is changed; only the column is explicitly qualified.

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
  if not exists (select 1 from public.users u where u.id = p_user_id) then
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
  if p_user_category is not null and p_user_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations') then
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
notify pgrst, 'reload schema';
