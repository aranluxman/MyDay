import { useEffect, useRef, useState } from 'react';
import { Modal, Button } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { chatAboutNote } from '../lib/ai.js';
import { CHAT_UNAVAILABLE } from '../lib/aiErrors.js';
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
  const [savingNote, setSavingNote] = useState(false);
  const sending = useRef(false);
  const saving = useRef(false);
  const mounted = useRef(true);
  const followLatest = useRef(true);
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
    if (sending.current || (message == null && !msg) || messages.filter((m) => m.role === 'user').length >= MAX_TURNS) return;
    sending.current = true;
    followLatest.current = true;
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
        doses: await loadDoses(), history: history.slice(-MAX_TURNS * 2), message: msg,
      });
      if (!mounted.current) return;
      const r = normaliseChatReply(raw);
      setMessages([...next, { role: 'assistant', content: r.reply }]);
      setSuggestions(r.suggestions);
      if (r.urgent) setUrgent(true);
    } catch (e) {
      if (!mounted.current) return;
      setFailed({ message: msg, error: CHAT_UNAVAILABLE, retryable: e.retryable === true });
      setMessages(history);
      setText(msg);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // Opens with the helper's first message, so there is nothing to figure out.
  const started = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!started.current) { started.current = true; send(''); }
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const body = endRef.current?.closest('.sheet__body');
    if (!body) return;
    const track = () => { followLatest.current = body.scrollHeight - body.scrollTop - body.clientHeight < 80; };
    body.addEventListener('scroll', track);
    return () => body.removeEventListener('scroll', track);
  }, []);
  useEffect(() => {
    const body = endRef.current?.closest('.sheet__body');
    if (body && followLatest.current) body.scrollTop = body.scrollHeight;
  }, [messages, busy]);

  async function saveToNote() {
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last || saving.current || saved) return;
    saving.current = true;
    setSavingNote(true);
    const add = `From my chat with MyDay (generated text, not clinical advice): ${last.content}`;
    try {
      await saveDiary({ ...entry, body: [entry.body, add].filter(Boolean).join('\n\n') });
      setSaved(true);
      ui.toast('Added to your note.');
      onSaved?.();
    } catch { ui.toast('Could not save.', 'bad'); }
    finally { saving.current = false; if (mounted.current) setSavingNote(false); }
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

        {urgent && <UrgentCall />}

        <ChatLog messages={messages} busy={busy} endRef={endRef}>
          {failed && (
            <div className="nchat__fail" role="alert">
              <p>{failed.error}</p>
              <Button variant="ghost" size="sm" onClick={onClose}>Return to health diary</Button>
              {failed.retryable && <Button variant="ghost" size="sm" full={false} icon="refresh" onClick={() => send(failed.message)}>Retry</Button>}
            </div>
          )}
        </ChatLog>

        {!busy && !atLimit && <ChatChips items={suggestions} onPick={send} />}

        {atLimit ? (
          <p className="muted">Great chat — you're doing a wonderful job looking after yourself. If you still feel unwell, call your doctor or pharmacist.</p>
        ) : !failed && (
          <ChatInput text={text} setText={setText} busy={busy} onSend={() => send()} />
        )}

        {entry.id && messages.some((m) => m.role === 'assistant') && (
          <Button variant="ghost" icon={saved ? 'check' : 'notes'} disabled={saved || busy || savingNote} onClick={saveToNote}>
            {saved ? 'Saved to your note' : savingNote ? 'Saving…' : 'Save this to my note'}
          </Button>
        )}
        <p className="nchat__disclaimer">Generated text is not clinical advice. MyDay cannot diagnose, prescribe, or recommend dose changes. Ask your doctor or pharmacist about symptoms or treatment.</p>
      </div>
    </Modal>
  );
}

// ---------- pieces shared with "Ask about your medicines" ----------

export function UrgentCall({ poison }) {
  return (
    <div className="nchat__urgent" role="alert">
      <div className="nchat__urgent-t"><Icon name="alert" size={22} /> This could be serious</div>
      <p>Please call 911 now, or ask someone near you to call.{poison ? ' If you may have taken too much of a medicine, you can also call Poison Control at 1-844-764-7669.' : ''}</p>
      <a className="btn btn--danger-solid btn--md btn--full" href="tel:911"><Icon name="phone" size={20} /> Call 911</a>
    </div>
  );
}

/** The conversation: speech bubbles, then "typing" dots while waiting. */
export function ChatLog({ messages, busy, endRef, children, footnote }) {
  return (
    <div className="nchat__log" aria-live="polite">
      {messages.map((m, i) => (
        <div key={i} className={`nchat__msg nchat__msg--${m.role === 'user' ? 'me' : 'ai'}`}>
          {m.role !== 'user' && <span className="nchat__av" aria-hidden="true"><Icon name="sparkle" size={16} /></span>}
          <p>{m.content}{m.role !== 'user' && footnote && <small className="nchat__foot">{footnote}</small>}</p>
        </div>
      ))}
      {busy && (
        <div className="nchat__msg nchat__msg--ai">
          <span className="nchat__av" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
          <p className="nchat__typing" aria-label="Thinking"><span /><span /><span /></p>
        </div>
      )}
      {children}
      <div ref={endRef} />
    </div>
  );
}

export function ChatChips({ items, onPick }) {
  if (!items?.length) return null;
  return (
    <div className="chips nchat__chips">
      {items.map((s) => <button key={s} type="button" className="chip" onClick={() => onPick(s)}>{s}</button>)}
    </div>
  );
}

export function ChatInput({ text, setText, busy, onSend, placeholder = 'Type a message…', label = 'Your message' }) {
  return (
    <form className="assist__bar nchat__bar" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
      <input className="assist__input" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={placeholder} maxLength={500} enterKeyHint="send"
        aria-label={label} disabled={busy} />
      <button type="submit" className="assist__send" aria-label="Send" disabled={busy || !text.trim()}>
        <Icon name={busy ? 'clock' : 'chevron'} size={22} />
      </button>
    </form>
  );
}
