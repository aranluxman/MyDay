import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { GoogleButton } from '../components/GoogleButton.jsx';
import { Segmented } from '../components/Segmented.jsx';

export default function SignIn() {
  const { signIn } = useApp();
  const navigate = useNavigate();
  // A family caregiver usually arrives holding a guardian code, not a
  // password, so their way in is offered first instead of under the form.
  const [who, setWho] = useState('me');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState({ email: false, password: false });

  async function submit(e) {
    e.preventDefault();
    setError('');
    const m = { email: !email.trim(), password: !password };
    setMissing(m);
    if (m.email || m.password) { setError('Please enter your email and password.'); return; }
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
        <div className="ob__card">
          <Segmented label="How are you signing in?" value={who} onChange={setWho} className="mkt-seg--block"
            options={[{ value: 'me', label: 'I use MyDay' }, { value: 'family', label: "I'm a family caregiver" }]} />

          {who === 'family' ? (
            <>
              <h1 className="ob__q" style={{ marginBottom: 6 }}>Helping a family member?</h1>
              <p className="ob__lead">Your family member's phone shows a 6-digit guardian code. Enter it to see their medicines and get their missed-dose alerts.</p>
              <div className="ob-choices">
                <button type="button" className="ob-choice" onClick={() => navigate('/guardian')}>
                  <span className="ic ic--blue"><Icon name="bell" size={22} /></span>
                  <span>Enter a guardian code<small>Connect to a family member in a minute.</small></span>
                  <span className="ob-choice__r"><Icon name="chevron" size={20} /></span>
                </button>
                <button type="button" className="ob-choice" onClick={() => setWho('me')}>
                  <span className="ic ic--blue"><Icon name="user" size={22} /></span>
                  <span>Sign in to my account<small>Already connected with your own MyDay account.</small></span>
                  <span className="ob-choice__r"><Icon name="chevron" size={20} /></span>
                </button>
              </div>
              <p className="ob__switch">Don't have a code yet? <button type="button" onClick={() => navigate('/get-started?for=other')}>See how to set it up</button></p>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1 className="ob__q" style={{ marginBottom: 6 }}>Welcome back</h1>
              <p className="ob__lead">Sign in to your MyDay account.</p>
              {error && <div className="ob__err" role="alert">{error}</div>}
              <div className="ob-field">
                <label htmlFor="signin-email">Email</label>
                <input id="signin-email" className="ob-input" type="email" value={email}
                  onChange={(e) => { setEmail(e.target.value); setMissing((m) => ({ ...m, email: false })); }}
                  placeholder="you@example.com" autoComplete="email" aria-invalid={missing.email || undefined} />
              </div>
              <div className="ob-field">
                <label htmlFor="signin-password">Password</label>
                <div className="ob-passwrap">
                  <input id="signin-password" className="ob-input" type={show ? 'text' : 'password'} value={password}
                    onChange={(e) => { setPassword(e.target.value); setMissing((m) => ({ ...m, password: false })); }}
                    placeholder="Your password" autoComplete="current-password" aria-invalid={missing.password || undefined} />
                  <button type="button" className="eye" onClick={() => setShow(!show)}
                    aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}><Icon name="eye" size={22} /></button>
                </div>
              </div>
              <div className="ob__actions">
                <button type="submit" className="mkt-btn mkt-btn--primary mkt-btn--block" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
              </div>
              <GoogleButton onError={setError} />
              <p className="ob__switch" style={{ marginBottom: 4 }}>
                <button type="button" onClick={() => navigate('/forgot')}>I forgot my password</button>
              </p>
              <p className="ob__switch">New to MyDay? <button type="button" onClick={() => navigate('/get-started')}>Create an account</button></p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
