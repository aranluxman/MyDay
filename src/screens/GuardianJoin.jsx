import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon.jsx';
import { InstallButton } from '../components/InstallButton.jsx';
import { supabase } from '../lib/supabase.js';
import { pushSupported, enablePush } from '../lib/push.js';

// Calls the guardian-join edge function and normalises errors. On a non-2xx the
// function's JSON body arrives via error.context (a Response), so read the real
// message ("expired", "no longer valid") instead of a generic failure.
async function callGuardianJoin(body) {
  const { data, error } = await supabase.functions.invoke('guardian-join', { body });
  if (error) {
    let msg = '';
    try { msg = (await error.context.json())?.error; } catch { /* body wasn't JSON */ }
    return { error: msg || 'This invite could not be opened. Please check your connection.' };
  }
  if (data?.error) return { error: data.error };
  return { data };
}

// Public page a guardian opens from an invite link (/guardian?invite=<token>).
// They are a different person on their own phone with no MyDay account, so this
// screen talks only to the unauthenticated `guardian-join` edge function.
export default function GuardianJoin() {
  const token = new URLSearchParams(window.location.search).get('invite') || '';
  const [status, setStatus] = useState('loading'); // loading | invalid | ready | saving | done
  const [info, setInfo] = useState(null);          // { patient_name, guardian_name }
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) { setStatus('invalid'); setError('This link is missing its invite code.'); return; }
      const { data, error: err } = await callGuardianJoin({ action: 'info', token });
      if (!alive) return;
      if (err) { setStatus('invalid'); setError(err); return; }
      setInfo(data);
      setName(data.guardian_name || '');
      setStatus('ready');
    })();
    return () => { alive = false; };
  }, [token]);

  async function turnOn() {
    setError('');
    setStatus('saving');
    try {
      const sub = await enablePush();
      const subscription = sub.toJSON ? sub.toJSON() : sub;
      const { error: err } = await callGuardianJoin({ action: 'subscribe', token, name: name.trim(), subscription });
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
        <span style={{ width: 70 }} />
        <div className="mkt-brand" style={{ fontSize: 20 }}>
          <span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay
        </div>
        <span style={{ width: 70 }} />
      </div>

      <div className="ob__body">
        <div className="ob__card">
          {status === 'loading' && <p style={{ color: 'var(--m-soft)' }}>Opening your invite…</p>}

          {status === 'invalid' && (
            <>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>This invite isn't active</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>{error}</p>
              <p style={{ color: 'var(--m-soft)' }}>Ask the person who invited you to send a fresh link from their MyDay app.</p>
            </>
          )}

          {status === 'done' && (
            <>
              <div className="ob__art" aria-hidden="true" style={{ marginBottom: 8 }}><Icon name="check" size={44} /></div>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>You're all set</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>
                You'll get an alert on this phone if {patient} misses a medication, plus a short summary each evening.
              </p>
              <p style={{ color: 'var(--m-soft)' }}>
                Keep MyDay on your home screen so alerts keep arriving. You can close this page.
              </p>
            </>
          )}

          {(status === 'ready' || status === 'saving') && (
            <>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>{patient} invited you</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 18 }}>
                Get a notification on this phone if {patient} misses a medication — plus a short daily summary.
              </p>
              {error && <div className="ob__err">{error}</div>}

              <div className="ob-field">
                <label>Your name</label>
                <input className="ob-input" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sarah" autoComplete="name" />
              </div>

              {pushSupported() ? (
                <>
                  <p style={{ color: 'var(--m-soft)', fontSize: 14, margin: '4px 0 10px' }}>
                    For the most reliable alerts, add MyDay to your home screen first, then turn on alerts.
                  </p>
                  <InstallButton label="Add MyDay to my phone" />
                  <div style={{ height: 10 }} />
                  <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block"
                    onClick={turnOn} disabled={status === 'saving'}>
                    {status === 'saving' ? 'Turning on…' : 'Turn on alerts'}
                  </button>
                </>
              ) : (
                <p style={{ color: 'var(--m-soft)' }}>
                  On iPhone, tap the Share button in Safari and choose “Add to Home Screen”. Open MyDay from your home
                  screen, then reopen this invite to turn on alerts.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
