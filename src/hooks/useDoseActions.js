import { useCallback, useRef, useState } from 'react';
import { useUI } from '../context/UIContext.jsx';
import { markDoseTaken, markDoseSkipped, undoDose, logAsNeededDose } from '../lib/db.js';
import { prettyTime, prettyClock } from '../lib/format.js';

// Logging a dose, the same way from every screen.
//
//   * A dose being saved is locked: a second tap (or a tap on the same dose in
//     another card) does nothing until the first finishes.
//   * Success is only reported after the server has confirmed it, and says
//     exactly what was recorded: which medicine, how much, which scheduled
//     dose, and the time it was taken. Then Undo.
//   * Failure says plainly that NOTHING was recorded (including offline), so
//     an unsaved tap is never mistaken for a logged dose.
//   * The server write is idempotent (myday_take_dose), so a retry after a
//     lost reply cannot create a second record.
export function useDoseActions(onChange) {
  const ui = useUI();
  const [pending, setPending] = useState(() => new Set());
  const busy = useRef(new Set());

  const lock = (id) => {
    if (busy.current.has(id)) return false;
    busy.current.add(id);
    setPending(new Set(busy.current));
    return true;
  };
  const unlock = (id) => { busy.current.delete(id); setPending(new Set(busy.current)); };

  const take = useCallback(async (dose, takenAt = null) => {
    if (!lock(dose.id)) return;
    try {
      const r = await markDoseTaken(dose.id, takenAt);
      const m = dose.medication || {};
      const when = r?.taken_at ? prettyClock(new Date(r.taken_at)) : prettyClock(new Date());
      const what = `${m.name || 'Medicine'}${m.dose ? ` ${m.dose}` : ''}`;
      const msg = r?.outcome === 'already_taken'
        ? `Already recorded: ${what}, ${prettyTime(dose.scheduled_time)} dose, taken at ${when}.`
        : `Recorded: ${what} — ${prettyTime(dose.scheduled_time)} dose, taken at ${when}.`;
      onChange?.();
      ui.toast(msg, 'good', r?.outcome === 'already_taken' ? null : {
        label: 'Undo',
        onAction: async () => {
          try { await undoDose(dose.id); onChange?.(); ui.toast('Undone. That dose is no longer marked taken.', 'info'); }
          catch (e) { ui.toast(e.message || 'Could not undo.', 'bad'); }
        },
      });
    } catch (e) {
      ui.toast(e.message || 'Could not save. Nothing was recorded.', 'bad');
      onChange?.();
    } finally { unlock(dose.id); }
  }, [onChange, ui]);

  // "Not today" is a settled decision, so it offers Undo rather than a
  // confirmation: tapping it by mistake must not need a dialog to escape.
  const skip = useCallback(async (dose, reason) => {
    if (!lock(dose.id)) return;
    try {
      await markDoseSkipped(dose.id, reason);
      onChange?.();
      ui.toast(`${dose.medication?.name || 'Dose'} at ${prettyTime(dose.scheduled_time)}: marked as not needed today.`, 'info', {
        label: 'Undo',
        onAction: async () => {
          try { await undoDose(dose.id); onChange?.(); } catch { ui.toast('Could not undo.', 'bad'); }
        },
      });
    } catch (e) { ui.toast(e.message || 'Could not save. Nothing was recorded.', 'bad'); }
    finally { unlock(dose.id); }
  }, [onChange, ui]);

  // As-needed: one client id per tap, reused if the same tap is retried.
  const takeAsNeeded = useCallback(async (med, takenAt = null) => {
    const key = `prn:${med.id}`;
    if (!lock(key)) return;
    const clientId = crypto.randomUUID();
    try {
      let r;
      try { r = await logAsNeededDose(med.id, clientId, takenAt); }
      catch (e) {
        // One automatic retry with the SAME id: safe, because the server
        // recognises it and will not log a second dose.
        if (e.code === 'failed') r = await logAsNeededDose(med.id, clientId, takenAt);
        else throw e;
      }
      onChange?.();
      const when = r?.taken_at ? prettyClock(new Date(r.taken_at)) : prettyClock(new Date());
      ui.toast(r?.outcome === 'already_taken'
        ? `Already recorded: ${med.name} at ${when}.`
        : `Recorded: ${med.name}${med.dose ? ` ${med.dose}` : ''}, taken at ${when}.`, 'good',
      r?.outcome === 'taken' ? {
        label: 'Undo',
        onAction: async () => {
          try { await undoDose(r.id || clientId); onChange?.(); ui.toast('Undone.', 'info'); }
          catch { ui.toast('Could not undo.', 'bad'); }
        },
      } : null);
    } catch (e) {
      ui.toast(e.message || 'Could not save. Nothing was recorded.', 'bad');
    } finally { unlock(key); }
  }, [onChange, ui]);

  return { take, skip, takeAsNeeded, pending };
}
