-- BTL Africa: profile photo persistence.
-- Safe to run on projects that already have these columns.

alter table public.users
  add column if not exists avatar_url text;

alter table public.users
  add column if not exists profile_updated_at timestamptz;

create index if not exists users_profile_updated_at_idx
  on public.users (profile_updated_at desc);
