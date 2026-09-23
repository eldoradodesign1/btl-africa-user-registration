-- BTL Africa: explicit activity status for user accounts.
-- Existing users remain active; no historical row is disabled by this migration.

alter table public.users
  add column if not exists is_active boolean not null default true;

comment on column public.users.is_active is
  'Indique si le compte est actif. La valeur est principalement utilisée pour les agents.';

create index if not exists users_is_active_idx
  on public.users (is_active);
