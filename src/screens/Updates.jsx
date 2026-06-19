import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, Modal, Field, Input, Textarea, EmptyState, SegmentedControl } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { listDiary, saveDiary, deleteDiary } from '../lib/db.js';
import { relativeTime } from '../lib/format.js';

const CATS = {
  symptom: { label: 'Symptom', icon: 'pulse', color: '#b3261e' },
  event: { label: 'Health event', icon: 'cross', color: '#8a5a00' },
  note: { label: 'Note', icon: 'notes', color: '#2563a8' },
  other: { label: 'Other', icon: 'star', color: '#6d28d9' },
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

  if (loading) return <Spinner label="Loading your health notes..." />;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;

  return (
    <div className="stack">
      <div className="updates-head">
        <div>
          <h2 className="section">Health diary</h2>
          <p className="muted">Symptoms, health events, and anything worth remembering.</p>
        </div>
      </div>

      {!data.length && <EmptyState icon="notes" title="No notes yet">Keep track of how you feel, symptoms, or important health events.</EmptyState>}

      <div className="timeline">
        {data.map((e) => {
          const c = CATS[e.category] || CATS.note;
          return (
            <div key={e.id} className="tl">
              <span className="tl__dot" style={{ background: c.color }}><Icon name={c.icon} size={18} /></span>
              <Card className="tl__card">
                <div className="tl__top">
                  <span className="tl__cat" style={{ color: c.color }}>{c.label}</span>
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
      {editing && <DiaryForm entry={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function DiaryForm({ entry, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!entry;
  const [category, setCategory] = useState(entry?.category || 'symptom');
  const [title, setTitle] = useState(entry?.title || '');
  const [body, setBody] = useState(entry?.body || '');
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
        <Button disabled={busy} onClick={save}>{editing ? 'Save changes' : 'Save note'}</Button>
      </div>
    </Modal>
  );
}
