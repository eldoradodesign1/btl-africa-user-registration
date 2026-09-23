-- BTL Africa: Lime hierarchy for the historical user relationship.
-- Abel and Supervisor are intentionally not referenced because no matching
-- account was present in the database when this migration was prepared.

-- Direct Lime assignments explicitly requested.
update public.users
set supervisor_id = 'sam-admin'
where id in ('adm-0001-4a11-a881-100000000001', 'michael-admin');

update public.users
set supervisor_id = 'adm-0001-4a11-a881-100000000001'
where id in (
  '0a6a2520-96bb-474d-87b6-b0eb8fc46cd6', -- Eldo Bitulu
  'arnold-koma-sub-admin',
  'daniel-sub-admin',
  'benedicte-mondo-sub-admin'
);

update public.users
set supervisor_id = 'arnold-koma-sub-admin'
where id in (
  'sup-0001-4a11-a881-100000000001', -- Hervé Ntalu
  'sup-0001-4a11-a881-100000000002', -- Serge Kisend
  'usr-youth-alpha-okito',
  'bd294c12-8629-4140-99bd-668ab0c0fff5'
);

update public.users
set supervisor_id = '0a6a2520-96bb-474d-87b6-b0eb8fc46cd6'
where id in (
  'usr-8d3144f8', -- Ruth Mafuta
  'agt-test-ba-herve-0821000001', -- Agent Test
  'agt-0001-4a11-a881-200000000002', -- Agent2
  '6a3ecb0e-f3b2-4fd8-9f12-bb9dc2b2fa8d' -- Tentative Doublon
);

-- All real hostesses report to Hervé, except the explicitly listed test account.
update public.users
set supervisor_id = 'sup-0001-4a11-a881-100000000001'
where role = 'agent'
  and user_category = 'hostess'
  and id <> 'agt-0001-4a11-a881-200000000002';

-- MIKILI brand ambassadors report to Hervé.
update public.users
set supervisor_id = 'sup-0001-4a11-a881-100000000001'
where role = 'agent'
  and user_category in ('brand_ambassador', 'brand_ambassador_youth')
  and id like 'mikili-ba-%';

-- All other brand ambassadors report to Alpha, except Agent Test above.
update public.users
set supervisor_id = 'usr-youth-alpha-okito'
where role = 'agent'
  and user_category in ('brand_ambassador', 'brand_ambassador_youth')
  and id <> 'agt-test-ba-herve-0821000001'
  and id not like 'mikili-ba-%';
