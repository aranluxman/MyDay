import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { Icon } from '../components/Icon.jsx';

export default function SignIn() {
  const { signIn } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Please enter your email and password.'); return; }
    setBusy(true);
    try { await signIn(email, password); }
    catch (err) { setError(err.message || 'Could not sign in.'); setBusy(false); }
  }

  return (
    <div className="mkt ob">
      <div className="ob__top">
        <button className="mkt-btn mkt-btn--link" onClick={() => navigate('/')}><Icon name="back" size={20} /> Back</button>
        <div className="mkt-brand" style={{ fontSize: 20 }}><span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay</div>
        <span style={{ width: 70 }} />
      </div>
      <div className="ob__body">
        <form className="ob__card" onSubmit={submit}>
          <h2 className="ob__q" style={{ marginBottom: 6 }}>Welcome back</h2>
          <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 20 }}>Sign in to your MyDay account.</p>
          {error && <div className="ob__err">{error}</div>}
          <div className="ob-field">
            <label>Email</label>
            <input className="ob-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>
          <div className="ob-field">
            <label>Password</label>
            <div className="ob-passwrap">
              <input className="ob-input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
              <button type="button" className="eye" onClick={() => setShow(!show)} aria-label="Show password"><Icon name="eye" size={22} /></button>
            </div>
          </div>
          <div className="ob__actions">
            <button type="submit" className="mkt-btn mkt-btn--primary mkt-btn--block" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
          </div>
          <p className="ob__switch">New to MyDay? <button type="button" onClick={() => navigate('/get-started')}>Create an account</button></p>
        </form>
      </div>
    </div>
  );
}
