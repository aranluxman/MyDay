import { useEffect, useRef, useState } from 'react';
import { Modal, Button } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { chatAboutNote } from '../lib/ai.js';
import { normaliseChatReply } from '../lib/aiParse.js';
import { todaysDoses, saveDiary } from '../lib/db.js';
import { doseState } from '../lib/doseState.js';
import { prettyTime } from '../lib/format.js';

// "Chat with MyDay": an upbeat companion that talks with the person about the
// update they just wrote. A good day gets celebrated; "I feel dizzy" gets
// kindness first, then one gentle question at a time (sleep? water? a missed
// pill?). It is not a doctor, and says so; any red-flag symptom turns the
// reply into "call 911" with a button that does it.
//
// The chat lives only on screen. Nothing is stored unless the person taps
// "Save this to my note", which adds the helper's last reply to the entry.
const MAX_TURNS = 12;

export function NoteChat({ entry, recent = [], onClose, onSaved }) {
  const { profile } = useApp();
  const ui = useUI();
  const [messages, setMessages] = useState([]); // { role, content }
  const [suggestions, setSuggestions] = useState([]);
  const [urgent, setUrgent] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const [saved, setSaved] = useState(false);
  const doses = useRef(null);
  const endRef = useRef(null);

  // Today's medicines, taken or missed: "you took all of them!" is worth saying,
  // and "did I miss one?" is often why someone feels off.
  async function loadDoses() {
    if (doses.current) return doses.current;
    const opts = { windowMinutes: profile?.alert_window_minutes ?? 60 };
    try {
      const list = await todaysDoses();
      doses.current = list.map((d) => ({
        name: d.medication?.name || 'Medicine',
        time: d.scheduled_time ? prettyTime(d.scheduled_time) : '',
        status: doseState(d, opts),
      }));
    } catch { doses.current = []; }
    return doses.current;
  }

  async function send(message) {
    const msg = (message ?? text).trim();
    if (busy) return;
    const history = messages;
    const next = msg ? [...history, { role: 'user', content: msg }] : history;
    setMessages(next);
    setText('');
    setSuggestions([]);
    setFailed(null);
    setBusy(true);
    try {
      const raw = await chatAboutNote({
        entry, recent: recent.filter((r) => r.id !== entry.id).slice(0, 5),
        doses: await loadDoses(), history: history.slice(-MAX_TURNS), message: msg,
      });
      const r = normaliseChatReply(raw);
      setMessages([...next, { role: 'assistant', content: r.reply }]);
      setSuggestions(r.suggestions);
      if (r.urgent) setUrgent(true);
    } catch (e) {
      setFailed({ message: msg, error: e.message || 'The helper could not answer just now.' });
      setMessages(history);
    }
    setBusy(false);
  }

  // Opens with the helper's first message, so there is nothing to figure out.
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; send(''); } }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, busy]);

  async function saveToNote() {
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last) return;
    const add = `From my chat with MyDay: ${last.content}`;
    try {
      await saveDiary({ ...entry, body: [entry.body, add].filter(Boolean).join('\n\n') });
      setSaved(true);
      ui.toast('Added to your note.');
      onSaved?.();
    } catch { ui.toast('Could not save.', 'bad'); }
  }

  const turns = messages.filter((m) => m.role === 'user').length;
  const atLimit = turns >= MAX_TURNS;

  return (
    <Modal title="Chat with MyDay" onClose={onClose}>
      <div className="nchat">
        <div className="nchat__note">
          <Icon name="notes" size={20} />
          <span><b>{entry.title || 'Your note'}</b>{entry.body ? ` — ${entry.body.slice(0, 120)}${entry.body.length > 120 ? '…' : ''}` : ''}</span>
        </div>

        {urgent && (
          <div className="nchat__urgent" role="alert">
            <div className="nchat__urgent-t"><Icon name="alert" size={22} /> This could be serious</div>
            <p>Please call 911 now, or ask someone near you to call.</p>
            <a className="btn btn--danger-solid btn--md btn--full" href="tel:911"><Icon name="phone" size={20} /> Call 911</a>
          </div>
        )}

        <div className="nchat__log" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`nchat__msg nchat__msg--${m.role === 'user' ? 'me' : 'ai'}`}>
              {m.role !== 'user' && <span className="nchat__av" aria-hidden="true"><Icon name="sparkle" size={16} /></span>}
              <p>{m.content}</p>
            </div>
          ))}
          {busy && (
            <div className="nchat__msg nchat__msg--ai">
              <span className="nchat__av" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
              <p className="nchat__typing" aria-label="Thinking"><span /><span /><span /></p>
            </div>
          )}
          {failed && (
            <div className="nchat__fail">
              <p>{failed.error}</p>
              <Button variant="ghost" size="sm" full={false} icon="refresh" onClick={() => send(failed.message)}>Try again</Button>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {!busy && !!suggestions.length && (
          <div className="chips nchat__chips">
            {suggestions.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}

        {atLimit ? (
          <p className="muted">Great chat — you're doing a wonderful job looking after yourself. If you still feel unwell, call your doctor or pharmacist.</p>
        ) : (
          <form className="assist__bar nchat__bar" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input className="assist__input" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…" maxLength={500} enterKeyHint="send"
              aria-label="Your message" disabled={busy} />
            <button type="submit" className="assist__send" aria-label="Send" disabled={busy || !text.trim()}>
              <Icon name={busy ? 'clock' : 'chevron'} size={22} />
            </button>
          </form>
        )}

        {entry.id && messages.some((m) => m.role === 'assistant') && (
          <Button variant="ghost" icon={saved ? 'check' : 'notes'} disabled={saved || busy} onClick={saveToNote}>
            {saved ? 'Saved to your note' : 'Save this to my note'}
          </Button>
        )}
        <p className="nchat__disclaimer">MyDay's helper is not a doctor. For anything worrying, call your doctor, pharmacist, or Health811 (dial 811).</p>
      </div>
    </Modal>
  );
}
