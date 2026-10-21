import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Modal, Field, Input, HeroEmpty, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { upcomingAppointments, pastAppointments, saveAppointment, deleteAppointment, listContacts } from '../lib/db.js';
import { prettyDate, prettyTime, localDateStr } from '../lib/format.js';
import {
  countdownLabel, daysUntil, groupAppointments, directionsUrl, telHref, contactForAppointment, buildIcs, icsFilename,
} from '../lib/appointments.js';

export default function Appointments() {
  const ui = useUI();
  const location = useLocation();
  const [editing, setEditing] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [next, before] = await Promise.all([upcomingAppointments(), pastAppointments().catch(() => [])]);
    return [...next, ...before];
  }, []);
  // Saved contacts give the doctor's number for tap-to-call, matched by name.
  const contacts = useAsync(() => listContacts(), []);
  const { upcoming, past } = groupAppointments(data || []);

  useEffect(() => {
    if (location.state?.add === 'appt') { setEditing({}); window.history.replaceState({}, ''); }
  }, [location.key]);

  async function remove(a) {
    const ok = await ui.confirm({ title: 'Remove appointment', message: 'Remove this appointment?', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { await deleteAppointment(a.id); ui.toast('Removed.', 'info'); reload(); } catch { ui.toast('Could not remove.', 'bad'); }
  }

  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;

  return (
    <div className="stack">
      {/* One welcoming card rather than an empty card above a second empty
          card: what this page is for, the button, and a few ideas to start. */}
      {!data.length && (
        <HeroEmpty icon="calendar" title="Let's add your first appointment"
          action={(
            <>
              <Button icon="plus" onClick={() => setEditing({})}>Add an appointment</Button>
              <ApptTemplates title="Common check-ups to add" items={STARTERS} onPick={setEditing} />
            </>
          )}>
          Keep your check-ups, clinic visits, and tests in one place. Upcoming ones will show here with a countdown.
        </HeroEmpty>
      )}
      {!!upcoming.length && (
        <>
          <div className="section-head"><h3>Upcoming</h3></div>
          {upcoming.map((a, i) => (
            <ApptCard key={a.id} appt={a} contacts={contacts.data || []} index={i}
              onEdit={() => setEditing(a)} onRemove={() => remove(a)} />
          ))}
        </>
      )}

      {!!past.length && (
        <>
          <div className="section-head" style={{ marginTop: 10 }}>
            <h3>Past</h3>
            <button className="appt__toggle" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
              {showPast ? 'Hide' : `Show ${past.length}`}
            </button>
          </div>
          {showPast && past.map((a, i) => (
            <ApptCard key={a.id} appt={a} contacts={contacts.data || []} index={i} past
              onEdit={() => setEditing(a)} onRemove={() => remove(a)} />
          ))}
        </>
      )}

      {data.length > 0 && (
        <>
          <Button icon="plus" onClick={() => setEditing({})}>Add an appointment</Button>
          <ApptTemplates title="Quick add" items={TEMPLATES} onPick={setEditing} />
        </>
      )}
      {editing && <ApptForm appt={editing.id ? editing : null} draft={editing.id ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

// One-tap starting points that open the form with the reason already typed,
// so a routine visit is a date and a tap rather than typing from scratch.
const TEMPLATES = [
  { label: 'Doctor visit', reason: 'Doctor visit' },
  { label: 'Lab test', reason: 'Lab test' },
  { label: 'Pharmacy pickup', reason: 'Pharmacy pickup' },
  { label: 'Dentist', reason: 'Dentist check-up' },
  { label: 'Eye exam', reason: 'Eye exam' },
];
const STARTERS = [
  { label: 'Annual physical', reason: 'Annual physical' },
  { label: 'Dentist', reason: 'Dentist check-up' },
  { label: 'Eye exam', reason: 'Eye exam' },
  { label: 'Lab test', reason: 'Lab test' },
];
function ApptTemplates({ title, items, onPick }) {
  const id = `appt-tpl-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="quickadd appt-tpl" aria-labelledby={id}>
      <h3 className="quickadd__h" id={id}>{title}</h3>
      <div className="feeling__tags quickadd__tags">
        {items.map((t) => (
          <button key={t.label} type="button" className="feeling__tag" onClick={() => onPick({ reason: t.reason })}>
            {t.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// One appointment: when it is, how soon, and the three things a person
// actually wants to do about it — call, find it, and put it in their calendar.
function ApptCard({ appt: a, contacts, index, past, onEdit, onRemove }) {
  const ui = useUI();
  const when = a.appt_time
    ? `${prettyDate(a.appt_date)} at ${prettyTime(a.appt_time)}`
    : prettyDate(a.appt_date);
  const days = daysUntil(a.appt_date);
  const soon = days != null && days >= 0 && days <= 2;

  // No entered number for this doctor means no Call button at all.
  const tel = telHref(contactForAppointment(a, contacts)?.phone);
  const maps = directionsUrl(a.location);

  function addToCalendar() {
    const ics = buildIcs(a);
    if (!ics) { ui.toast('Could not create the calendar file.', 'bad'); return; }
    // A Blob download rather than a data: URL — iOS Safari refuses to open a
    // data: URL for a file type it wants to hand to the Calendar app.
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = icsFilename(a);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ui.toast('Saved. Open it to add it to your calendar.', 'info');
  }

  return (
    <Card accent={soon ? 'due' : undefined} className={`appt g-reveal${past ? ' appt--past' : ''}`}
      style={{ '--i': index }}>
      <div className="dose">
        <span className="appt__date" aria-hidden="true">
          <span className="appt__d">{new Date(`${a.appt_date}T00:00:00`).getDate()}</span>
          <span className="appt__m">
            {new Date(`${a.appt_date}T00:00:00`).toLocaleDateString([], { month: 'short' })}
          </span>
        </span>
        <div className="dose__main">
          <div className="card__title">{a.doctor_name || a.reason || 'Appointment'}</div>
          <div className="card__meta">{when}</div>
          {a.location && <div className="card__meta"><Icon name="pin" size={15} /> {a.location}</div>}
          {a.reason && a.doctor_name && <div className="card__meta">{a.reason}</div>}
        </div>
        <span className={`g-badge g-badge--${soon ? 'overdue' : past ? 'upcoming' : 'due'}`}>
          {countdownLabel(a.appt_date)}
        </span>
      </div>

      {!past && (
        <div className="appt__actions">
          {tel && (
            <a className="appt__act" href={tel}>
              <Icon name="phone" size={20} /><span>Call</span>
            </a>
          )}
          {maps && (
            <a className="appt__act" href={maps} target="_blank" rel="noreferrer noopener">
              <Icon name="pin" size={20} /><span>Directions</span>
            </a>
          )}
          <button className="appt__act" onClick={addToCalendar}>
            <Icon name="calendar" size={20} /><span>Add to calendar</span>
          </button>
        </div>
      )}

      <div className="btn-row">
        <Button variant="ghost" size="sm" icon="edit" onClick={onEdit}>Edit</Button>
        <Button variant="danger" size="sm" icon="trash" onClick={onRemove}>Remove</Button>
      </div>
    </Card>
  );
}

function ApptForm({ appt, draft, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!appt;
  const [date, setDate] = useState(appt?.appt_date || localDateStr());
  const [time, setTime] = useState(appt?.appt_time || '');
  const [doctor, setDoctor] = useState(appt?.doctor_name || '');
  const [loc, setLoc] = useState(appt?.location || '');
  const [reason, setReason] = useState(appt?.reason || draft?.reason || '');
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
        <Button disabled={busy} icon={busy ? 'clock' : undefined} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add appointment'}</Button>
      </div>
    </Modal>
  );
}
