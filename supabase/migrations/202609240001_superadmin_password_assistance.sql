-- BTL Africa: support-only password assistance.
-- This RPC is intentionally separate from the normal users query. It accepts
-- only a real public.users id whose role is super_admin and returns no rows to
-- any other role. The frontend never includes password_hash in its standard
-- user payloads.

create or replace function public.list_user_passwords_for_super_admin(p_actor_id text)
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
  where u.id = p_actor_id;

  if actor_role <> 'super_admin' then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;

  return query
  select u.id, u.password_hash
  from public.users u
  order by u.full_name;
end;
$function$;

grant execute on function public.list_user_passwords_for_super_admin(text) to anon, authenticated;
