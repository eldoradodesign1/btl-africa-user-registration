-- Restore the compatibility helper used by campaign and supervisor assignment RPCs.
-- This is safe to re-run and does not modify existing campaign assignments.
create or replace function public.campaign_type_allowed_for_category(
  p_campaign_type text,
  p_user_category text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_user_category = 'hostess_polyvalent'
      then p_campaign_type in ('hostess', 'brand_ambassador', 'event')
    when p_user_category = 'hostess'
      then p_campaign_type in ('hostess', 'event')
    when p_user_category = 'brand_ambassador'
      then p_campaign_type = 'brand_ambassador'
    else false
  end;
$$;

grant execute on function public.campaign_type_allowed_for_category(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
