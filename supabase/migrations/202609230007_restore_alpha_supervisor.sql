-- BTL Africa: restore Alpha Okito to the supervisor role.
update public.users
set role = 'supervisor',
    user_category = 'operations'
where id = 'usr-youth-alpha-okito';
