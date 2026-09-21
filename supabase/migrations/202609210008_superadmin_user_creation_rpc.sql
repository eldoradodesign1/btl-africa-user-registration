-- BTL Africa: superadmin user creation through a controlled RPC.
-- This avoids relying on direct INSERT privileges from the publishable browser key.

create or replace function public.create_user_by_super_admin(
  p_id text,
  p_creator_id text,
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
declare
  creator_role text;
  normalized_name text := trim(p_full_name);
begin
  select u.role into creator_role from public.users u where u.id = p_creator_id;
  if creator_role is null or creator_role <> 'super_admin' then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;
  if char_length(normalized_name) < 2 then
    raise exception 'full_name_required' using errcode = '22023';
  end if;
  if p_phone is null or char_length(trim(p_phone)) = 0 then
    raise exception 'phone_required' using errcode = '22023';
  end if;
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'password_too_short' using errcode = '22023';
  end if;
  if p_role not in ('agent', 'supervisor', 'sub_admin', 'admin', 'super_admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_role = 'agent' and p_user_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations') then
    raise exception 'agent_category_required' using errcode = '22023';
  end if;
  if p_role <> 'agent' and p_user_category is not null then
    raise exception 'category_only_for_agents' using errcode = '22023';
  end if;
  if p_supervisor_id is not null and not exists (select 1 from public.users u where u.id = p_supervisor_id and u.role in ('supervisor', 'sub_admin', 'admin', 'super_admin')) then
    raise exception 'invalid_supervisor' using errcode = '22023';
  end if;

  return query
    insert into public.users (id, full_name, phone, password_hash, role, user_category, supervisor_id, permanent_shop_id)
    values (
      p_id,
      normalized_name,
      trim(p_phone),
      p_password,
      p_role,
      case when p_role = 'agent' then p_user_category else null end,
      p_supervisor_id,
      case when p_role = 'agent' then nullif(trim(p_permanent_shop_id), '') else null end
    )
    returning users.id, users.full_name, users.phone, users.role, users.user_category, users.supervisor_id, users.permanent_shop_id, users.avatar_url, users.profile_updated_at;
end;
$function$;

grant execute on function public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text) to anon, authenticated;
