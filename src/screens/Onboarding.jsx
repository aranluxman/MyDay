import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { GoogleButton } from '../components/GoogleButton.jsx';

// Helpers can join with a code and also create their own account. One account
// can track its own medicines and watch the people who invited it.
const STEPS_SELF = ['who', 'age', 'account'];
const STEPS_HELPER = ['who', 'help', 'age', 'account'];
const AGE_CHIPS = [55, 60, 65, 70, 75, 80, 85, 90, 95];

export default function Onboarding() {
  const { signUp } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [forWhom, setForWhom] = useState('');     // 'self' | 'other'
  const [age, setAge] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const self = forWhom === 'self';
  const steps = forWhom === 'other' ? STEPS_HELPER : STEPS_SELF;
  const TOTAL = steps.length;
  const stepId = steps[step];
  const subj = self ? 'you' : 'they';
  const poss = self ? 'your' : 'their';

  function next() { setError(''); setStep((s) => Math.min(TOTAL - 1, s + 1)); }
  function back() { setError(''); step === 0 ? navigate('/') : setStep((s) => s - 1); }

  async function finish() {
    setError('');
    if (!email.trim() || !password) { setError('Please enter your email and a password.'); return; }
    if (password.length < 8) { setError('Please choose a password of at least 8 characters.'); return; }
    if (!/[0-9]/.test(password) || !/[a-zA-Z]/.test(password)) { setError('Please use letters and at least one number in your password.'); return; }
    setBusy(true);
    try {
      await signUp(email, password, name, { for_whom: forWhom, age: age ? parseInt(age, 10) : null });
      // success -> AppContext sets the user and the app loads automatically
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mkt ob">
      <div className="ob__bar"><i style={{ width: `${((step + 1) / TOTAL) * 100}%` }} /></div>
      <div className="ob__top">
        <button className="mkt-btn mkt-btn--link" onClick={back}><Icon name="back" size={20} /> Back</button>
        <div className="mkt-brand" style={{ fontSize: 20 }}><span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay</div>
        <span style={{ width: 70 }} />
      </div>

      <div className="ob__body">
        <div className="ob__card" key={step}>
          <div className="ob__step">Step {step + 1} of {TOTAL}</div>

          {stepId === 'who' && (
            <>
              <h2 className="ob__q">Who is MyDay for?</h2>
              <div className="ob-choices">
                <Choice active={forWhom === 'self'} onClick={() => { setForWhom('self'); }} icon="user" title="It's for me" sub="I want to manage my own health." />
                <Choice active={forWhom === 'other'} onClick={() => { setForWhom('other'); }} icon="pulse" title="I'm helping someone" sub="I care for a parent, partner, or loved one." />
              </div>
              <div className="ob__actions">
                <button className="mkt-btn mkt-btn--primary" disabled={!forWhom} onClick={next}>Continue</button>
              </div>
            </>
          )}

          {stepId === 'help' && (
            <>
              <h2 className="ob__q">How to help them</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: -14, marginBottom: 14 }}>
                As their guardian, your phone shows whether they took their medicines and alerts you if one is missed.
              </p>
              <ol className="ob-helpsteps">
                <li><b>On their phone,</b> open <b>myday-1rn.pages.dev</b> and create their account (or sign in).</li>
                <li>In their MyDay, tap <b>Profile</b>, then <b>Invite a guardian</b>, and type your name.</li>
                <li>Their phone shows a <b>6-digit code</b>. It works for 15 minutes.</li>
                <li><b>On your phone,</b> type that code. You can join as a guest or create your own MyDay account and keep the connection there.</li>
              </ol>
              <div className="ob__actions">
                <button className="mkt-btn mkt-btn--primary mkt-btn--block" style={{ whiteSpace: 'normal', height: 'auto', minHeight: 54 }} onClick={() => navigate('/guardian')}>
                  I have a code — enter it
                </button>
              </div>
              <p className="ob__switch">
                <button type="button" onClick={() => { setForWhom('self'); setStep(1); }}>Create my own account too</button>
              </p>
            </>
          )}

          {stepId === 'age' && (
            <>
              <h2 className="ob__q">How old {self ? 'are you' : 'are they'}?</h2>
              <div className="ob-field">
                <label>Age</label>
                <input className="ob-input" type="number" min="1" max="120" inputMode="numeric"
                  value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 72" />
                <div className="ob-ages">
                  {AGE_CHIPS.map((a) => (
                    <button key={a} className={`ob-age${String(a) === String(age) ? ' is-active' : ''}`} onClick={() => setAge(String(a))}>{a}</button>
                  ))}
                </div>
              </div>
              <div className="ob__actions">
                <button className="mkt-btn mkt-btn--primary" disabled={!age} onClick={next}>Continue</button>
              </div>
            </>
          )}

          {stepId === 'account' && (
            <>
              <h2 className="ob__q">Create {self ? 'your' : 'the'} account</h2>
              <p style={{ color: 'var(--m-soft)', marginTop: -14, marginBottom: 18 }}>Almost done — this is how {subj} will sign in.</p>
              {error && <div className="ob__err">{error}</div>}
              <div className="ob-field">
                <label>{self ? 'Your name' : `${poss[0].toUpperCase() + poss.slice(1)} name`}</label>
                <input className="ob-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eleanor Carter" maxLength={60} autoComplete="name" />
              </div>
              <div className="ob-field">
                <label>Email</label>
                <input className="ob-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
              </div>
              <div className="ob-field">
                <label>Password</label>
                <div className="ob-passwrap">
                  <input className="ob-input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters, with a number" autoComplete="new-password" />
                  <button type="button" className="eye" onClick={() => setShow(!show)} aria-label="Show password"><Icon name="eye" size={22} /></button>
                </div>
              </div>
              <div className="ob__actions">
                <button className="mkt-btn mkt-btn--primary mkt-btn--block" disabled={busy} onClick={finish}>
                  {busy ? 'Creating your account...' : 'Create account'}
                </button>
              </div>
              {self && <GoogleButton label="Sign up with Google" onError={setError} />}
            </>
          )}

          <p className="ob__switch">Already have an account? <button onClick={() => navigate('/signin')}>Sign in</button></p>
        </div>
      </div>
    </div>
  );
}

function Choice({ active, onClick, icon, title, sub }) {
  return (
    <button className={`ob-choice${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className={`ic ${active ? 'ic--blue' : 'ic--blue'}`}><Icon name={icon} size={22} /></span>
      <span>{title}{sub && <small>{sub}</small>}</span>
      <span className="ob-choice__r">{active ? <Icon name="check" size={22} /> : <Icon name="chevron" size={20} />}</span>
    </button>
  );
}
