-- Profile photo + display-size preference, two more brain games, avatar storage.
alter table myday_profiles add column if not exists avatar_url text;
alter table myday_profiles add column if not exists text_size text not null default 'normal';

alter table myday_game_results drop constraint if exists myday_game_results_game_type_check;
alter table myday_game_results add constraint myday_game_results_game_type_check
  check (game_type in ('match_pairs','word_puzzle','number_pattern','orientation','quick_math','odd_one_out'));

-- public avatar bucket; users may write only inside their own user-id folder
insert into storage.buckets (id, name, public) values ('myday-avatars', 'myday-avatars', true)
on conflict (id) do nothing;
drop policy if exists myday_avatars_read on storage.objects;
drop policy if exists myday_avatars_insert on storage.objects;
drop policy if exists myday_avatars_update on storage.objects;
drop policy if exists myday_avatars_delete on storage.objects;
create policy myday_avatars_read on storage.objects for select to public using (bucket_id = 'myday-avatars');
create policy myday_avatars_insert on storage.objects for insert to authenticated with check (bucket_id = 'myday-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_avatars_update on storage.objects for update to authenticated using (bucket_id = 'myday-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_avatars_delete on storage.objects for delete to authenticated using (bucket_id = 'myday-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
