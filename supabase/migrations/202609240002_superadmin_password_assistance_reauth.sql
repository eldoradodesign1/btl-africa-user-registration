-- BTL Africa: require live superadmin re-authentication for password assistance.
-- This replaces the first helper signature so an actor id alone is never enough.

drop function if exists public.list_user_passwords_for_super_admin(text);

create or replace function public.list_user_passwords_for_super_admin(
  p_actor_id text,
  p_actor_password text
)
returns table(user_id text, password_hash text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text;
begin
  select u.role into actor_role
  from public.users u
  where u.id = p_actor_id
    and u.password_hash = p_actor_password;

  if actor_role <> 'super_admin' then
    raise exception 'super_admin_reauthentication_required' using errcode = '42501';
  end if;

  return query
  select u.id, u.password_hash
  from public.users u
  order by u.full_name;
end;
$function$;

grant execute on function public.list_user_passwords_for_super_admin(text, text) to anon, authenticated;
