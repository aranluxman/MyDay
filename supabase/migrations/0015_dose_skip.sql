-- =====================================================================
-- 0015 — "Not today" : a dose deliberately not taken.
--
-- Until now a dose that was not taken became 'missed', whether the person
-- forgot it or their doctor told them to stop for a week. Those are entirely
-- different things, and collapsing them makes the adherence history dishonest
-- and the missed-dose alerts cry wolf.
--
-- 'skipped' is therefore a THIRD outcome, deliberately not a kind of missed:
--   * it never triggers a missed-dose alert,
--   * it is excluded from the adherence denominator, because it was not a
--     failure to take a dose that was due,
--   * and it carries the person's own reason, so the history says why.
-- =====================================================================

alter table myday_doses add column if not exists skip_reason text;
alter table myday_doses add column if not exists skipped_at timestamptz;

do $$ begin
  alter table myday_doses add constraint myday_doses_skip_reason_len
    check (skip_reason is null or char_length(skip_reason) <= 80);
exception when duplicate_object then null; end $$;

alter table myday_doses drop constraint if exists myday_doses_status_check;
alter table myday_doses add constraint myday_doses_status_check
  check (status in ('pending', 'taken', 'missed', 'skipped'));

-- A skipped dose must never be flipped to missed by the sweep, so both
-- dose-marking functions only ever act on rows that are still 'pending'.
-- (They already filter on status = 'pending'; this comment records that the
-- behaviour is load-bearing, not incidental.)
