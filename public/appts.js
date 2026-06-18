// Appointments: upcoming list (soonest first) + add/edit/remove via a sheet form.
import { html, useState } from './react.js';
import { Button, Card, Spinner, Modal, Field, EmptyState, useUI, useAsync } from './ui.js';
import {
  upcomingAppointments, saveAppointment, deleteAppointment, prettyDate, prettyTime, localDateStr,
} from './db.js';

export function Appointments() {
  const ui = useUI();
  const [editing, setEditing] = useState(null);
  const { data, loading, error, reload } = useAsync(() => upcomingAppointments());

  if (loading) return html`<${Spinner} label="Loading your appointments..." />`;
  if (error) return html`<${Card} className="center"><p class="lead">We could not load your appointments.</p>
    <${Button} onClick=${reload}>Try again<//><//>`;

  async function remove(a) {
    const ok = await ui.confirm({ title: 'Remove appointment', message: 'Remove this appointment?', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { await deleteAppointment(a.id); ui.toast('Appointment removed.', 'info'); reload(); }
    catch { ui.toast('Could not remove. Please try again.', 'bad'); }
  }

  return html`<div class="stack">
    <h2 class="section">Upcoming appointments</h2>
    ${data.length === 0
      ? html`<${EmptyState}>No appointments coming up.<//>`
      : data.map((a) => html`<${ApptCard} key=${a.id} appt=${a} onEdit=${() => setEditing(a)} onRemove=${() => remove(a)} />`)}
    <${Button} icon="plus" onClick=${() => setEditing({})}>Add an appointment<//>
    ${editing ? html`<${ApptForm} appt=${editing.id ? editing : null}
      onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); reload(); }} />` : null}
  </div>`;
}

function ApptCard({ appt, onEdit, onRemove }) {
  const when = appt.appt_time ? `${prettyDate(appt.appt_date)} at ${prettyTime(appt.appt_time)}` : prettyDate(appt.appt_date);
  return html`<${Card}>
    <div class="card__title">${when}</div>
    ${appt.doctor_name ? html`<div class="card__meta">Doctor: ${appt.doctor_name}</div>` : null}
    ${appt.location ? html`<div class="card__meta">Where: ${appt.location}</div>` : null}
    ${appt.reason ? html`<div class="card__meta">Reason: ${appt.reason}</div>` : null}
    <div class="btn-row">
      <${Button} variant="ghost" size="sm" icon="edit" onClick=${onEdit}>Edit<//>
      <${Button} variant="danger" size="sm" icon="trash" onClick=${onRemove}>Remove<//>
    </div>
  <//>`;
}

function ApptForm({ appt, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!appt;
  const [date, setDate] = useState(appt?.appt_date || localDateStr());
  const [time, setTime] = useState(appt?.appt_time || '');
  const [doctor, setDoctor] = useState(appt?.doctor_name || '');
  const [loc, setLoc] = useState(appt?.location || '');
  const [reason, setReason] = useState(appt?.reason || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!date) { ui.toast('Please choose a date.', 'bad'); return; }
    setBusy(true);
    try {
      await saveAppointment({ id: appt?.id, appt_date: date, appt_time: time,
        doctor_name: doctor.trim(), location: loc.trim(), reason: reason.trim() });
      ui.toast(editing ? 'Appointment updated.' : 'Appointment added.');
      onSaved();
    } catch { ui.toast('Could not save. Please try again.', 'bad'); setBusy(false); }
  }

  return html`<${Modal} title=${editing ? 'Edit appointment' : 'Add an appointment'} onClose=${onClose}>
    <${Field} label="Date"><input class="input" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} /><//>
    <${Field} label="Time (optional)"><input class="input" type="time" value=${time} onInput=${(e) => setTime(e.target.value)} /><//>
    <${Field} label="Doctor"><input class="input" value=${doctor} placeholder="e.g. Dr. Patel" maxlength="60" onInput=${(e) => setDoctor(e.target.value)} /><//>
    <${Field} label="Location"><input class="input" value=${loc} placeholder="e.g. Riverside Clinic" maxlength="80" onInput=${(e) => setLoc(e.target.value)} /><//>
    <${Field} label="Reason"><input class="input" value=${reason} placeholder="e.g. Check-up" maxlength="80" onInput=${(e) => setReason(e.target.value)} /><//>
    <div class="btn-row" style="margin-top:8px">
      <${Button} variant="ghost" onClick=${onClose}>Cancel<//>
      <${Button} disabled=${busy} onClick=${save}>${editing ? 'Save changes' : 'Add appointment'}<//>
    </div>
  <//>`;
}
