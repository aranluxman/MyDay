import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { Button, Field, Input } from '../components/ui.jsx';

export default function Auth() {
  const { signIn, signUp } = useApp();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
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
    try {
      if (mode === 'signup') await signUp(email, password, name);
      else await signIn(email, password);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__hero">
        <div className="auth__mark"><Icon name="check" size={40} stroke={3} /></div>
        <h1>MyDay</h1>
        <p>Your medicines, appointments, health notes, and a sharper mind — all in one calm place.</p>
      </div>

      <form className="auth__card" onSubmit={submit}>
        <div className="auth__tabs">
          <button type="button" className={mode === 'signin' ? 'is-active' : ''} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>
          <button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Create account</button>
        </div>

        {mode === 'signup' && (
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Carter" autoComplete="name" maxLength={60} />
          </Field>
        )}
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </Field>
        <Field label="Password">
          <div className="input-wrap">
            <Input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            <button type="button" className="input-wrap__btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              <Icon name="eye" size={22} />
            </button>
          </div>
        </Field>

        {error && <div className="auth__error">{error}</div>}

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'signup' ? 'Create my account' : 'Sign in'}
        </Button>

        <p className="auth__switch">
          {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
          <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  );
}
