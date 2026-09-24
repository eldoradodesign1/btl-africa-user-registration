-- BTL Africa: reject unknown creators explicitly.
-- In PostgreSQL, NULL NOT IN (...) evaluates to NULL, not TRUE.
-- The explicit NULL guard prevents unauthenticated creation through the RPC.
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
  if creator_role is null or creator_role not in ('admin', 'super_admin', 'supervisor', 'sub_admin') then
    raise exception 'administrative_creator_required' using errcode = '42501';
  end if;
  if creator_role in ('supervisor', 'sub_admin') and p_role <> 'agent' then
    raise exception 'staff_can_create_agents_only' using errcode = '42501';
  end if;
  if char_length(normalized_name) < 2 then raise exception 'full_name_required' using errcode = '22023'; end if;
  if p_phone is null or p_phone !~ '^(08|09)[0-9]{8}$' then raise exception 'phone_invalid' using errcode = '22023'; end if;
  if p_password is null or char_length(p_password) < 6 then raise exception 'password_too_short' using errcode = '22023'; end if;
  if p_role not in ('agent', 'supervisor', 'sub_admin', 'admin', 'super_admin') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_user_category is not null and p_user_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations') then raise exception 'invalid_category' using errcode = '22023'; end if;
  stored_category := case when p_role = 'agent' then p_user_category else coalesce(p_user_category, 'operations') end;
  if stored_category is null then raise exception 'agent_category_required' using errcode = '22023'; end if;
  if coalesce(p_whatsapp_same_as_phone, true) then
    normalized_whatsapp := p_phone;
  else
    normalized_whatsapp := nullif(trim(p_whatsapp_phone), '');
    if normalized_whatsapp is null or normalized_whatsapp !~ '^(08|09)[0-9]{8}$' then raise exception 'whatsapp_phone_invalid' using errcode = '22023'; end if;
  end if;
  if p_supervisor_id is not null and not exists (select 1 from public.users u where u.id = p_supervisor_id and u.role in ('supervisor', 'sub_admin', 'admin', 'super_admin')) then raise exception 'invalid_supervisor' using errcode = '22023'; end if;
  return query
    insert into public.users (id, full_name, phone, whatsapp_phone, whatsapp_same_as_phone, date_of_birth, address, avatar_url, password_hash, role, user_category, supervisor_id, permanent_shop_id)
    values (p_id, normalized_name, p_phone, normalized_whatsapp, coalesce(p_whatsapp_same_as_phone, true), p_date_of_birth, nullif(trim(p_address), ''), nullif(trim(p_avatar_url), ''), p_password, p_role, stored_category, p_supervisor_id, case when p_role = 'agent' then nullif(trim(p_permanent_shop_id), '') else null end)
    returning users.id, users.full_name, users.phone, users.whatsapp_phone, users.whatsapp_same_as_phone, users.date_of_birth, users.address, users.role, users.user_category, users.supervisor_id, users.permanent_shop_id, users.avatar_url, users.profile_updated_at;
end;
$function$;
grant execute on function public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text, text, boolean, date, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
