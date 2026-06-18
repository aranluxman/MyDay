import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Pill, Spinner, Modal, Field, Input, EmptyState, SegmentedControl } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { MedCalendar } from '../components/MedCalendar.jsx';
import {
  listMedications, saveMedication, deleteMedication, todaysDoses, dosesForDate, markDoseTaken, markDosePending,
} from '../lib/db.js';
import { prettyTime, prettyClock, prettyDate, localDateStr } from '../lib/format.js';

const COLORS = ['#2563a8', '#1e7a3d', '#b3261e', '#8a5a00', '#6d28d9', '#0e7490'];

export default function Medication() {
  const ui = useUI();
  const location = useLocation();
  const [view, setView] = useState('today');
  const [editing, setEditing] = useState(null);
  const [selectedDay, setSelectedDay] = useState(localDateStr());

  const meds = useAsync(() => listMedications(), []);
  const today = useAsync(() => todaysDoses(), []);

  useEffect(() => {
    if (location.state?.add === 'med') { setView('medicines'); setEditing({}); window.history.replaceState({}, ''); }
  }, [location.key]);

  function reloadAll() { meds.reload(); today.reload(); }
  async function done(id) { try { await markDoseTaken(id); ui.toast('Marked as taken.'); today.reload(); } catch { ui.toast('Could not save.', 'bad'); } }

  return (
    <div className="stack">
      <SegmentedControl value={view} onChange={setView} options={[
        { value: 'today', label: 'Today' },
        { value: 'calendar', label: 'Calendar' },
        { value: 'medicines', label: 'Medicines' },
      ]} />

      {view === 'today' && <TodayView state={today} onDone={done} />}

      {view === 'calendar' && (
        <>
          <MedCalendar selected={selectedDay} onPick={setSelectedDay} />
          <h3 className="subsection">{prettyDate(selectedDay)}</h3>
          <DayDoses dateStr={selectedDay} />
        </>
      )}

      {view === 'medicines' && (
        <MedicinesView state={meds} onAdd={() => setEditing({})} onEdit={setEditing}
          onRemove={async (m) => {
            const ok = await ui.confirm({ title: 'Remove medicine', message: `Remove ${m.name}?`, confirmLabel: 'Remove', danger: true });
            if (!ok) return;
            try { await deleteMedication(m.id); ui.toast('Removed.', 'info'); reloadAll(); } catch { ui.toast('Could not remove.', 'bad'); }
          }} />
      )}

      {editing && <MedForm med={editing.id ? editing : null} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reloadAll(); }} />}
    </div>
  );
}

function TodayView({ state, onDone }) {
  const { data: doses, loading, error, reload } = state;
  if (loading) return <Spinner label="Loading today's medicines..." />;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;
  if (!doses.length) return <EmptyState icon="pill" title="No doses today">Add a medicine to start tracking.</EmptyState>;
  return <div className="stack">{doses.map((d) => <DoseCard key={d.id} dose={d} onDone={onDone} />)}</div>;
}

function DayDoses({ dateStr }) {
  const { data, loading } = useAsync(() => dosesForDate(dateStr), [dateStr]);
  if (loading) return <Spinner label="" />;
  if (!data.length) return <EmptyState icon="calendar">No doses recorded for this day.</EmptyState>;
  return <div className="stack">{data.map((d) => <DoseCard key={d.id} dose={d} readOnly />)}</div>;
}

function DoseCard({ dose, onDone, readOnly }) {
  const ui = useUI();
  const m = dose.medication || {};
  const title = `${m.name || 'Medicine'}${m.dose ? ` - ${m.dose}` : ''}`;
  const color = m.color || '#2563a8';
  return (
    <Card accent={dose.status === 'taken' ? 'taken' : dose.status === 'missed' ? 'missed' : 'due'}>
      <div className="dose">
        <span className="dose__chip" style={{ background: color }}><Icon name="pill" size={20} /></span>
        <div className="dose__main">
          <div className="card__title">{title}</div>
          <div className="card__meta">Scheduled for {prettyTime(dose.scheduled_time)}</div>
          {m.note && <div className="card__meta">{m.note}</div>}
        </div>
        {dose.status === 'taken' && <Pill kind="taken">{dose.taken_at ? `Taken ${prettyClock(new Date(dose.taken_at))}` : 'Taken'}</Pill>}
        {dose.status === 'missed' && <Pill kind="missed">Missed</Pill>}
        {dose.status === 'pending' && !readOnly && <Pill kind="pending">To take</Pill>}
      </div>
      {!readOnly && dose.status !== 'taken' && (
        <Button variant="good" size="lg" icon="check" onClick={() => onDone(dose.id)}>Done - I took it</Button>
      )}
    </Card>
  );
}

function MedicinesView({ state, onAdd, onEdit, onRemove }) {
  const { data: meds, loading, error, reload } = state;
  if (loading) return <Spinner label="Loading your medicines..." />;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;
  return (
    <div className="stack">
      {!meds.length && <EmptyState icon="pill" title="No medicines yet">Add your medicines and vitamins to track them every day.</EmptyState>}
      {meds.map((m) => (
        <Card key={m.id}>
          <div className="dose">
            <span className="dose__chip" style={{ background: m.color || '#2563a8' }}><Icon name="pill" size={20} /></span>
            <div className="dose__main">
              <div className="card__title">{m.name}{m.dose ? ` - ${m.dose}` : ''}</div>
              <div className="card__meta">{(m.times || []).map(prettyTime).join(', ') || 'No times set'}</div>
              {m.note && <div className="card__meta">{m.note}</div>}
            </div>
          </div>
          <div className="btn-row">
            <Button variant="ghost" size="sm" icon="edit" onClick={() => onEdit(m)}>Edit</Button>
            <Button variant="danger" size="sm" icon="trash" onClick={() => onRemove(m)}>Remove</Button>
          </div>
        </Card>
      ))}
      <Button icon="plus" onClick={onAdd}>Add a medicine</Button>
    </div>
  );
}

function MedForm({ med, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!med;
  const [name, setName] = useState(med?.name || '');
  const [dose, setDose] = useState(med?.dose || '');
  const [note, setNote] = useState(med?.note || '');
  const [color, setColor] = useState(med?.color || COLORS[0]);
  const [times, setTimes] = useState(med?.times?.length ? [...med.times] : ['09:00']);
  const [busy, setBusy] = useState(false);

  const setTime = (i, v) => setTimes((t) => t.map((x, j) => (j === i ? v : x)));

  async function save() {
    if (!name.trim()) { ui.toast('Please enter a name.', 'bad'); return; }
    const clean = [...new Set(times.filter(Boolean))].sort();
    if (!clean.length) { ui.toast('Please set at least one time.', 'bad'); return; }
    setBusy(true);
    try {
      await saveMedication({ id: med?.id, name: name.trim(), dose: dose.trim(), times: clean, note: note.trim(), color });
      ui.toast(editing ? 'Medicine updated.' : 'Medicine added.');
      onSaved();
    } catch { ui.toast('Could not save.', 'bad'); setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Edit medicine' : 'Add a medicine'} onClose={onClose}>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vitamin D" maxLength={60} /></Field>
      <Field label="Dose"><Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 1000 IU or 1 tablet" maxLength={40} /></Field>
      <Field label="Time(s) each day">
        {times.map((t, i) => (
          <div key={i} className="time-row">
            <Input type="time" value={t} onChange={(e) => setTime(i, e.target.value)} />
            {times.length > 1 && <Button variant="danger" size="sm" full={false} onClick={() => setTimes((x) => x.filter((_, j) => j !== i))}>Remove</Button>}
          </div>
        ))}
        {times.length < 4 && <Button variant="ghost" size="sm" full={false} icon="plus" onClick={() => setTimes((t) => [...t, '12:00'])}>Add another time</Button>}
      </Field>
      <Field label="Color">
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} type="button" className={`swatch${color === c ? ' is-active' : ''}`} style={{ background: c }}
              aria-label={`Color ${c}`} onClick={() => setColor(c)} />
          ))}
        </div>
      </Field>
      <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. take with food" maxLength={80} /></Field>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{editing ? 'Save changes' : 'Add medicine'}</Button>
      </div>
    </Modal>
  );
}
