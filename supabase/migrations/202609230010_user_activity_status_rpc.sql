-- BTL Africa: role-scoped account activity changes.
-- The application uses business authentication in public.users, so the actor id
-- is validated explicitly inside this SECURITY DEFINER function.

create or replace function public.set_user_activity_status(
  p_actor_id text,
  p_user_id text,
  p_is_active boolean
)
returns public.users
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

  return updated_user;
end;
$function$;

grant execute on function public.set_user_activity_status(text, text, boolean) to anon, authenticated;
