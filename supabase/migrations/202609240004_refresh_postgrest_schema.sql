-- BTL Africa: refresh PostgREST after RPC migrations.
-- The functions already exist in public; this reloads the API schema cache
-- and reapplies the explicit execution grants used by the publishable client.
grant execute on function public.create_user_by_super_admin(text, text, text, text, text, text, text, text, text, text, boolean, date, text, text) to anon, authenticated;
grant execute on function public.set_user_activity_status(text, text, boolean) to anon, authenticated;
notify pgrst, 'reload schema';
