import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { supabase } from '../lib/supabase.js';

// "I forgot my password" — step one. Sends the recovery email and then says,
// plainly, exactly what will land in the inbox and what to do with it.
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    const address = email.trim().toLowerCase();
    if (!address || !address.includes('@')) { setError('Please type the email address you sign in with.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // Deliberately not reporting "no such account": that would let anyone check
    // whether a given person uses MyDay. The confirmation below is the same
    // either way.
    if (err && !/user not found/i.test(err.message || '')) {
      setError(/rate|too many/i.test(err.message || '')
        ? 'We have sent a few emails already. Please wait a little while and try again.'
        : 'We could not send the email just now. Please check your internet and try again.');
      return;
    }
    setSent(true);
  }

  return (
    <div className="mkt ob">
      <div className="ob__top">
        <button className="mkt-btn mkt-btn--link" onClick={() => navigate('/signin')}><Icon name="back" size={20} /> Back</button>
        <div className="mkt-brand" style={{ fontSize: 20 }}><span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay</div>
        <span style={{ width: 70 }} />
      </div>
      <div className="ob__body">
        {sent ? (
          <div className="ob__card">
            <div className="ob__art" aria-hidden="true" style={{ marginBottom: 8 }}><Icon name="mail" size={44} /></div>
            <h2 className="ob__q" style={{ marginBottom: 6 }}>Check your email</h2>
            <p style={{ color: 'var(--m-soft)', marginTop: 0 }}>
              If there's a MyDay account for <b>{email.trim().toLowerCase()}</b>, an email from MyDay is on its way.
            </p>
            <ol className="install-steps" style={{ marginTop: 8 }}>
              <li className="install-step"><span className="install-step__n">1</span><span>Open your email app.</span></li>
              <li className="install-step"><span className="install-step__n">2</span><span>Find the message from MyDay. If it isn't there, look in Junk or Spam.</span></li>
              <li className="install-step"><span className="install-step__n">3</span><span>Tap the link inside it. You'll be able to choose a new password.</span></li>
            </ol>
            <p style={{ color: 'var(--m-soft)' }}>The link works for one hour. You can close this page.</p>
            <div className="ob__actions">
              <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block" onClick={() => navigate('/signin')}>Back to sign in</button>
            </div>
          </div>
        ) : (
          <form className="ob__card" onSubmit={submit}>
            <h2 className="ob__q" style={{ marginBottom: 6 }}>Forgot your password?</h2>
            <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 20 }}>
              That's alright — it happens. Type the email address you use for MyDay and we'll send you a link to
              choose a new password.
            </p>
            {error && <div className="ob__err">{error}</div>}
            <div className="ob-field">
              <label>Email</label>
              <input className="ob-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email" autoFocus />
            </div>
            <div className="ob__actions">
              <button type="submit" className="mkt-btn mkt-btn--primary mkt-btn--block" disabled={busy}>
                {busy ? 'Sending...' : 'Send me a link'}
              </button>
            </div>
            <p className="ob__switch">Remembered it? <button type="button" onClick={() => navigate('/signin')}>Sign in</button></p>
          </form>
        )}
      </div>
    </div>
  );
}
