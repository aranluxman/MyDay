import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, Modal, Field, Input, EmptyState } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { upcomingAppointments, saveAppointment, deleteAppointment } from '../lib/db.js';
import { prettyDate, prettyTime, localDateStr } from '../lib/format.js';

export default function Appointments() {
  const ui = useUI();
  const location = useLocation();
  const [editing, setEditing] = useState(null);
  const { data, loading, error, reload } = useAsync(() => upcomingAppointments(), []);

  useEffect(() => {
    if (location.state?.add === 'appt') { setEditing({}); window.history.replaceState({}, ''); }
  }, [location.key]);

  async function remove(a) {
    const ok = await ui.confirm({ title: 'Remove appointment', message: 'Remove this appointment?', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { await deleteAppointment(a.id); ui.toast('Removed.', 'info'); reload(); } catch { ui.toast('Could not remove.', 'bad'); }
  }

  if (loading) return <Spinner label="Loading your appointments..." />;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;

  return (
    <div className="stack">
      <h2 className="section">Upcoming appointments</h2>
      {!data.length && <EmptyState icon="calendar" title="Nothing coming up">Add your next doctor visit so it is not forgotten.</EmptyState>}
      {data.map((a) => {
        const when = a.appt_time ? `${prettyDate(a.appt_date)} at ${prettyTime(a.appt_time)}` : prettyDate(a.appt_date);
        return (
          <Card key={a.id}>
            <div className="dose">
              <span className="dose__chip" style={{ background: '#2563a8' }}><Icon name="calendar" size={20} /></span>
              <div className="dose__main">
                <div className="card__title">{when}</div>
                {a.doctor_name && <div className="card__meta">Doctor: {a.doctor_name}</div>}
                {a.location && <div className="card__meta">Where: {a.location}</div>}
                {a.reason && <div className="card__meta">Reason: {a.reason}</div>}
              </div>
            </div>
            <div className="btn-row">
              <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(a)}>Edit</Button>
              <Button variant="danger" size="sm" icon="trash" onClick={() => remove(a)}>Remove</Button>
            </div>
          </Card>
        );
      })}
      <Button icon="plus" onClick={() => setEditing({})}>Add an appointment</Button>
      {editing && <ApptForm appt={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
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
      await saveAppointment({ id: appt?.id, appt_date: date, appt_time: time, doctor_name: doctor.trim(), location: loc.trim(), reason: reason.trim() });
      ui.toast(editing ? 'Appointment updated.' : 'Appointment added.');
      onSaved();
    } catch { ui.toast('Could not save.', 'bad'); setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Edit appointment' : 'Add an appointment'} onClose={onClose}>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Time (optional)"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      <Field label="Doctor"><Input value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="e.g. Dr. Patel" maxLength={60} /></Field>
      <Field label="Location"><Input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="e.g. Riverside Clinic" maxLength={80} /></Field>
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Check-up" maxLength={80} /></Field>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{editing ? 'Save changes' : 'Add appointment'}</Button>
      </div>
    </Modal>
  );
}
