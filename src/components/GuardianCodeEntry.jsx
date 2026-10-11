import { useId, useRef, useState } from 'react';

// One editing surface: native selection, backspace and cursor movement work
// with keyboards, assistive technology, autofill and full-code paste.
export function GuardianCodeEntry({ error, busy = false, nameRequired = false, name = '', onSubmit }) {
  const id = useId();
  const [code, setCode] = useState('');
  const input = useRef(null);
  const sending = useRef(false);
  const submittedCode = useRef(null);
  const visibleError = code === submittedCode.current ? error : '';
  const ready = code.length === 6 && (!nameRequired || !!name.trim());
  const clean = (value) => value.replace(/\D/g, '').slice(0, 6);

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy || sending.current) return;
    sending.current = true;
    submittedCode.current = code;
    input.current?.blur();
    try { await onSubmit(code); }
    finally { sending.current = false; }
  }

  return (
    <form className="guardian-code" onSubmit={submit}>
      <label htmlFor={id}>6-digit guardian code</label>
      <input ref={input} id={id} className="input guardian-code__input" type="text"
        inputMode="numeric" autoComplete="one-time-code" enterKeyHint="go"
        value={code} disabled={busy} pattern="[0-9]{6}" maxLength={6}
        aria-invalid={!!visibleError} aria-describedby={`${id}-hint${visibleError ? ` ${id}-error` : ''}`}
        onChange={(e) => setCode(clean(e.target.value))}
        onPaste={(e) => {
          e.preventDefault();
          setCode(clean(e.clipboardData.getData('text')));
        }} />
      <p id={`${id}-hint`} className="guardian-code__hint">
        {nameRequired ? 'Enter your name and all 6 digits.' : 'Enter all 6 digits. You can paste the whole code.'}
      </p>
      {visibleError && <p id={`${id}-error`} className="ob__err" role="alert">{visibleError}</p>}
      <button type="submit" className="mkt-btn mkt-btn--primary mkt-btn--block"
        disabled={!ready || busy} aria-describedby={`${id}-hint`}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}
