-- "Remind me again" on for everyone: every 10 minutes, up to 3 times.
alter table myday_notification_prefs alter column repeat_every_minutes set default 10;
alter table myday_notification_prefs alter column repeat_max_times set default 3;
update myday_notification_prefs set repeat_every_minutes = 10, repeat_max_times = 3;
insert into myday_notification_prefs (user_id, repeat_every_minutes, repeat_max_times)
select p.user_id, 10, 3 from myday_profiles p
where not exists (select 1 from myday_notification_prefs n where n.user_id = p.user_id);
