-- Reverses 0017_dose_integrity_and_safety.sql. NOT applied automatically:
-- run it by hand only if 0017 has to be rolled back.
--
-- It refuses to run if doing so would change anybody's recorded dose:
--   * an amount with more than two decimals cannot go back to numeric(10,2)
--     without being rounded, and
--   * a 'mcg' unit would violate the old unit list.
-- Fix or export those rows first; the check below names how many there are.
-- Columns added by 0017 (strength, inventory, snapshots, contact roles) are
-- dropped, so export them first if they are wanted.

do $$
declare n_precise int; n_mcg int;
begin
  select count(*) into n_precise from myday_medications
   where dose_amount is not null and dose_amount <> round(dose_amount, 2);
  select count(*) into n_mcg from myday_medications where dose_unit = 'mcg';
  if n_precise > 0 or n_mcg > 0 then
    raise exception 'Refusing to roll back 0017: % medicine(s) have amounts with more than 2 decimals and % use mcg. Rolling back would change their doses.', n_precise, n_mcg;
  end if;
end $$;

drop function if exists myday_sync_medication_doses(uuid, text);
drop function if exists myday_record_refill(uuid, numeric, date, text);
drop function if exists myday_log_prn_dose(uuid, uuid, timestamptz);
drop function if exists myday_untake_dose(uuid);
drop function if exists myday_take_dose(uuid, timestamptz, uuid, text);

alter table myday_contacts drop constraint if exists myday_contacts_relationship_len;
alter table myday_contacts drop column if exists is_emergency;
alter table myday_contacts drop column if exists relationship;

alter table myday_doses drop constraint if exists myday_doses_logged_via_check;
alter table myday_doses drop column if exists logged_via;
alter table myday_doses drop column if exists as_needed;
alter table myday_doses drop column if exists stock_used;
alter table myday_doses drop column if exists dose_snapshot;
alter table myday_doses drop column if exists name_snapshot;

drop table if exists myday_refills;

alter table myday_medications drop constraint if exists myday_medications_stock_check;
alter table myday_medications drop column if exists prescriber_contact_id;
alter table myday_medications drop column if exists pharmacy_contact_id;
alter table myday_medications drop column if exists refill_threshold;
alter table myday_medications drop column if exists stock_quantity;

alter table myday_medications drop constraint if exists myday_medications_days_required;
alter table myday_medications drop constraint if exists myday_medications_times_required;

alter table myday_medications drop constraint if exists myday_medications_instructions_len;
alter table myday_medications drop constraint if exists myday_medications_route_check;
alter table myday_medications drop constraint if exists myday_medications_strength_len;
alter table myday_medications drop column if exists instructions;
alter table myday_medications drop column if exists route;
alter table myday_medications drop column if exists strength;

alter table myday_medications drop constraint if exists myday_medications_dose_unit_check;
alter table myday_medications add constraint myday_medications_dose_unit_check
  check (dose_unit is null or dose_unit in
    ('tablet','capsule','ml','drop','puff','mg','IU','unit','patch','sachet','injection','other'));

alter table myday_medications alter column dose_amount type numeric(10, 2);
