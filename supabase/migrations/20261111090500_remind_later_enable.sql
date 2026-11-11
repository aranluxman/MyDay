-- Switches "Remind me later" on in the app.
-- APPLY ONLY AFTER the send-reminders and dose-action Edge Functions from this
-- same change have been deployed: they are what actually honours
-- myday_doses.snoozed_until. Applying this first would make the app offer a
-- reminder that the server will not send.
create or replace function myday_features()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('remind_later', true)
$$;
revoke all on function myday_features() from public, anon;
grant execute on function myday_features() to authenticated;
