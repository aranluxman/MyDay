import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { Icon } from '../components/Icon.jsx';

const TOTAL = 4;
const AGE_CHIPS = [55, 60, 65, 70, 75, 80, 85, 90, 95];

export default function Onboarding() {
  const { signUp } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [forWhom, setForWhom] = useState('');     // 'self' | 'other'
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');             // 'male' | 'female' | 'other'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const self = forWhom === 'self';
  const subj = self ? 'you' : 'they';
  const poss = self ? 'your' : 'their';

  function next() { setError(''); setStep((s) => Math.min(TOTAL - 1, s + 1)); }
  function back() { setError(''); step === 0 ? navigate('/') : setStep((s) => s - 1); }

  async function finish() {
    setError('');
    if (!email.trim() || !password) { setError('Please enter your email and a password.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      await signUp(email, password, name, { for_whom: forWhom, age: age ? parseInt(age, 10) : null, sex });
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

          {step === 0 && (
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

          {step === 1 && (
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

          {step === 2 && (
            <>
              <h2 className="ob__q">{self ? 'Are you' : 'Are they'} male or female?</h2>
              <div className="ob-choices">
                <Choice active={sex === 'male'} onClick={() => setSex('male')} icon="user" title="Male" />
                <Choice active={sex === 'female'} onClick={() => setSex('female')} icon="user" title="Female" />
                <Choice active={sex === 'other'} onClick={() => setSex('other')} icon="user" title="Prefer not to say" />
              </div>
              <div className="ob__actions">
                <button className="mkt-btn mkt-btn--primary" disabled={!sex} onClick={next}>Continue</button>
              </div>
            </>
          )}

          {step === 3 && (
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
                  <input className="ob-input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
                  <button type="button" className="eye" onClick={() => setShow(!show)} aria-label="Show password"><Icon name="eye" size={22} /></button>
                </div>
              </div>
              <div className="ob__actions">
                <button className="mkt-btn mkt-btn--primary mkt-btn--block" disabled={busy} onClick={finish}>
                  {busy ? 'Creating your account...' : 'Create account'}
                </button>
              </div>
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
