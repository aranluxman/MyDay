import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Modal, Field, Input, Textarea, SegmentedControl, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { NoteChat } from '../components/NoteChat.jsx';
import { listDiary, saveDiary, deleteDiary } from '../lib/db.js';
import { prettyClock, prettyDate, localDateStr } from '../lib/format.js';

// Diary words, not chart words: "How I felt" in a warm tone rather than
// SYMPTOM in alarm red, which read like a medical alert on a personal note.
// The stored values stay the same, so older entries keep their category.
const CATS = {
  symptom: { label: 'How I felt', icon: 'pulse', cls: 'warm' },
  event: { label: 'Health moment', icon: 'stethoscope', cls: 'violet' },
  note: { label: 'Journal entry', icon: 'notes', cls: 'primary' },
  other: { label: 'Mood log', icon: 'smile', cls: 'good' },
};

// One-tap starters, as coloured tiles. Each opens the note form pre-filled,
// so a note takes a single tap. Titles the Home check-in writes are matched
// too, so those notes get the same face and tag in the diary.
const FEELINGS = [
  { label: 'Good day', category: 'note', title: 'Good day', icon: 'smile', cls: 'good', tag: 'Mood log' },
  { label: 'Okay', category: 'other', title: 'Feeling okay', icon: 'smile', cls: 'primary', tag: 'Mood log' },
  { label: 'Tired', category: 'symptom', title: 'Feeling tired', icon: 'frown', cls: 'warm', tag: 'Mood log' },
  { label: 'Pain', category: 'symptom', title: 'Pain', icon: 'bolt', cls: 'bad', tag: 'Pain note' },
  { label: 'Headache', category: 'symptom', title: 'Headache', icon: 'headache', cls: 'violet', tag: 'Pain note' },
  { label: 'Doctor visit', category: 'event', title: 'Doctor visit', icon: 'stethoscope', cls: 'violet', tag: 'Doctor visit' },
];
const LOOKS = {
  'feeling great': { icon: 'smile', cls: 'good', tag: 'Mood log' },
  'feeling good': { icon: 'smile', cls: 'good', tag: 'Mood log' },
  'not feeling well': { icon: 'frown', cls: 'warm', tag: 'How I felt' },
  'in pain': { icon: 'bolt', cls: 'bad', tag: 'Pain note' },
  dizziness: { icon: 'pulse', cls: 'warm', tag: 'How I felt' },
};
for (const f of FEELINGS) LOOKS[f.title.toLowerCase()] = f;
function lookOf(e) {
  const c = CATS[e.category] || CATS.note;
  const f = LOOKS[String(e.title || '').trim().toLowerCase()];
  return f ? { icon: f.icon, cls: f.cls, label: f.tag } : c;
}

// A general chat, not about one note: the helper needs something to start
// from, so it gets a gentle opener. Nothing is saved to the diary from it.
const CHECK_IN = { category: 'note', title: 'Checking in', body: 'I would like to talk about how I am feeling today.' };

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
      message: 'Want to chat about it with MyDay? It can help you reflect on your note and prepare questions for your doctor or pharmacist.',
      confirmLabel: 'Yes, let\'s chat', cancelLabel: 'Not now',
    });
    if (ok) setChatting(row);
  }

  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={3} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;

  return (
    <div className="stack">
      <div className="updates-head">
        <h2 className="updates-head__t">Your health diary</h2>
        <p className="updates-head__d">Track how you feel each day and chat with MyDay for support.</p>
      </div>

      <FeelingTiles onPick={(draft) => setEditing(draft)} />

      <button type="button" className="chatbar" onClick={() => setChatting(CHECK_IN)}>
        <span className="chatbar__ic" aria-hidden="true"><Icon name="sparkle" size={26} /></span>
        <span className="chatbar__main">
          <span className="chatbar__t">Chat with MyDay</span>
          <span className="chatbar__d">Talk about how you're feeling or ask a question.</span>
        </span>
        <Icon name="chevron" size={22} />
      </button>

      {!data.length && (
        <p className="muted updates-empty">Your notes will show here, day by day. Tap a feeling above to write your first one.</p>
      )}

      {groupByDay(data).map((g, gi) => (
        <section key={g.day} className="tl-day" aria-label={dayHeading(g.day)}>
          <div className="tl-day__head">
            <h3 className="tl-day__h">{dayHeading(g.day)}</h3>
            <span className="tl-day__date"><Icon name="calendar" size={18} /> {shortDay(g.day)}</span>
          </div>
          <ol className="timeline">
            {g.rows.map((e, i) => (
              <DiaryItem key={e.id} entry={e} first={gi === 0 && i === 0}
                onChat={() => setChatting(e)} onEdit={() => setEditing(e)} onDelete={() => remove(e)} />
            ))}
          </ol>
        </section>
      ))}

      {!!data.length && <Button variant="ghost" icon="plus" onClick={() => setEditing({})}>Add a health note</Button>}
      {editing && <DiaryForm entry={editing.id ? editing : null} draft={editing.id ? null : editing} onClose={() => setEditing(null)}
        onSaved={(row, isNew) => { setEditing(null); reload(); if (isNew && row) offerChat(row); }} />}
      {chatting && <NoteChat entry={chatting} general={chatting === CHECK_IN} recent={data} onClose={() => setChatting(null)} onSaved={reload} />}
    </div>
  );
}

const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// One note on the timeline: its face and time on the left, the note on the
// right. Edit and Delete sit behind "…" (open on the newest note), so the
// diary reads as a diary rather than a wall of buttons.
function DiaryItem({ entry: e, first, onChat, onEdit, onDelete }) {
  const [tools, setTools] = useState(first);
  const look = lookOf(e);
  const { text, replies } = splitChat(e.body);
  const toolsId = `note-tools-${e.id}`;
  const name = e.title || look.label;
  return (
    <li className="tl">
      <div className="tl__side">
        <span className={`tl__dot tl__dot--${look.cls}`} aria-hidden="true"><Icon name={look.icon} size={22} /></span>
        <span className="tl__time">{prettyClock(new Date(e.entry_at))}</span>
      </div>
      <Card className="tl__card">
        <div className="tl__top">
          <span className={`tl__cat tl__cat--${look.cls}`}>{look.label}</span>
          <button type="button" className="tl__menu" aria-expanded={tools} aria-controls={toolsId}
            aria-label={`Edit or delete: ${name}`} onClick={() => setTools((v) => !v)}>
            <Icon name="dots" size={24} stroke={3} className="tl__dots" />
          </button>
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
        <button type="button" className="tl__talk" onClick={onChat}>
          <Icon name="chat" size={22} /> Chat with MyDay
        </button>
        {tools && (
          <div className="btn-row tl__tools" id={toolsId}>
            <Button variant="ghost" size="sm" icon="edit" onClick={onEdit}>Edit</Button>
            <Button variant="danger" size="sm" icon="trash" onClick={onDelete}>Delete</Button>
          </div>
        )}
      </Card>
    </li>
  );
}

function FeelingTiles({ onPick }) {
  return (
    <Card className="feel">
      <h3 className="feel__q" id="feel-q">How are you feeling now?</h3>
      <p className="feel__d">Tap a feeling to add it to your diary.</p>
      <div className="feel__grid" role="group" aria-labelledby="feel-q">
        {FEELINGS.map((f) => (
          <button key={f.label} type="button" className={`feel__tile feel__tile--${f.cls}`}
            onClick={() => onPick({ category: f.category, title: f.title })}>
            <span className="feel__ic" aria-hidden="true"><Icon name={f.icon} size={30} /></span>
            <span className="feel__l">{f.label}</span>
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
