-- =====================================================================
-- 0013 — "My cards": a wallet for health card, insurance, pharmacy, ID.
--
-- Privacy decisions, because this is the most sensitive thing in the app:
--
--   * Images live in a PRIVATE storage bucket, read only through short-lived
--     signed URLs. Unlike myday-avatars (which is public), nothing here is
--     ever reachable by URL alone.
--   * GUARDIANS CANNOT SEE CARDS. There is deliberately no share flag on this
--     table and the guardian-data edge function does not select from it. A
--     guardian sees medications, doses and appointments — a health card number
--     is a different category of thing entirely.
--   * No OCR, no extraction, no third party. The number is whatever the person
--     typed, stored as text, masked in the UI by default.
--   * RLS is the usual per-user rule, and the storage policies are scoped to
--     the user's own top-level folder.
-- =====================================================================

create table if not exists myday_health_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),

  label text not null,
  card_type text not null default 'other',
  -- Free text on purpose: a card number is not always digits, and silently
  -- reformatting someone's health number would be worse than storing it as
  -- they read it off the card.
  card_number text,
  expiry text,
  note text,

  front_path text,
  back_path text,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint myday_health_cards_type_check check (card_type in
    ('health', 'insurance', 'pharmacy', 'id', 'benefits', 'other')),
  constraint myday_health_cards_label_len check (char_length(label) between 1 and 60),
  constraint myday_health_cards_number_len check (card_number is null or char_length(card_number) <= 60),
  constraint myday_health_cards_note_len check (note is null or char_length(note) <= 300)
);

create index if not exists myday_health_cards_user_idx
  on myday_health_cards (user_id, sort_order, created_at);

do $$ begin
  create trigger t_myday_health_cards_u before update on myday_health_cards
    for each row execute function myday_set_updated_at();
exception when duplicate_object then null; end $$;

alter table myday_health_cards enable row level security;
do $$ begin
  create policy myday_health_cards_own on myday_health_cards for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ---------- private image bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('myday-cards', 'myday-cards', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists myday_cards_read on storage.objects;
drop policy if exists myday_cards_insert on storage.objects;
drop policy if exists myday_cards_update on storage.objects;
drop policy if exists myday_cards_delete on storage.objects;

create policy myday_cards_read on storage.objects for select to authenticated
  using (bucket_id = 'myday-cards' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_cards_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'myday-cards' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_cards_update on storage.objects for update to authenticated
  using (bucket_id = 'myday-cards' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'myday-cards' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_cards_delete on storage.objects for delete to authenticated
  using (bucket_id = 'myday-cards' and (storage.foldername(name))[1] = auth.uid()::text);
