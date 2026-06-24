import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Modal, Field, Input, Textarea, EmptyState, SegmentedControl, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { listDiary, saveDiary, deleteDiary } from '../lib/db.js';
import { relativeTime } from '../lib/format.js';

const CATS = {
  symptom: { label: 'Symptom', icon: 'pulse', cls: 'bad' },
  event: { label: 'Health event', icon: 'cross', cls: 'warn' },
  note: { label: 'Note', icon: 'notes', cls: 'primary' },
  other: { label: 'Other', icon: 'star', cls: 'good' },
};

export default function Updates() {
  const ui = useUI();
  const location = useLocation();
  const [editing, setEditing] = useState(null);
  const { data, loading, error, reload } = useAsync(() => listDiary(80), []);

  useEffect(() => {
    if (location.state?.add === 'diary') { setEditing({}); window.history.replaceState({}, ''); }
  }, [location.key]);

  async function remove(e) {
    const ok = await ui.confirm({ title: 'Delete note', message: 'Delete this note?', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await deleteDiary(e.id); ui.toast('Deleted.', 'info'); reload(); } catch { ui.toast('Could not delete.', 'bad'); }
  }

  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={3} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;

  return (
    <div className="stack">
      <div className="updates-head">
        <div>
          <h2 className="section">Health diary</h2>
          <p className="muted">Symptoms, health events, and anything worth remembering.</p>
        </div>
      </div>

      {!data.length && <FeelingPrompt onPick={(draft) => setEditing(draft)} />}

      <div className="timeline">
        {data.map((e) => {
          const c = CATS[e.category] || CATS.note;
          return (
            <div key={e.id} className="tl">
              <span className={`tl__dot tl__dot--${c.cls}`}><Icon name={c.icon} size={18} /></span>
              <Card className="tl__card">
                <div className="tl__top">
                  <span className={`tl__cat tl__cat--${c.cls}`}>{c.label}</span>
                  <span className="tl__time">{relativeTime(e.entry_at)}</span>
                </div>
                {e.title && <div className="card__title">{e.title}</div>}
                {e.body && <div className="tl__body">{e.body}</div>}
                <div className="btn-row">
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(e)}>Edit</Button>
                  <Button variant="danger" size="sm" icon="trash" onClick={() => remove(e)}>Delete</Button>
                </div>
              </Card>
            </div>
          );
        })}
      </div>

      <Button icon="plus" onClick={() => setEditing({})}>Add a health note</Button>
      {editing && <DiaryForm entry={editing.id ? editing : null} draft={editing.id ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

// Friendly empty state: a warm question plus one-tap starters that open the
// note form pre-filled, so the first entry takes a single tap.
const FEELINGS = [
  { label: 'Good day', category: 'note', title: 'Good day' },
  { label: 'Headache', category: 'symptom', title: 'Headache' },
  { label: 'Tired', category: 'symptom', title: 'Feeling tired' },
  { label: 'Dizzy', category: 'symptom', title: 'Dizziness' },
  { label: 'Pain', category: 'symptom', title: 'Pain' },
  { label: 'Doctor visit', category: 'event', title: 'Doctor visit' },
];
function FeelingPrompt({ onPick }) {
  return (
    <Card className="feeling">
      <div className="feeling__ic"><Icon name="pulse" size={30} /></div>
      <h3 className="feeling__q">How are you feeling today?</h3>
      <p className="muted">Tap one to start a note, or add your own below.</p>
      <div className="feeling__tags">
        {FEELINGS.map((f) => (
          <button key={f.label} className="feeling__tag" onClick={() => onPick({ category: f.category, title: f.title })}>
            {f.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function DiaryForm({ entry, draft, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!entry;
  const seed = entry || draft || {};
  const [category, setCategory] = useState(seed.category || 'symptom');
  const [title, setTitle] = useState(seed.title || '');
  const [body, setBody] = useState(seed.body || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() && !body.trim()) { ui.toast('Please write something.', 'bad'); return; }
    setBusy(true);
    try {
      await saveDiary({ id: entry?.id, category, title: title.trim(), body: body.trim(), entry_at: entry?.entry_at });
      ui.toast(editing ? 'Note updated.' : 'Note saved.');
      onSaved();
    } catch { ui.toast('Could not save.', 'bad'); setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Edit note' : 'Add a health note'} onClose={onClose}>
      <Field label="Type">
        <SegmentedControl value={category} onChange={setCategory}
          options={Object.entries(CATS).map(([value, c]) => ({ value, label: c.label }))} />
      </Field>
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Headache, Dizziness" maxLength={80} /></Field>
      <Field label="Details"><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe what happened, when, and how you felt." maxLength={1000} /></Field>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} icon={busy ? 'clock' : undefined} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save note'}</Button>
      </div>
    </Modal>
  );
}
