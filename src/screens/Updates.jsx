import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Modal, Field, Input, Textarea, EmptyState, SegmentedControl, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { NoteChat } from '../components/NoteChat.jsx';
import { listDiary, saveDiary, deleteDiary } from '../lib/db.js';
import { prettyClock, prettyDate, localDateStr } from '../lib/format.js';

// Diary words, not chart words: "How I felt" in a warm tone rather than
// SYMPTOM in alarm red, which read like a medical alert on a personal note.
// The stored values stay the same, so older entries keep their category.
const CATS = {
  symptom: { label: 'How I felt', icon: 'pulse', cls: 'warm' },
  event: { label: 'Health moment', icon: 'cross', cls: 'primary' },
  note: { label: 'Journal entry', icon: 'notes', cls: 'good' },
  other: { label: 'Mood log', icon: 'star', cls: 'violet' },
};

// Replies saved from "Chat with MyDay" are appended to the note's text with
// this prefix. Split them back out so the helper's words show as its own
// speech bubble rather than reading as part of what the person wrote.
const CHAT_PREFIX = 'From my chat with MyDay: ';
function splitChat(body = '') {
  const parts = String(body).split(/\n{2}(?=From my chat with MyDay: )|^(?=From my chat with MyDay: )/);
  const own = [];
  const replies = [];
  for (const p of parts) {
    if (p.startsWith(CHAT_PREFIX)) replies.push(p.slice(CHAT_PREFIX.length).trim());
    else if (p.trim()) own.push(p);
  }
  return { text: own.join('\n\n'), replies };
}

// "Today", "Yesterday", then the full date, so the diary reads by day.
function dayHeading(isoDate) {
  const today = localDateStr();
  const d = new Date(); d.setDate(d.getDate() - 1);
  if (isoDate === today) return 'Today';
  if (isoDate === localDateStr(undefined, d)) return 'Yesterday';
  return prettyDate(isoDate);
}
function groupByDay(rows) {
  const groups = [];
  for (const e of rows) {
    const day = localDateStr(undefined, new Date(e.entry_at));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(e); else groups.push({ day, rows: [e] });
  }
  return groups;
}

export default function Updates() {
  const ui = useUI();
  const location = useLocation();
  const [editing, setEditing] = useState(null);
  const [chatting, setChatting] = useState(null);
  const { data, loading, error, reload } = useAsync(() => listDiary(80), []);

  useEffect(() => {
    if (location.state?.add === 'diary') { setEditing({}); window.history.replaceState({}, ''); }
  }, [location.key]);

  async function remove(e) {
    const ok = await ui.confirm({ title: 'Delete note', message: 'Delete this note?', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await deleteDiary(e.id); ui.toast('Deleted.', 'info'); reload(); } catch { ui.toast('Could not delete.', 'bad'); }
  }

  // Right after writing an update is when a kind word lands best.
  async function offerChat(row) {
    const ok = await ui.confirm({
      title: 'Nice work writing that down!',
      message: 'Want to chat about it with MyDay? It can cheer you on, or help you work out why you feel this way.',
      confirmLabel: 'Yes, let\'s chat', cancelLabel: 'Not now',
    });
    if (ok) setChatting(row);
  }

  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={3} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;

  return (
    <div className="stack">
      <div className="updates-head">
        <div>
          <h2 className="section">Health diary</h2>
          <p className="muted">Write how you feel — then tap <b>Chat with MyDay</b> to talk it over.</p>
        </div>
      </div>

      {/* The warm version only makes sense once. After that the same one-tap
          starters stay available as a compact row: they were the fastest way
          to write a note, and hiding them after the first entry meant every
          note from then on had to be typed. */}
      {!data.length
        ? <FeelingPrompt onPick={(draft) => setEditing(draft)} />
        : <QuickAdd onPick={(draft) => setEditing(draft)} />}

      {groupByDay(data).map((g) => (
        <section key={g.day} className="tl-day" aria-label={dayHeading(g.day)}>
          <h3 className="tl-day__h">{dayHeading(g.day)}</h3>
          <div className="timeline">
            {g.rows.map((e) => {
              const c = CATS[e.category] || CATS.note;
              const { text, replies } = splitChat(e.body);
              return (
                <div key={e.id} className="tl">
                  <span className={`tl__dot tl__dot--${c.cls}`}><Icon name={c.icon} size={18} /></span>
                  <Card className="tl__card">
                    <div className="tl__top">
                      <span className={`tl__cat tl__cat--${c.cls}`}>{c.label}</span>
                      <span className="tl__time">{prettyClock(new Date(e.entry_at))}</span>
                    </div>
                    {e.title && <div className="card__title">{e.title}</div>}
                    {text && <div className="tl__body">{text}</div>}
                    {!!replies.length && (
                      <details className="tl__chat">
                        <summary>
                          <span className="nchat__av" aria-hidden="true"><Icon name="sparkle" size={14} /></span>
                          {replies.length === 1 ? 'MyDay replied' : `MyDay replied ${replies.length} times`}
                        </summary>
                        {replies.map((r, i) => <p key={i} className="tl__bubble">{r}</p>)}
                      </details>
                    )}
                    <Button variant="ghost" size="sm" icon="chat" className="tl__talk" onClick={() => setChatting(e)}>Chat with MyDay</Button>
                    <div className="btn-row">
                      <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(e)}>Edit</Button>
                      <Button variant="danger" size="sm" icon="trash" onClick={() => remove(e)}>Delete</Button>
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Button icon="plus" onClick={() => setEditing({})}>Add a health note</Button>
      {editing && <DiaryForm entry={editing.id ? editing : null} draft={editing.id ? null : editing} onClose={() => setEditing(null)}
        onSaved={(row, isNew) => { setEditing(null); reload(); if (isNew && row) offerChat(row); }} />}
      {chatting && <NoteChat entry={chatting} recent={data} onClose={() => setChatting(null)} onSaved={reload} />}
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

// The same starters, compact, for a diary that already has entries.
function QuickAdd({ onPick }) {
  return (
    <section className="quickadd" aria-labelledby="quickadd-h">
      <h3 className="quickadd__h" id="quickadd-h">Quick add</h3>
      <div className="feeling__tags quickadd__tags">
        {FEELINGS.map((f) => (
          <button key={f.label} type="button" className="feeling__tag"
            onClick={() => onPick({ category: f.category, title: f.title })}>
            {f.label}
          </button>
        ))}
      </div>
    </section>
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
      const row = await saveDiary({ id: entry?.id, category, title: title.trim(), body: body.trim(), entry_at: entry?.entry_at });
      ui.toast(editing ? 'Note updated.' : 'Note saved.');
      onSaved(row, !editing);
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
