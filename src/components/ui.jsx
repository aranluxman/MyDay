import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

export function Button({ children, onClick, variant = 'primary', size = 'md', icon, disabled, type = 'button', full = true, className = '', ...rest }) {
  const cls = `btn btn--${variant} btn--${size}${full ? ' btn--full' : ''} ${className}`;
  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 26 : 20} />}
      {children != null && <span>{children}</span>}
    </button>
  );
}

export function Card({ children, accent, className = '', onClick, ...rest }) {
  const cls = `card${accent ? ' card--' + accent : ''}${onClick ? ' card--tap' : ''} ${className}`;
  return <div className={cls} onClick={onClick} {...rest}>{children}</div>;
}

export function Pill({ children, kind }) {
  return <span className={`pill pill--${kind}`}>{children}</span>;
}

export function Spinner({ label = 'Loading...' }) {
  return <div className="loading"><div className="spinner" aria-hidden="true" /><p>{label}</p></div>;
}

export function EmptyState({ icon, title, children }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon"><Icon name={icon} size={34} /></div>}
      {title && <div className="empty__title">{title}</div>}
      {children && <p>{children}</p>}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Input(props) { return <input className="input" {...props} />; }
export function Textarea(props) { return <textarea className="input input--area" {...props} />; }

export function Avatar({ name, color = '#2563a8', size = 44, src }) {
  const init = (name || 'M').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || 'M';
  return (
    <span className="avatar" style={{ width: size, height: size, background: src ? 'transparent' : color, fontSize: size * 0.4 }}>
      {src ? <img src={src} alt={name || 'Profile'} /> : init}
    </span>
  );
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value}
          className={`segmented__item${value === o.value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// Bottom-sheet modal.
export function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return createPortal(
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`sheet${wide ? ' sheet--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title || 'Dialog'}>
        <div className="sheet__grab" />
        {title && (
          <div className="sheet__head">
            <span className="sheet__title">{title}</span>
            <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={22} /></button>
          </div>
        )}
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
