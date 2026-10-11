import { useEffect, useState } from 'react';
import { GuardianCodeEntry } from '../components/GuardianCodeEntry.jsx';
import { Icon } from '../components/Icon.jsx';
import { InstallButton } from '../components/InstallButton.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { supabase } from '../lib/supabase.js';
import { pushSupported, enablePush } from '../lib/push.js';
import { markGuardianDevice } from '../lib/guardian.js';

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
  const [checkingCode, setCheckingCode] = useState(false);

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
    setCheckingCode(true);
    const { data, error: err } = await callGuardianJoin({ action: 'info', code });
    setCheckingCode(false);
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
      markGuardianDevice();
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
        <a className="mkt-btn mkt-btn--link" href="/?home=1"><Icon name="back" size={20} /> Back</a>
        <div className="mkt-brand" style={{ fontSize: 20 }}>
          <span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay
        </div>
        <span style={{ width: 70 }} />
      </div>

      <div className="ob__body">
        <div className="ob__card">
          {status === 'code' && <CodeEntry error={error} busy={checkingCode} onSubmit={submitCode} />}

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
                This device is registered for alerts about {patient}. Your device settings and connection affect whether they appear.
              </p>
              <p style={{ color: 'var(--m-soft)' }}>
                Keep MyDay on your home screen and allow notifications in your device settings. Registration does not confirm that an alert has been received.
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

function CodeEntry({ error, busy, onSubmit }) {
  return <>
    <h2 className="ob__q">Enter your code</h2>
    <p>Ask the person you are helping to open Profile → Invite a guardian and read you their code.</p>
    <GuardianCodeEntry error={error} busy={busy} onSubmit={onSubmit} />
  </>;
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
        MyDay can send alerts about untaken doses for {patient} using the saved alert timing, plus a daily summary if enabled.
      </p>
      {error && <div className="ob__err">{error}</div>}

      <div className="ob-field">
        <label htmlFor="join-name">Your name</label>
        <input id="join-name" className="ob-input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sarah" autoComplete="name" />
      </div>

      {installed ? (
        <p className="join-ok"><Icon name="check" size={20} /> MyDay is installed on this device.</p>
      ) : (
        <div className="join-gate">
          <div className="join-gate__t"><Icon name="download" size={20} /> First, add MyDay to this device</div>
          <p className="join-gate__d">
            Install MyDay to show alerts under its name. iPhone and iPad require the home screen app for push alerts. Permission, device settings and a connection are also needed.
          </p>
          <InstallButton className="mkt-btn mkt-btn--primary mkt-btn--block" label="Add MyDay to this device" iconSize={20} />
          <button type="button" className="join-gate__skip" onClick={() => setOverride(true)}>
            I can't do this — turn on alerts in the browser anyway
          </button>
        </div>
      )}

      <p className="guardian-code__hint">Enter your name and install MyDay, or choose the browser option, before turning on alerts.</p>
      <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block"
        onClick={onTurnOn} disabled={saving || !canEnable || !name.trim()}>
        {saving ? 'Turning on…' : 'Turn on alerts'}
      </button>
    </>
  );
}
