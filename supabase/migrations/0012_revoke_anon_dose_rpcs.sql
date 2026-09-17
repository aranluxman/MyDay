-- =====================================================================
-- 0012 — remove the last two anon-reachable myday RPC endpoints.
--
-- Continuation of 0011: the same default-PUBLIC-grant left these callable by
-- the unauthenticated `anon` role via /rest/v1/rpc/.
--
-- Neither was exploitable. Both are SECURITY INVOKER, so they run under the
-- caller's own RLS, and for `anon` auth.uid() is null:
--   * myday_refresh_doses    — its INSERT is blocked by RLS, and its UPDATE
--                              matches nothing because the window lookup is
--                              `where user_id = auth.uid()`.
--   * myday_revoke_guardian_device — its UPDATE is gated on
--                              `g.user_id = auth.uid()`, so nothing matches.
--
-- They are revoked anyway: an endpoint that cannot do anything useful is still
-- an endpoint, and defence in depth here costs nothing. Signed-in users keep
-- exactly the access they had, so no app behaviour changes.
-- =====================================================================

revoke all on function myday_refresh_doses(text) from public, anon;
grant execute on function myday_refresh_doses(text) to authenticated;

revoke all on function myday_revoke_guardian_device(uuid) from public, anon;
grant execute on function myday_revoke_guardian_device(uuid) to authenticated;
