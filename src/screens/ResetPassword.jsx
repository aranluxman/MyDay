import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { supabase } from '../lib/supabase.js';

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

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Please choose a password of at least 6 characters.'); return; }
    if (password !== confirm) { setError('The two passwords are not the same. Please type them again.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(/same/i.test(err.message || '')
        ? 'That is the password you already had. Please choose a different one.'
        : 'We could not change the password. Your link may have expired — ask for a new one.');
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
          ) : !ready ? (
            <>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>This link isn't active</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>
                Password links stop working after an hour, and after they've been used once. Ask for a fresh one and
                open it as soon as it arrives.
              </p>
              <div className="ob__actions">
                <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block" onClick={() => navigate('/forgot')}>Send me a new link</button>
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <h2 className="ob__q" style={{ marginBottom: 6 }}>Choose a new password</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 20 }}>
                Pick something you'll remember — at least 6 characters.
              </p>
              {error && <div className="ob__err">{error}</div>}
              <div className="ob-field">
                <label>New password</label>
                <div className="ob-passwrap">
                  <input className="ob-input" type={show ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" autoFocus />
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
