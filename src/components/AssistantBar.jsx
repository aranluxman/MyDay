import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { askAssistant } from '../lib/ai.js';
import { validateActions } from '../lib/aiParse.js';

// The MyDay helper: say what you want in your own words — "make the text much
// bigger", "my birthday is May 5, 1950", "I want a calmer screen" — and it
// changes the setting for you.
//
// The AI only ever proposes actions from a fixed list; validateActions decides
// what is actually applied, and every change can be undone in one tap.
const EXAMPLES = [
  'Make the text much bigger',
  'I want it more high contrast',
  'Give me a calmer screen',
  'How do I add a guardian?',
];
const PROFILE_KEYS = ['full_name', 'birthday', 'goal', 'on_treatment', 'for_whom', 'age'];

export function AssistantBar() {
  const { profile, theme, textSize, setTheme, setTextSize, updateProfile } = useApp();
  const { settings, set: setSetting } = useSettings();
  const ui = useUI();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // Last few turns, so "a bit more" follows on from "bigger text".
  const [history, setHistory] = useState([]);
  const [last, setLast] = useState(null); // { reply, changes, undo }

  function currentState() {
    return {
      text_size: textSize,
      theme,
      settings: {
        highContrast: settings.highContrast, bold: settings.bold, bigButtons: settings.bigButtons,
        calmMotion: settings.calmMotion, clock: settings.clock,
        homeCalendar: settings.homeCalendar, homeGames: settings.homeGames,
      },
      profile: {
        full_name: profile?.full_name || null, birthday: profile?.birthday || null,
        goal: profile?.goal || null, on_treatment: profile?.on_treatment || null, for_whom: profile?.for_whom || null,
      },
    };
  }

  async function apply(actions) {
    const before = {
      theme, textSize, settings: { ...settings },
      profile: Object.fromEntries(PROFILE_KEYS.map((k) => [k, profile?.[k] ?? null])),
    };
    const settingsPatch = {};
    const profilePatch = {};
    let goTo = null;

    for (const a of actions) {
      if (a.type === 'set_text_size') setTextSize(a.value);
      else if (a.type === 'set_theme') setTheme(a.value);
      else if (a.type === 'set_setting') settingsPatch[a.key] = a.value;
      else if (a.type === 'update_profile') {
        profilePatch[a.key] = a.value;
        // A stored age would override the new birthday; let it be worked out.
        if (a.key === 'birthday') profilePatch.age = null;
      } else if (a.type === 'navigate') goTo = a.value;
    }
    if (Object.keys(settingsPatch).length) setSetting(settingsPatch);
    if (Object.keys(profilePatch).length) await updateProfile(profilePatch);

    const undo = async () => {
      setTheme(before.theme);
      setTextSize(before.textSize);
      setSetting(before.settings);
      const revert = Object.fromEntries(Object.keys(profilePatch).map((k) => [k, before.profile[k]]));
      if (Object.keys(revert).length) await updateProfile(revert);
    };
    return { undo, goTo };
  }

  async function send(message) {
    const msg = (message ?? text).trim();
    if (!msg || busy) return;
    setBusy(true);
    try {
      const res = await askAssistant(msg, currentState(), history);
      const { actions } = validateActions(res?.actions);
      const reply = String(res?.reply || '').trim() || (actions.length ? 'Done.' : 'Sorry, I did not catch that. Could you say it another way?');
      const { undo, goTo } = actions.length ? await apply(actions) : { undo: null, goTo: null };
      setLast({
        question: msg,
        reply,
        changes: actions.filter((a) => a.type !== 'navigate').map((a) => a.label),
        undo: actions.some((a) => a.type !== 'navigate') ? undo : null,
      });
      setHistory((h) => [...h, { role: 'user', content: msg }, { role: 'assistant', content: reply }].slice(-6));
      setText('');
      if (goTo) navigate(goTo);
    } catch (e) {
      ui.toast(e.message || 'The helper could not answer just now.', 'bad');
    }
    setBusy(false);
  }

  async function undoLast() {
    if (!last?.undo) return;
    try {
      await last.undo();
      setLast({ ...last, undo: null, changes: [], reply: 'Okay — I put everything back the way it was.' });
      setHistory((h) => [...h, { role: 'user', content: 'Undo that.' }, { role: 'assistant', content: 'Changes undone.' }].slice(-6));
    } catch { ui.toast('Could not undo that.', 'bad'); }
  }

  return (
    <Card className="assist">
      <form className="assist__bar" role="search" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Icon name="sparkle" size={22} />
        <input ref={inputRef} className="assist__input" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Ask MyDay to change something…" maxLength={500} enterKeyHint="send"
          aria-label="Ask the MyDay helper" disabled={busy} />
        <button type="submit" className="assist__send" aria-label="Send" disabled={busy || !text.trim()}>
          <Icon name={busy ? 'clock' : 'chevron'} size={22} />
        </button>
      </form>

      {!last && !busy && (
        <div className="assist__examples">
          <span className="muted">Try:</span>
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => send(ex)}>{ex}</button>
            ))}
          </div>
        </div>
      )}

      {busy && <p className="muted assist__thinking" aria-live="polite">Working on it…</p>}

      {last && !busy && (
        <div className="assist__answer" aria-live="polite">
          <p className="assist__q">“{last.question}”</p>
          <p className="assist__reply">{last.reply}</p>
          {!!last.changes.length && (
            <ul className="assist__changes">
              {last.changes.map((c) => <li key={c}><Icon name="check" size={16} /> {c}</li>)}
            </ul>
          )}
          <div className="btn-row">
            {last.undo && <Button variant="ghost" size="sm" icon="back" onClick={undoLast}>Undo</Button>}
            <Button variant="ghost" size="sm" onClick={() => { setLast(null); inputRef.current?.focus(); }}>Ask something else</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
