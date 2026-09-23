-- BTL Africa: keep known test accounts under Eldo's Lime.
-- This corrective migration is intentionally explicit and idempotent.
update public.users
set supervisor_id = '0a6a2520-96bb-474d-87b6-b0eb8fc46cd6'
where id in (
  'agt-test-ba-herve-0821000001', -- Agent Test
  'agt-0001-4a11-a881-200000000002', -- Agent2
  '6a3ecb0e-f3b2-4fd8-9f12-bb9dc2b2fa8d' -- Tentative Doublon
);
