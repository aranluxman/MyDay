// Shared UI: design-system primitives, simple inline icons, in-app
// toast/confirm/prompt (so we never use jarring browser dialogs), a tiny
// hash router, and a small data-loading hook.
import {
  html, useState, useEffect, useRef, useCallback, useContext, createContext, Fragment,
} from './react.js';

// ---------------------------------------------------------------- icons
// Calm, stroke-based line icons (no emoji). size scales with font.
const ICONS = {
  check: 'M5 13l4 4L19 7',
  back: 'M15 19l-7-7 7-7',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L18 10l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pill: 'M10.5 13.5l3-3M7 17a4 4 0 010-6l4-4a4 4 0 116 6l-4 4a4 4 0 01-6 0z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-1 5 3 3 0 002 4 3 3 0 005 1 3 3 0 005-1 3 3 0 002-4 3 3 0 00-1-5 3 3 0 00-3-3 3 3 0 00-3-1 3 3 0 00-2 1zM12 4v15',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 21a2 2 0 004 0',
  chevron: 'M9 6l6 6-6 6',
};
export function Icon({ name, size = 24, stroke = 2.2, className = '' }) {
  return html`<svg class=${className} width=${size} height=${size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width=${stroke}
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d=${ICONS[name] || ''} /></svg>`;
}

// ---------------------------------------------------------------- primitives
export function Button({ children, onClick, variant = 'primary', size = 'md', icon, disabled, type = 'button', full = true, ...rest }) {
  const cls = `btn btn--${variant} btn--${size}` + (full ? ' btn--full' : '');
  return html`<button type=${type} class=${cls} disabled=${disabled} onClick=${onClick} ...${rest}>
    ${icon ? html`<${Icon} name=${icon} size=${size === 'lg' ? 28 : 22} />` : null}
    <span>${children}</span>
  </button>`;
}

export function Card({ children, accent, className = '', ...rest }) {
  return html`<div class=${`card ${accent ? 'card--' + accent : ''} ${className}`} ...${rest}>${children}</div>`;
}

export function Pill({ children, kind }) {
  return html`<span class=${`pill pill--${kind}`}>${children}</span>`;
}

export function Spinner({ label = 'Loading...' }) {
  return html`<div class="loading"><div class="spinner" aria-hidden="true"></div><p>${label}</p></div>`;
}

export function Field({ label, children, hint }) {
  return html`<label class="field">
    <span class="field__label">${label}</span>
    ${children}
    ${hint ? html`<span class="field__hint">${hint}</span>` : null}
  </label>`;
}

export function EmptyState({ children }) {
  return html`<p class="empty">${children}</p>`;
}

// ---------------------------------------------------------------- modal / bottom sheet
export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return html`<div class="sheet-overlay" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title || 'Dialog'}>
      ${title ? html`<div class="sheet__title">${title}</div>` : null}
      <div class="sheet__body">${children}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- UI context: toast / confirm / prompt
const UIContext = createContext(null);
export const useUI = () => useContext(UIContext);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const idRef = useRef(0);

  const toast = useCallback((message, kind = 'good') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ kind: 'confirm', confirmLabel: 'Yes', cancelLabel: 'Cancel', ...opts, resolve });
  }), []);

  const prompt = useCallback((opts) => new Promise((resolve) => {
    setDialog({ kind: 'prompt', value: opts.defaultValue || '', confirmLabel: 'Save', cancelLabel: 'Cancel', ...opts, resolve });
  }), []);

  const closeDialog = (result) => { dialog?.resolve(result); setDialog(null); };

  return html`<${UIContext.Provider} value=${{ toast, confirm, prompt }}>
    ${children}
    <div class="toast-stack" aria-live="polite">
      ${toasts.map((t) => html`<div key=${t.id} class=${`toast toast--${t.kind}`}>
        ${t.kind === 'good' ? html`<${Icon} name="check" size=${22} />` : null}
        <span>${t.message}</span>
      </div>`)}
    </div>
    ${dialog ? html`<${DialogHost} dialog=${dialog} onClose=${closeDialog} />` : null}
  <//>`;
}

function DialogHost({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.value || '');
  const inputRef = useRef(null);
  useEffect(() => { if (dialog.kind === 'prompt') setTimeout(() => inputRef.current?.focus(), 50); }, []);
  return html`<${Modal} title=${dialog.title} onClose=${() => onClose(dialog.kind === 'prompt' ? null : false)}>
    ${dialog.message ? html`<p class="dialog__msg">${dialog.message}</p>` : null}
    ${dialog.kind === 'prompt'
      ? html`<input ref=${inputRef} class="input" value=${value} placeholder=${dialog.placeholder || ''}
          maxlength=${dialog.maxLength || 60}
          onInput=${(e) => setValue(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && onClose(value)} />`
      : null}
    <div class="btn-row" style="margin-top:18px">
      <${Button} variant="ghost" onClick=${() => onClose(dialog.kind === 'prompt' ? null : false)}>${dialog.cancelLabel}<//>
      <${Button} variant=${dialog.danger ? 'danger-solid' : 'primary'}
        onClick=${() => onClose(dialog.kind === 'prompt' ? value : true)}>${dialog.confirmLabel}<//>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- router
export function useRoute() {
  const [hash, setHash] = useState(() => location.hash || '#/home');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/home');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { hash, top: parts[0] || 'home', sub: parts[1] || null };
}
export function navigate(to) {
  if (location.hash === to) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = to;
}

// ---------------------------------------------------------------- data hook
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve(loader())
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => { console.error(error); alive && setState({ data: null, loading: false, error }); });
    return () => { alive = false; };
  }, [...deps, tick]);
  return { ...state, reload };
}

export { Fragment };
