-- BTL Africa: profile updates with current-password confirmation.
-- Passwords remain stored exactly as in the existing project.

-- The parameter list changes, so remove the previous five-argument signature first.
drop function if exists public.update_my_profile(text, text, text, text, text);

create or replace function public.update_my_profile(
  p_user_id text,
  p_full_name text,
  p_phone text,
  p_password text default null,
  p_avatar_url text default null,
  p_current_password text default null
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
  current_password text;
begin
  select u.password_hash into current_password
  from public.users u
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
  if exists (select 1 from public.users u where u.phone = p_phone and u.id <> p_user_id) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;
  if p_password is not null and char_length(p_password) < 6 then
    raise exception 'password_invalid' using errcode = '22023';
  end if;
  if p_avatar_url is not null and char_length(p_avatar_url) > 700000 then
    raise exception 'avatar_too_large' using errcode = '22023';
  end if;

  update public.users u
  set full_name = trim(p_full_name),
      phone = p_phone,
      password_hash = coalesce(nullif(p_password, ''), u.password_hash),
      avatar_url = p_avatar_url,
      profile_updated_at = now()
  where u.id = p_user_id;

  return query
    select u.id, u.full_name, u.phone, u.role, u.user_category,
      u.supervisor_id, u.permanent_shop_id, u.avatar_url, u.profile_updated_at
    from public.users u where u.id = p_user_id;
end;
$function$;

grant execute on function public.update_my_profile(text, text, text, text, text, text) to anon, authenticated;
