-- BTL Africa: lock password assistance behind strict superadmin re-authentication.
-- The previous function could accept a NULL/unknown actor because NULL comparisons
-- do not enter a PL/pgSQL IF branch. Remove the legacy overload and reject every
-- missing, unknown, non-superadmin, or mismatched credential explicitly.

drop function if exists public.list_user_passwords_for_super_admin(text);
drop function if exists public.list_user_passwords_for_super_admin(text, text);

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
  if nullif(trim(coalesce(p_actor_id, '')), '') is null
     or p_actor_password is null
     or p_actor_password = '' then
    raise exception 'super_admin_reauthentication_required' using errcode = '42501';
  end if;

  select u.role
    into actor_role
  from public.users u
  where u.id = p_actor_id
    and u.password_hash = p_actor_password;

  if actor_role is null or actor_role <> 'super_admin' then
    raise exception 'super_admin_reauthentication_required' using errcode = '42501';
  end if;

  return query
    select u.id, u.password_hash
    from public.users u
    order by u.full_name;
end;
$function$;

revoke all on function public.list_user_passwords_for_super_admin(text, text) from public;
grant execute on function public.list_user_passwords_for_super_admin(text, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

-- Keep this result intentionally empty in normal operation; the migration only
-- changes the function contract and does not alter user records.
comment on function public.list_user_passwords_for_super_admin(text, text)
  is 'Support-only password assistance. Requires exact super_admin id and password.';

