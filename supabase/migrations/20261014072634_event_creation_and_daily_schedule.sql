-- BTL Africa: creation of event campaigns with a per-day attendance schedule.
-- Events remain campaigns with campaign_type = 'event'. Their planned attendance
-- windows are stored separately because they can change from one day to another.

create table if not exists public.event_days (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  event_date date not null,
  arrival_from time not null,
  arrival_until time not null,
  departure_from time not null,
  departure_until time not null,
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_days_arrival_window_check check (arrival_from <= arrival_until),
  constraint event_days_departure_window_check check (departure_from <= departure_until),
  constraint event_days_campaign_date_unique unique (campaign_id, event_date)
);

create index if not exists event_days_campaign_date_idx
  on public.event_days (campaign_id, event_date);

alter table public.event_days enable row level security;
revoke all on table public.event_days from anon, authenticated;

create or replace function public.create_event_campaign(
  p_creator_id text,
  p_code text,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_days jsonb
)
returns public.campaigns
language plpgsql
security definer
set search_path = public
as $function$
declare
  creator_role text;
  created_campaign public.campaigns;
  day_row jsonb;
  day_date date;
  day_count integer;
begin
  select u.role into creator_role
  from public.users u
  where u.id = p_creator_id and u.is_active = true;

  if creator_role is null or creator_role not in ('admin', 'super_admin', 'sub_admin') then
    raise exception 'event_creator_not_allowed' using errcode = '42501';
  end if;
  if char_length(trim(p_name)) < 2 then
    raise exception 'event_name_invalid' using errcode = '22023';
  end if;
  if trim(p_code) !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
    raise exception 'event_code_invalid' using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null or p_starts_on > p_ends_on then
    raise exception 'event_dates_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_days) <> 'array' then
    raise exception 'event_schedule_invalid' using errcode = '22023';
  end if;

  day_count := jsonb_array_length(p_days);
  if day_count = 0 or day_count <> (p_ends_on - p_starts_on + 1) then
    raise exception 'event_schedule_incomplete' using errcode = '22023';
  end if;

  for day_row in select value from jsonb_array_elements(p_days)
  loop
    begin
      day_date := (day_row->>'event_date')::date;
      if day_date < p_starts_on or day_date > p_ends_on then
        raise exception 'event_schedule_date_outside_range' using errcode = '22023';
      end if;
      if nullif(day_row->>'arrival_from', '') is null
        or nullif(day_row->>'arrival_until', '') is null
        or nullif(day_row->>'departure_from', '') is null
        or nullif(day_row->>'departure_until', '') is null then
        raise exception 'event_schedule_time_missing' using errcode = '22023';
      end if;
      if (day_row->>'arrival_from')::time > (day_row->>'arrival_until')::time
        or (day_row->>'departure_from')::time > (day_row->>'departure_until')::time then
        raise exception 'event_schedule_window_invalid' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(p_days) other
        where (other->>'event_date')::date = day_date
        and other <> day_row
      ) then
        raise exception 'event_schedule_duplicate_date' using errcode = '22023';
      end if;
    exception when invalid_text_representation then
      raise exception 'event_schedule_date_invalid' using errcode = '22023';
    end;
  end loop;

  insert into public.campaigns (code, name, campaign_type, status, starts_on, ends_on)
  values (lower(trim(p_code)), trim(p_name), 'event', 'active', p_starts_on, p_ends_on)
  returning * into created_campaign;

  insert into public.event_days (
    campaign_id, event_date, arrival_from, arrival_until,
    departure_from, departure_until, created_by
  )
  select
    created_campaign.id,
    (value->>'event_date')::date,
    (value->>'arrival_from')::time,
    (value->>'arrival_until')::time,
    (value->>'departure_from')::time,
    (value->>'departure_until')::time,
    p_creator_id
  from jsonb_array_elements(p_days);

  return created_campaign;
exception
  when unique_violation then
    raise exception 'event_code_already_exists' using errcode = '23505';
end;
$function$;

grant execute on function public.create_event_campaign(text, text, text, date, date, jsonb) to anon, authenticated;

create or replace function public.list_event_days(p_campaign_id uuid)
returns table (
  id uuid,
  campaign_id uuid,
  event_date date,
  arrival_from time,
  arrival_until time,
  departure_from time,
  departure_until time
)
language sql
security definer
set search_path = public
as $function$
  select d.id, d.campaign_id, d.event_date, d.arrival_from, d.arrival_until,
    d.departure_from, d.departure_until
  from public.event_days d
  where d.campaign_id = p_campaign_id
  order by d.event_date;
$function$;

grant execute on function public.list_event_days(uuid) to anon, authenticated;

-- The campaign realtime event already refreshes the dashboard after creation.
-- Keep the schedule itself available for future edits and calendar display.
notify pgrst, 'reload schema';
