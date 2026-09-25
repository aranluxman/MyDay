import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon.jsx';

const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

// How long the leave animation runs before an element is actually removed.
// Kept in step with the CSS (.toast.is-leaving, .alert.is-leaving).
const LEAVE_MS = 240;

const TOAST_ICON = { good: 'check', bad: 'alert', info: 'info' };

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const idRef = useRef(0);

  // Two-step removal: mark it leaving so it can slide away, then drop it.
  const dismissToast = useCallback((id) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), LEAVE_MS);
  }, []);

  // toast(message, kind, action?) where action is { label, onAction }.
  // A destructive action should always offer Undo here rather than a
  // confirm-then-hope: the toast is the only place the person can still
  // change their mind. An actionable toast stays on screen longer, because
  // 2.8 seconds is not enough time to read it and decide.
  const toast = useCallback((message, kind = 'good', action = null) => {
    const id = ++idRef.current;
    // Newest on top, and never more than three banners stacked at once.
    setToasts((t) => [{ id, message, kind, action }, ...t].slice(0, 3));
    setTimeout(() => dismissToast(id), action ? 7000 : kind === 'bad' ? 4200 : 2800);
  }, [dismissToast]);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ kind: 'confirm', confirmLabel: 'Yes', cancelLabel: 'Cancel', ...opts, resolve, id: ++idRef.current });
  }), []);

  const value = { toast, confirm, dismissToast };

  return (
    <UICtx.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} t={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
      {dialog && <AlertHost key={dialog.id} dialog={dialog} onClose={(r) => { dialog.resolve(r); setDialog(null); }} />}
    </UICtx.Provider>
  );
}

// A banner that drops in from the top. Tap it or flick it upward to dismiss.
function Toast({ t, onDismiss }) {
  const start = useRef(null);
  const [dy, setDy] = useState(0);

  function down(e) { start.current = e.clientY; }
  function move(e) {
    if (start.current == null) return;
    setDy(Math.min(0, e.clientY - start.current));
  }
  function up() {
    if (start.current == null) return;
    start.current = null;
    if (dy < -24) onDismiss();
    setDy(0);
  }

  return (
    <div
      className={`toast toast--${t.kind}${t.leaving ? ' is-leaving' : ''}`}
      style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onClick={(e) => { if (!e.target.closest('.toast__action')) onDismiss(); }}
    >
      <span className="toast__ic"><Icon name={TOAST_ICON[t.kind] || 'info'} size={18} stroke={2.6} /></span>
      <span className="toast__msg">{t.message}</span>
      {t.action && (
        <button type="button" className="toast__action"
          onClick={() => { onDismiss(); t.action.onAction?.(); }}>
          {t.action.label}
        </button>
      )}
    </div>
  );
}

// An iOS-style centred alert: title, message, and a row of two buttons split
// by a hairline. A destructive confirm is red and the safe choice gets focus,
// so a stray Enter never deletes anything.
function AlertHost({ dialog, onClose }) {
  const [leaving, setLeaving] = useState(false);
  const safeRef = useRef(null);
  const okRef = useRef(null);
  // The provider hands a fresh onClose on every render (a toast appearing is
  // enough), so read it through a ref rather than re-running the focus effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedRef = useRef(false);

  const close = useCallback((result) => {
    if (closedRef.current) return;
    closedRef.current = true;
    setLeaving(true);
    setTimeout(() => onCloseRef.current(result), LEAVE_MS - 60);
  }, []);

  useEffect(() => {
    (dialog.danger ? safeRef : okRef).current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [dialog, close]);

  return createPortal(
    <div className={`alert-overlay${leaving ? ' is-leaving' : ''}`}
      onClick={(e) => e.target === e.currentTarget && close(false)}>
      <div className={`alert${leaving ? ' is-leaving' : ''}`} role="alertdialog" aria-modal="true"
        aria-labelledby="alert-title" aria-describedby={dialog.message ? 'alert-msg' : undefined}>
        <div className="alert__body">
          {dialog.danger && <span className="alert__ic"><Icon name="alert" size={24} /></span>}
          <h2 id="alert-title" className="alert__title">{dialog.title}</h2>
          {dialog.message && <p id="alert-msg" className="alert__msg">{dialog.message}</p>}
        </div>
        <div className="alert__actions">
          <button ref={safeRef} type="button" className="alert__btn" onClick={() => close(false)}>
            {dialog.cancelLabel}
          </button>
          <button ref={okRef} type="button"
            className={`alert__btn alert__btn--ok${dialog.danger ? ' alert__btn--danger' : ''}`}
            onClick={() => close(true)}>
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
