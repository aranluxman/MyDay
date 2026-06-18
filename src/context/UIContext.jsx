import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '../components/Icon.jsx';
import { Modal, Button } from '../components/ui.jsx';

const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

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

  const value = { toast, confirm };

  return (
    <UICtx.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            {t.kind === 'good' && <Icon name="check" size={22} />}
            <span>{t.message}</span>
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
