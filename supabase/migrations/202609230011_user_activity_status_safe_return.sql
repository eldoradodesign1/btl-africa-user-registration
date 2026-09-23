-- BTL Africa: never return password_hash from the activity-status RPC.

drop function if exists public.set_user_activity_status(text, text, boolean);

create or replace function public.set_user_activity_status(
  p_actor_id text,
  p_user_id text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text;
  target_role text;
  updated_user public.users;
begin
  select u.role into actor_role
  from public.users u
  where u.id = p_actor_id;

  if actor_role is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;

  select u.role into target_role
  from public.users u
  where u.id = p_user_id;

  if target_role is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if actor_role = 'super_admin' then
    null;
  elsif target_role = 'super_admin' then
    raise exception 'super_admin_protected' using errcode = '42501';
  elsif actor_role = 'admin' then
    null;
  elsif actor_role = 'sub_admin' and target_role in ('supervisor', 'agent') then
    null;
  elsif actor_role = 'supervisor' and target_role = 'agent' then
    null;
  else
    raise exception 'activity_status_forbidden' using errcode = '42501';
  end if;

  update public.users
  set is_active = p_is_active
  where id = p_user_id
  returning * into updated_user;

  return jsonb_build_object(
    'id', updated_user.id,
    'full_name', updated_user.full_name,
    'phone', updated_user.phone,
    'whatsapp_phone', updated_user.whatsapp_phone,
    'whatsapp_same_as_phone', updated_user.whatsapp_same_as_phone,
    'date_of_birth', updated_user.date_of_birth,
    'address', updated_user.address,
    'role', updated_user.role,
    'user_category', updated_user.user_category,
    'is_active', updated_user.is_active,
    'supervisor_id', updated_user.supervisor_id,
    'permanent_shop_id', updated_user.permanent_shop_id,
    'avatar_url', updated_user.avatar_url,
    'profile_updated_at', updated_user.profile_updated_at
  );
end;
$function$;

grant execute on function public.set_user_activity_status(text, text, boolean) to anon, authenticated;
