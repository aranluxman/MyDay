import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon.jsx';
import { InstallButton } from '../components/InstallButton.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { supabase } from '../lib/supabase.js';
import { pushSupported, enablePush } from '../lib/push.js';

// Calls the guardian-join edge function and normalises errors. On a non-2xx the
// function's JSON body arrives via error.context (a Response), so read the real
// message ("expired", "not recognised") instead of a generic failure.
async function callGuardianJoin(body) {
  const { data, error } = await supabase.functions.invoke('guardian-join', { body });
  if (error) {
    let msg = '';
    try { msg = (await error.context.json())?.error; } catch { /* body wasn't JSON */ }
    return { error: msg || 'We could not reach MyDay. Please check your internet and try again.' };
  }
  if (data?.error) return { error: data.error };
  return { data };
}

// Public page a helper opens on their OWN device. They are a different person
// with no MyDay account, so this screen talks only to the unauthenticated
// `guardian-join` edge function. Two ways in:
//   /guardian                  -> type the 6-digit code read out to you
//   /guardian?invite=<token>   -> opened from a shared link
export default function GuardianJoin() {
  const linkToken = new URLSearchParams(window.location.search).get('invite') || '';
  // code | loading | invalid | ready | saving | done
  const [status, setStatus] = useState(linkToken ? 'loading' : 'code');
  const [info, setInfo] = useState(null);          // { patient_name, guardian_name }
  const [credential, setCredential] = useState(linkToken ? { token: linkToken } : null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  // Link route: look the invite up straight away.
  useEffect(() => {
    if (!linkToken) return;
    let alive = true;
    (async () => {
      const { data, error: err } = await callGuardianJoin({ action: 'info', token: linkToken });
      if (!alive) return;
      if (err) { setStatus('invalid'); setError(err); return; }
      setInfo(data);
      setName(data.guardian_name || '');
      setStatus('ready');
    })();
    return () => { alive = false; };
  }, [linkToken]);

  // Code route: the helper typed six digits.
  async function submitCode(code) {
    setError('');
    setStatus('loading');
    const { data, error: err } = await callGuardianJoin({ action: 'info', code });
    if (err) { setError(err); setStatus('code'); return; }
    setCredential({ code });
    setInfo(data);
    setName(data.guardian_name || '');
    setStatus('ready');
  }

  async function turnOn() {
    setError('');
    setStatus('saving');
    try {
      const sub = await enablePush();
      const subscription = sub.toJSON ? sub.toJSON() : sub;
      const { error: err } = await callGuardianJoin({ action: 'subscribe', ...credential, name: name.trim(), subscription });
      if (err) throw new Error(err);
      setStatus('done');
    } catch (e) {
      setError(e.message || 'Could not turn on alerts. Please try again.');
      setStatus('ready');
    }
  }

  const patient = info?.patient_name || 'Someone';

  return (
    <div className="mkt ob">
      <div className="ob__top">
        <a className="mkt-btn mkt-btn--link" href="/"><Icon name="back" size={20} /> Back</a>
        <div className="mkt-brand" style={{ fontSize: 20 }}>
          <span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay
        </div>
        <span style={{ width: 70 }} />
      </div>

      <div className="ob__body">
        <div className="ob__card">
          {status === 'code' && <CodeEntry error={error} onSubmit={submitCode} />}

          {status === 'loading' && <p style={{ color: 'var(--m-soft)' }}>Checking…</p>}

          {status === 'invalid' && (
            <>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>This invite isn't active</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>{error}</p>
              <p style={{ color: 'var(--m-soft)' }}>Ask the person who invited you to open MyDay and make a new code.</p>
              <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block"
                onClick={() => { setError(''); setStatus('code'); }}>Type a code instead</button>
            </>
          )}

          {status === 'done' && (
            <>
              <div className="ob__art" aria-hidden="true" style={{ marginBottom: 8 }}><Icon name="check" size={44} /></div>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>You're all set</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>
                You'll get an alert on this device if {patient} misses a medication, plus a short summary each evening.
              </p>
              <p style={{ color: 'var(--m-soft)' }}>
                Keep MyDay on your home screen so alerts keep arriving. You can close this page.
              </p>
            </>
          )}

          {(status === 'ready' || status === 'saving') && (
            <ConnectStep patient={patient} name={name} setName={setName} error={error}
              saving={status === 'saving'} onTurnOn={turnOn} />
          )}
        </div>
      </div>
    </div>
  );
}

// Six big digit boxes. One digit per box, auto-advance, paste and backspace all
// work, and the numeric keypad comes up on a tablet.
function CodeEntry({ error, onSubmit }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const refs = useRef([]);
  const code = digits.join('');

  useEffect(() => { refs.current[0]?.focus(); }, []);
  // A rejected code clears itself: retyping is one action rather than six
  // backspaces, and the empty boxes are themselves the "try again" signal.
  useEffect(() => {
    if (!error) return;
    setDigits(['', '', '', '', '', '']);
    refs.current[0]?.focus();
  }, [error]);

  function setAt(i, value) {
    const only = value.replace(/\D/g, '');
    if (!only) { setDigits((d) => d.map((x, j) => (j === i ? '' : x))); return; }
    // A paste (or a fast typist) can deliver several digits at once.
    setDigits((d) => {
      const next = [...d];
      for (let k = 0; k < only.length && i + k < 6; k++) next[i + k] = only[k];
      return next;
    });
    const landed = Math.min(i + only.length, 5);
    refs.current[landed]?.focus();
  }
  function onKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((d) => d.map((x, j) => (j === i - 1 ? '' : x)));
      refs.current[i - 1]?.focus();
    }
    if (e.key === 'Enter' && code.length === 6) onSubmit(code);
  }

  return (
    <>
      <h2 className="ob__q" style={{ marginBottom: 6 }}>Enter your code</h2>
      <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 18 }}>
        Ask the person you're helping to open MyDay, tap <b>Profile</b>, then <b>Invite a guardian</b>. They'll
        read you a 6-digit code. Type it below.
      </p>
      {error && <div className="ob__err" role="alert">{error}</div>}

      <div className={`code-boxes${error ? ' code-boxes--rejected' : ''}`}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            className="code-box"
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={6}
            value={d}
            aria-label={`Digit ${i + 1} of 6`}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>

      <div className="ob__actions">
        <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block"
          disabled={code.length !== 6} onClick={() => onSubmit(code)}>Connect</button>
      </div>
    </>
  );
}

// Second step: confirm who you are, install MyDay, then switch alerts on.
// Installing is not optional window-dressing here: until MyDay is on the home
// screen the operating system shows these alerts as coming from the browser,
// and on an iPad it refuses to deliver them at all.
function ConnectStep({ patient, name, setName, error, saving, onTurnOn }) {
  const { installed } = useInstallPrompt();
  const [override, setOverride] = useState(false);
  const canEnable = installed || override;

  if (!pushSupported()) {
    return (
      <>
        <h2 className="ob__q" style={{ marginBottom: 6 }}>{patient} invited you</h2>
        <p style={{ color: 'var(--m-soft)' }}>
          This browser can't show alerts. On an iPad or iPhone, tap the Share button in Safari, choose
          “Add to Home Screen”, then open MyDay from your home screen and enter the code again.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="ob__q" style={{ marginBottom: 6 }}>{patient} invited you</h2>
      <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 18 }}>
        You'll get a notification on this device if {patient} misses a medication — plus a short daily summary.
      </p>
      {error && <div className="ob__err">{error}</div>}

      <div className="ob-field">
        <label>Your name</label>
        <input className="ob-input" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sarah" autoComplete="name" />
      </div>

      {installed ? (
        <p className="join-ok"><Icon name="check" size={20} /> MyDay is installed on this device.</p>
      ) : (
        <div className="join-gate">
          <div className="join-gate__t"><Icon name="download" size={20} /> First, add MyDay to this device</div>
          <p className="join-gate__d">
            Alerts only arrive properly — and show up as <b>MyDay</b> rather than your web browser — once MyDay is
            on the home screen. It takes about ten seconds.
          </p>
          <InstallButton className="mkt-btn mkt-btn--primary mkt-btn--block" label="Add MyDay to this device" iconSize={20} />
          <button type="button" className="join-gate__skip" onClick={() => setOverride(true)}>
            I can't do this — turn on alerts in the browser anyway
          </button>
        </div>
      )}

      <div style={{ height: 12 }} />
      <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block"
        onClick={onTurnOn} disabled={saving || !canEnable}>
        {saving ? 'Turning on…' : 'Turn on alerts'}
      </button>
    </>
  );
}
