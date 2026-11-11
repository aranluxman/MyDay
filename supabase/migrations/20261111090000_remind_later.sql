-- Redesign phase 3: "Remind me later".
-- ADD-ONLY: one nullable column, two new functions. No existing row, column,
-- policy or function is changed.
--
-- Postponing a reminder never touches the dose itself: its scheduled time,
-- its status and the moment it would be counted as "not recorded" all stay
-- exactly as they were. Only `snoozed_until` is written, and only the
-- reminder sender reads it.

alter table myday_doses add column if not exists snoozed_until timestamptz;

-- Postpone the reminder for one of the caller's own pending doses.
-- Outcomes: snoozed | not_found | not_pending | not_due | too_late
--   too_late: the postponed time would fall after this dose's recording
--   window closes, when no reminder is sent any more. Saying so is better
--   than promising a reminder that will not come.
create or replace function myday_snooze_dose(p_dose_id uuid, p_minutes int default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_user uuid := auth.uid();
  d myday_doses%rowtype;
  v_minutes int;
  v_window int;
  v_until timestamptz;
begin
  if v_user is null then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into d from myday_doses where id = p_dose_id and user_id = v_user for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if d.status <> 'pending' then return jsonb_build_object('outcome', 'not_pending'); end if;
  if d.due_at > now() + interval '30 minutes' then return jsonb_build_object('outcome', 'not_due'); end if;

  -- The person's own snooze length unless one of the allowed lengths is asked for.
  select snooze_minutes into v_minutes from myday_notification_prefs where user_id = v_user;
  v_minutes := coalesce(case when p_minutes in (5, 10, 15, 30) then p_minutes end, v_minutes, 15);

  select coalesce(m.alert_window_override, p.alert_window_minutes, 60) into v_window
    from myday_doses x
    left join myday_medications m on m.id = x.medication_id
    left join myday_profiles p on p.user_id = x.user_id
   where x.id = d.id;
  v_window := coalesce(v_window, 60);

  v_until := now() + make_interval(mins => v_minutes);
  if v_until > d.due_at + make_interval(mins => v_window) then
    return jsonb_build_object('outcome', 'too_late', 'window_ends', d.due_at + make_interval(mins => v_window));
  end if;

  update myday_doses set snoozed_until = v_until where id = d.id;
  return jsonb_build_object('outcome', 'snoozed', 'until', v_until, 'minutes', v_minutes);
end $$;
revoke all on function myday_snooze_dose(uuid, int) from public, anon;
grant execute on function myday_snooze_dose(uuid, int) to authenticated;

-- What the server can do right now, so the app never offers something the
-- deployed functions do not yet honour. "remind_later" is switched to true by
-- a later migration, only after the reminder sender that reads snoozed_until
-- has been deployed.
create or replace function myday_features()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('remind_later', false)
$$;
revoke all on function myday_features() from public, anon;
grant execute on function myday_features() to authenticated;
