import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Modal, Field, Input, SkeletonCard, SegmentedControl } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { upcomingAppointments, pastAppointments, saveAppointment, deleteAppointment, listContacts } from '../lib/db.js';
import { prettyDate, prettyTime, localDateStr } from '../lib/format.js';
import {
  countdownLabel, daysUntil, groupAppointments, directionsUrl, telHref, contactForAppointment, buildIcs, icsFilename, apptKind,
} from '../lib/appointments.js';

export default function Appointments() {
  const ui = useUI();
  const location = useLocation();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('upcoming');
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
    try { await deleteAppointment(a.id); setOpen(null); ui.toast('Removed.', 'info'); reload(); } catch { ui.toast('Could not remove.', 'bad'); }
  }

  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;

  const list = (items, label) => (
    <ul className="vlist" aria-label={label}>
      {items.map((a) => <li key={a.id}><ApptRow appt={a} onOpen={() => setOpen(a)} /></li>)}
    </ul>
  );

  return (
    <div className="stack visits">
      <p className="page-intro">Keep track of your upcoming and past appointments.</p>
      <SegmentedControl className="segmented--accent" label="Show appointments" value={tab} onChange={setTab} options={[
        { value: 'upcoming', label: 'Upcoming', icon: 'calendar' },
        { value: 'past', label: 'Past', icon: 'history' },
      ]} />

      {tab === 'upcoming' ? (
        <>
          <QuickAdd onPick={setEditing} />
          <section className="stack" aria-labelledby="visits-up">
            <div className="section-head"><h3 id="visits-up">Upcoming appointments</h3></div>
            {upcoming.length ? list(upcoming, 'Upcoming appointments') : (
              <div className="vempty">
                <p>Nothing booked yet. Tap one of the Quick add buttons above, or Add at the top.</p>
                <Button icon="plus" onClick={() => setEditing({})}>Add an appointment</Button>
              </div>
            )}
          </section>
          {!!past.length && (
            <section className="stack" aria-labelledby="visits-past">
              <div className="section-head">
                <h3 id="visits-past">Past appointments</h3>
                <button type="button" className="section-head__link" onClick={() => { setTab('past'); window.scrollTo(0, 0); }}>See all</button>
              </div>
              {list(past.slice(0, 2), 'Recent past appointments')}
            </section>
          )}
        </>
      ) : (
        <section className="stack" aria-labelledby="visits-all-past">
          <div className="section-head"><h3 id="visits-all-past">Past appointments</h3></div>
          {past.length ? list(past, 'Past appointments') : (
            <div className="vempty"><p>Visits you have been to will be kept here.</p></div>
          )}
        </section>
      )}

      {open && <ApptDetail appt={open} contacts={contacts.data || []} onClose={() => setOpen(null)}
        onEdit={() => { setEditing(open); setOpen(null); }} onRemove={() => remove(open)} />}
      {editing && <ApptForm appt={editing.id ? editing : null} draft={editing.id ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

// One-tap starting points that open the form with the reason already typed,
// so a routine visit is a date and a tap rather than typing from scratch.
const QUICK = [
  { label: 'Doctor visit', reason: 'Doctor visit', icon: 'stethoscope', tint: 'blue' },
  { label: 'Lab test', reason: 'Lab test', icon: 'flask', tint: 'violet' },
  { label: 'Pharmacy pickup', reason: 'Pharmacy pickup', icon: 'pill', tint: 'red' },
  { label: 'Dentist', reason: 'Dentist check-up', icon: 'tooth', tint: 'blue' },
  { label: 'Eye exam', reason: 'Eye exam', icon: 'eye', tint: 'violet' },
  { label: 'Other', reason: '', icon: 'more', tint: 'grey' },
];
function QuickAdd({ onPick }) {
  return (
    <section className="stack" aria-labelledby="visits-quick">
      <div className="section-head"><h3 id="visits-quick">Quick add</h3></div>
      <div className="vquick">
        {QUICK.map((t) => (
          <button key={t.label} type="button" className={`vquick__b vtint--${t.tint}`} onClick={() => onPick({ reason: t.reason })}>
            <span className="vquick__ic" aria-hidden="true"><Icon name={t.icon} size={26} stroke={t.icon === 'more' ? 4 : 2.2} /></span>
            <span className="vquick__t">{t.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const KIND = {
  doctor: { icon: 'user', tint: 'orange' },
  lab: { icon: 'flask', tint: 'orange' },
  dentist: { icon: 'tooth', tint: 'blue' },
  eye: { icon: 'eye', tint: 'violet' },
  pharmacy: { icon: 'pill', tint: 'red' },
};
const at = (iso) => new Date(`${iso}T00:00:00`);
const apptTitle = (a) => a.doctor_name || a.reason || 'Appointment';

// One visit as a row: the date, a picture of what kind of visit, who and
// where, and when. Tapping it opens everything you can do about it.
function ApptRow({ appt: a, onOpen }) {
  const kind = KIND[apptKind(a)];
  const sub = a.doctor_name ? (a.reason || a.location) : a.location;
  const days = daysUntil(a.appt_date);
  const soon = days != null && days >= 0 && days <= 2;
  return (
    <button type="button" className={`vrow appt${soon ? ' is-soon' : ''}`} onClick={onOpen}>
      <span className="vrow__date" aria-hidden="true">
        <span className="vrow__m">{at(a.appt_date).toLocaleDateString([], { month: 'short' })}</span>
        <span className="vrow__d">{at(a.appt_date).getDate()}</span>
        <span className="vrow__w">{at(a.appt_date).toLocaleDateString([], { weekday: 'short' })}</span>
      </span>
      <span className={`vrow__ic vtint--${kind.tint}`} aria-hidden="true"><Icon name={kind.icon} size={26} stroke={2.2} /></span>
      <span className="vrow__main">
        <span className="vrow__t">{apptTitle(a)}</span>
        {sub && <span className="vrow__s">{sub}</span>}
        <span className="vrow__time">
          <Icon name="clock" size={17} />
          <span>{a.appt_time ? `${prettyTime(a.appt_time)} · ` : ''}{countdownLabel(a.appt_date)}</span>
        </span>
        <span className="sr-only">{prettyDate(a.appt_date)}</span>
      </span>
      <Icon name="chevron" size={22} className="vrow__go" />
    </button>
  );
}

// Everything about one visit, and the things a person actually wants to do
// about it — call, find it, put it in their calendar — plus Edit and Remove.
function ApptDetail({ appt: a, contacts, onClose, onEdit, onRemove }) {
  const ui = useUI();
  const days = daysUntil(a.appt_date);
  const past = days != null && days < 0;
  const when = a.appt_time ? `${prettyDate(a.appt_date)} at ${prettyTime(a.appt_time)}` : prettyDate(a.appt_date);
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
    <Modal title={apptTitle(a)} onClose={onClose}>
      <div className="vdetail">
        <p className="vdetail__when"><Icon name="calendar" size={20} /> <span>{when}</span></p>
        <span className={`g-badge g-badge--${days != null && days >= 0 && days <= 2 ? 'overdue' : past ? 'upcoming' : 'due'}`}>
          {countdownLabel(a.appt_date)}
        </span>
        {a.location && <p className="vdetail__line"><Icon name="pin" size={20} /> <span>{a.location}</span></p>}
        {a.reason && a.doctor_name && <p className="vdetail__line"><Icon name="notes" size={20} /> <span>{a.reason}</span></p>}
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
          <button type="button" className="appt__act" onClick={addToCalendar}>
            <Icon name="calendar" size={20} /><span>Add to calendar</span>
          </button>
        </div>
      )}
      <div className="btn-row">
        <Button variant="ghost" size="sm" icon="edit" onClick={onEdit}>Edit</Button>
        <Button variant="danger" size="sm" icon="trash" onClick={onRemove}>Remove</Button>
      </div>
    </Modal>
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
