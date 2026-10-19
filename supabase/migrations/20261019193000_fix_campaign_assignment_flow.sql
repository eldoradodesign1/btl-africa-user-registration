-- BTL Africa: campaign membership and operational supervisors are separate concerns.
-- Apply after the previous campaign-assignment migrations.
create or replace function public.set_user_campaign_assignments(
  p_user_id text,
  p_campaign_ids uuid[],
  p_manager_id text
)
returns setof public.user_campaign_assignments
language plpgsql security definer set search_path=public
as $function$
declare
  manager_role text; target_role text; target_category text; expected_campaign_type text;
  selected_campaign uuid; existing_assignment_id uuid;
begin
  select role into manager_role from public.users where id=p_manager_id and is_active;
  if manager_role not in ('admin','super_admin','sub_admin','supervisor') then raise exception 'campaign_manager_required' using errcode='42501'; end if;
  select role,user_category into target_role,target_category from public.users where id=p_user_id and is_active;
  if target_role is distinct from 'agent' or target_category not in ('hostess','brand_ambassador','brand_ambassador_youth') then raise exception 'campaigns_are_for_agents_only' using errcode='22023'; end if;
  expected_campaign_type := case when target_category='hostess' then 'hostess' else 'brand_ambassador' end;
  update public.user_campaign_assignments a set is_active=false
  where a.user_id=p_user_id and a.is_active and not (a.campaign_id=any(coalesce(p_campaign_ids,'{}'::uuid[])));
  -- Removing membership also removes the operational supervisor links for that campaign.
  update public.agent_campaign_supervisor_assignments a set is_active=false
  where a.agent_id=p_user_id and a.is_active and not (a.campaign_id=any(coalesce(p_campaign_ids,'{}'::uuid[])));
  foreach selected_campaign in array coalesce(p_campaign_ids,'{}'::uuid[]) loop
    if not exists(select 1 from public.campaigns c where c.id=selected_campaign and c.status in ('active','draft') and (c.campaign_type=expected_campaign_type or (target_category='hostess' and c.campaign_type='event'))) then raise exception 'campaign_not_available' using errcode='22023'; end if;
    select id into existing_assignment_id from public.user_campaign_assignments where user_id=p_user_id and campaign_id=selected_campaign limit 1;
    if existing_assignment_id is null then
      insert into public.user_campaign_assignments(id,user_id,campaign_id,is_active,assigned_at,assigned_by) values(gen_random_uuid(),p_user_id,selected_campaign,true,now(),p_manager_id);
    else
      update public.user_campaign_assignments set is_active=true,assigned_at=now(),assigned_by=p_manager_id where id=existing_assignment_id;
    end if;
  end loop;
  return query select a.* from public.user_campaign_assignments a where a.user_id=p_user_id and a.is_active order by a.assigned_at desc;
end;
$function$;
grant execute on function public.set_user_campaign_assignments(text,uuid[],text) to anon,authenticated;
notify pgrst,'reload schema';
