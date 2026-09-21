-- BTL Africa: self-service agent registration with super_admin approval.
-- Run this migration in the project that contains public.users.

create table if not exists public.user_registration_requests (
  id uuid primary key,
  full_name text not null check (char_length(trim(full_name)) >= 2),
  phone text not null,
  password_hash text not null,
  role text not null default 'agent' check (role = 'agent'),
  user_category text not null check (user_category in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text references public.users(id),
  review_note text
);

-- The existing project stores public.users.id as text.
alter table public.user_registration_requests
  alter column reviewed_by type text using reviewed_by::text;

create index if not exists user_registration_requests_status_created_at_idx
  on public.user_registration_requests (status, created_at desc);

create unique index if not exists user_registration_requests_pending_phone_idx
  on public.user_registration_requests (phone)
  where status = 'pending';

alter table public.user_registration_requests enable row level security;

revoke all on table public.user_registration_requests from anon, authenticated;

drop function if exists public.create_registration_request(uuid, text, text, text, text);
drop function if exists public.list_pending_registration_requests(uuid);
drop function if exists public.list_pending_registration_requests(text);
drop function if exists public.approve_registration_request(uuid, uuid);
drop function if exists public.approve_registration_request(uuid, text);
drop function if exists public.reject_registration_request(uuid, uuid, text);
drop function if exists public.reject_registration_request(uuid, text, text);

do $$
begin
  create function public.create_registration_request(
      p_request_id uuid,
      p_full_name text,
      p_phone text,
      p_password_hash text,
      p_user_category text
    ) returns table (
      id uuid, full_name text, phone text, role text, user_category text,
      status text, created_at timestamptz, reviewed_at timestamptz,
      reviewed_by text, review_note text
    )
    language plpgsql
    security definer
    set search_path = public
    as $function$
    declare
      created_request public.user_registration_requests;
    begin
      if char_length(trim(p_full_name)) < 2 then
        raise exception 'full_name_invalid' using errcode = '22023';
      end if;
      if p_phone !~ '^(08|09)[0-9]{8}$' then
        raise exception 'phone_invalid' using errcode = '22023';
      end if;
      if p_password_hash is null or char_length(p_password_hash) < 6 then
        raise exception 'password_invalid' using errcode = '22023';
      end if;
      if p_user_category not in ('hostess', 'brand_ambassador', 'brand_ambassador_youth', 'operations') then
        raise exception 'category_invalid' using errcode = '22023';
      end if;
      if exists (select 1 from public.users u where u.phone = p_phone)
        or exists (select 1 from public.user_registration_requests r where r.phone = p_phone and r.status = 'pending') then
        raise exception 'phone_already_registered' using errcode = '23505';
      end if;

      insert into public.user_registration_requests (id, full_name, phone, password_hash, role, user_category)
      values (p_request_id, trim(p_full_name), p_phone, p_password_hash, 'agent', p_user_category)
      returning * into created_request;

      return query select created_request.id, created_request.full_name, created_request.phone,
        created_request.role, created_request.user_category, created_request.status,
        created_request.created_at, created_request.reviewed_at, created_request.reviewed_by,
        created_request.review_note;
    end;
    $function$;
end
$$;

do $$
begin
  create function public.list_pending_registration_requests(p_reviewer_id text)
    returns table (
      id uuid, full_name text, phone text, role text, user_category text,
      status text, created_at timestamptz, reviewed_at timestamptz,
      reviewed_by text, review_note text
    )
    language plpgsql
    security definer
    set search_path = public
    as $function$
    begin
      if not exists (select 1 from public.users where id = p_reviewer_id and role = 'super_admin') then
        raise exception 'super_admin_required' using errcode = '42501';
      end if;
      return query
        select r.id, r.full_name, r.phone, r.role, r.user_category,
          r.status, r.created_at, r.reviewed_at, r.reviewed_by, r.review_note
        from public.user_registration_requests r
        where r.status = 'pending'
        order by r.created_at asc;
    end;
    $function$;
end
$$;

do $$
begin
  create function public.approve_registration_request(p_request_id uuid, p_reviewer_id text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $function$
    declare
      request_row public.user_registration_requests;
      approved_user public.users;
    begin
      if not exists (select 1 from public.users where id = p_reviewer_id and role = 'super_admin') then
        raise exception 'super_admin_required' using errcode = '42501';
      end if;

      select * into request_row from public.user_registration_requests
      where id = p_request_id and status = 'pending'
      for update;
      if not found then
        raise exception 'registration_request_not_pending' using errcode = 'P0002';
      end if;
      if exists (select 1 from public.users u where u.phone = request_row.phone) then
        raise exception 'phone_already_registered' using errcode = '23505';
      end if;

      insert into public.users (id, full_name, phone, password_hash, role, user_category, supervisor_id, permanent_shop_id)
      values (request_row.id::text, request_row.full_name, request_row.phone, request_row.password_hash, 'agent', request_row.user_category, null, null)
      returning * into approved_user;

      update public.user_registration_requests
      set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer_id
      where id = request_row.id;

      return jsonb_build_object(
        'id', approved_user.id,
        'full_name', approved_user.full_name,
        'phone', approved_user.phone,
        'role', approved_user.role,
        'user_category', approved_user.user_category,
        'supervisor_id', approved_user.supervisor_id,
        'permanent_shop_id', approved_user.permanent_shop_id
      );
    end;
    $function$;
end
$$;

do $$
begin
  create function public.reject_registration_request(p_request_id uuid, p_reviewer_id text, p_review_note text default null)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $function$
    begin
      if not exists (select 1 from public.users where id = p_reviewer_id and role = 'super_admin') then
        raise exception 'super_admin_required' using errcode = '42501';
      end if;
      update public.user_registration_requests
      set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer_id, review_note = nullif(trim(p_review_note), '')
      where id = p_request_id and status = 'pending';
      if not found then
        raise exception 'registration_request_not_pending' using errcode = 'P0002';
      end if;
    end;
    $function$;
end
$$;

grant execute on function public.create_registration_request(uuid, text, text, text, text) to anon, authenticated;
-- The existing application uses its own users/password_hash session rather than
-- Supabase Auth, so the browser calls these RPCs as anon. Each reviewer-facing
-- function validates the supplied user id and role inside SECURITY DEFINER.
grant execute on function public.list_pending_registration_requests(text) to anon, authenticated;
grant execute on function public.approve_registration_request(uuid, text) to anon, authenticated;
grant execute on function public.reject_registration_request(uuid, text, text) to anon, authenticated;
