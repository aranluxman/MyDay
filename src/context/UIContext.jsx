import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '../components/Icon.jsx';
import { Modal, Button } from '../components/ui.jsx';

const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const idRef = useRef(0);

  // toast(message, kind, action?) where action is { label, onAction }.
  // A destructive action should always offer Undo here rather than a
  // confirm-then-hope: the toast is the only place the person can still
  // change their mind. An actionable toast stays on screen longer, because
  // 2.8 seconds is not enough time to read it and decide.
  const toast = useCallback((message, kind = 'good', action = null) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 7000 : 2800);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ kind: 'confirm', confirmLabel: 'Yes', cancelLabel: 'Cancel', ...opts, resolve });
  }), []);

  const value = { toast, confirm, dismissToast };

  return (
    <UICtx.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            {t.kind === 'good' && <Icon name="check" size={22} />}
            <span className="toast__msg">{t.message}</span>
            {t.action && (
              <button type="button" className="toast__action"
                onClick={() => { dismissToast(t.id); t.action.onAction?.(); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {dialog && <DialogHost dialog={dialog} onClose={(r) => { dialog.resolve(r); setDialog(null); }} />}
    </UICtx.Provider>
  );
}

function DialogHost({ dialog, onClose }) {
  useEffect(() => {}, []);
  return (
    <Modal title={dialog.title} onClose={() => onClose(false)}>
      {dialog.message && <p className="dialog-msg">{dialog.message}</p>}
      <div className="btn-row" style={{ marginTop: 18 }}>
        <Button variant="ghost" onClick={() => onClose(false)}>{dialog.cancelLabel}</Button>
        <Button variant={dialog.danger ? 'danger-solid' : 'primary'} onClick={() => onClose(true)}>{dialog.confirmLabel}</Button>
      </div>
    </Modal>
  );
}
