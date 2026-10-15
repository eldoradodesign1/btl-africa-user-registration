-- BTL Africa: use the campaigns status value supported by the existing schema.
-- The application represents a stopped event as archived; stopped is not allowed
-- by campaigns_status_check in the production database.

create or replace function public.set_event_status(p_actor_id text,p_campaign_id uuid,p_status text)
returns public.campaigns
language plpgsql security definer set search_path=public
as $function$
declare actor_role text; row_campaign public.campaigns;
begin
  select role into actor_role from public.users where id=p_actor_id and is_active;
  if actor_role not in ('admin','super_admin','sub_admin') then
    raise exception 'event_status_not_allowed' using errcode='42501';
  end if;
  if p_status not in ('active','archived') then
    raise exception 'event_status_invalid' using errcode='22023';
  end if;
  update public.campaigns
  set status=p_status,updated_at=now()
  where id=p_campaign_id
  returning * into row_campaign;
  if row_campaign.id is null then
    raise exception 'campaign_not_found' using errcode='P0002';
  end if;
  return row_campaign;
end;
$function$;

grant execute on function public.set_event_status(text,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
