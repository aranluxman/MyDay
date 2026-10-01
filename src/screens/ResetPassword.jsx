import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { supabase } from '../lib/supabase.js';
import { describeResetError } from '../lib/authErrors.js';

// "I forgot my password" — step two, reached from the emailed link. Opening
// that link signs the person in temporarily, so this screen is shown ahead of
// the app until they have actually chosen a new password.
export default function ResetPassword({ ready, onDone }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // The link's sign-in turned out not to be valid after all (used, expired).
  const [expired, setExpired] = useState(false);

  // Leave the half-finished reset behind (recovery mode and any dead session)
  // so the "forgot password" page can actually be reached.
  async function startOver() {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    onDone?.();
    navigate('/forgot');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Please choose a password of at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords are not the same. Please type them again.'); return; }
    setBusy(true);
    // The form can show before the link's sign-in has finished (or after it
    // failed); check there really is one, rather than failing on save.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setBusy(false); setExpired(true); return; }
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      console.warn('Password reset failed:', err.code, err.status, err.message);
      const r = describeResetError(err);
      if (r.kind === 'expired') { setExpired(true); return; }
      setError(r.message);
      return;
    }
    setDone(true);
    onDone?.();
  }

  return (
    <div className="mkt ob">
      <div className="ob__top">
        <span style={{ width: 70 }} />
        <div className="mkt-brand" style={{ fontSize: 20 }}><span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay</div>
        <span style={{ width: 70 }} />
      </div>
      <div className="ob__body">
        <div className="ob__card">
          {done ? (
            <>
              <div className="ob__art" aria-hidden="true" style={{ marginBottom: 8 }}><Icon name="check" size={44} /></div>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>Your new password is saved</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>You're signed in. Use this password next time.</p>
              <div className="ob__actions">
                <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block" onClick={() => navigate('/')}>Go to MyDay</button>
              </div>
            </>
          ) : !ready || expired ? (
            <>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>This link isn't active</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>
                Password links stop working after an hour, and after they've been used once. Ask for a fresh one and
                open it as soon as it arrives.
              </p>
              <div className="ob__actions">
                <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block" onClick={startOver}>Send me a new link</button>
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>Choose a new password</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 20 }}>
                Pick something you'll remember — at least 8 characters, with letters and a number.
              </p>
              {error && <div className="ob__err">{error}</div>}
              <div className="ob-field">
                <label>New password</label>
                <div className="ob-passwrap">
                  <input className="ob-input" type={show ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
                  <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}><Icon name="eye" size={22} /></button>
                </div>
              </div>
              <div className="ob-field">
                <label>Type it once more</label>
                <input className="ob-input" type={show ? 'text' : 'password'} value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} placeholder="The same password again" autoComplete="new-password" />
              </div>
              <div className="ob__actions">
                <button type="submit" className="mkt-btn mkt-btn--primary mkt-btn--block" disabled={busy}>
                  {busy ? 'Saving...' : 'Save my new password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
