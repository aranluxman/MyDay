import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { ChatLog, ChatChips, ChatInput, UrgentCall } from '../components/NoteChat.jsx';
import { loadCache } from '../components/MedicineInsights.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { listMedications } from '../lib/db.js';
import { askAboutMedicines } from '../lib/ai.js';
import { medsSignature, normaliseMedicineReply } from '../lib/aiParse.js';
import { MEDICINE_CHAT_UNAVAILABLE } from '../lib/aiErrors.js';

// "Have a question?" after "How your medicines work together": a page for
// follow-up questions about the person's own list. General information only —
// it says so at the top, under every answer, and the server refuses anything
// that is really a dosing decision and points to the pharmacist instead.
//
// Nothing is saved: the conversation lives only on this screen.
const MAX_TURNS = 12;
const STARTERS = ['What is each one for?', 'Do any of these work together?', 'Why take some with food?', 'What should I ask my pharmacist?'];
const DISCLAIMER = 'This is general information, not medical advice. Always check with your pharmacist or doctor before changing how you take any medicine.';

export default function MedicineAsk() {
  const { user } = useApp();
  const navigate = useNavigate();
  const meds = useAsync(() => listMedications(), []);
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState(STARTERS);
  const [urgent, setUrgent] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const endRef = useRef(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (messages.length || busy) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, busy]);

  const list = meds.data || [];
  // The summary they just read, if it still matches their list.
  const cache = loadCache(user?.id);
  const insights = cache && cache.sig === medsSignature(list) ? cache.result : null;
  const turns = messages.filter((m) => m.role === 'user').length;
  const atLimit = turns >= MAX_TURNS;

  async function send(message) {
    const msg = String(message ?? text).trim();
    if (!msg || sending.current || atLimit) return;
    sending.current = true;
    const history = messages;
    const next = [...history, { role: 'user', content: msg }];
    setMessages(next);
    setText('');
    setSuggestions([]);
    setFailed(null);
    setBusy(true);
    try {
      const raw = await askAboutMedicines({ meds: list, insights, history: history.slice(-MAX_TURNS * 2), message: msg });
      if (!mounted.current) return;
      const r = normaliseMedicineReply(raw);
      setMessages([...next, { role: 'assistant', content: r.reply }]);
      setSuggestions(r.suggestions);
      if (r.urgent) setUrgent(true);
    } catch (e) {
      if (!mounted.current) return;
      setFailed({ message: msg, error: e.message || MEDICINE_CHAT_UNAVAILABLE, retryable: e.retryable === true });
      setMessages(history);
      setText(msg);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (meds.loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={3} /></div>;

  return (
    <div className="stack mask">
      <button type="button" className="mask__back" onClick={() => navigate('/medication', { state: { view: 'medicines' } })}>
        <Icon name="back" size={20} /> <span>Back to my medicines</span>
      </button>

      <div className="mask__disclaimer" role="note">
        <Icon name="info" size={22} />
        <p><b>Not medical advice.</b> MyDay shares general information about how medicines work. It can't tell you how much to take, or whether to start, stop or change a medicine. Your pharmacist or doctor knows your full health picture — always check with them.</p>
      </div>

      {!list.length ? (
        <Card className="center">
          <p className="lead">Add a medicine first, then you can ask about it here.</p>
          <Button icon="plus" onClick={() => navigate('/medication', { state: { add: 'med' } })}>Add a medicine</Button>
        </Card>
      ) : (
        <Card className="mask__chat">
          <div className="mask__meds" aria-label="Your medicines">
            {list.slice(0, 12).map((m) => <span key={m.id} className="chip chip--static" translate="no">{m.name}</span>)}
            {list.length > 12 && <span className="chip chip--static">+{list.length - 12} more</span>}
          </div>

          <div className="nchat">
            {!messages.length && !busy && (
              <div className="nchat__msg nchat__msg--ai">
                <span className="nchat__av" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
                <p>Hi! Ask me anything about how your medicines work, what each one is for, or what to ask your pharmacist. Tap a question below or type your own.</p>
              </div>
            )}

            {urgent && <UrgentCall poison />}

            <ChatLog messages={messages} busy={busy} endRef={endRef} footnote="General information — not medical advice.">
              {failed && (
                <div className="nchat__fail" role="alert">
                  <p>{failed.error}</p>
                  {failed.retryable && <Button variant="ghost" size="sm" full={false} icon="refresh" onClick={() => send(failed.message)}>Try again</Button>}
                </div>
              )}
            </ChatLog>

            {!busy && !atLimit && <ChatChips items={suggestions} onPick={send} />}

            {atLimit ? (
              <p className="muted">That's a lot of great questions! For anything else, your pharmacist is happy to help — it's free to ask.</p>
            ) : (
              <ChatInput text={text} setText={setText} busy={busy} onSend={() => send()}
                placeholder="Ask about your medicines…" label="Your question about your medicines" />
            )}
            <p className="nchat__disclaimer">{DISCLAIMER}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
