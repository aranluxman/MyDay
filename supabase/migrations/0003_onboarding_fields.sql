-- Multi-step sign-up answers, stored on the profile.
alter table myday_profiles add column if not exists for_whom text check (for_whom in ('self','other'));
alter table myday_profiles add column if not exists sex text check (sex in ('male','female','other'));
