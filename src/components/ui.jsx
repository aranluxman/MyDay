import { useState, useCallback, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { useDialog } from '../hooks/useDialog.js';

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

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon"><Icon name={icon} size={34} /></div>}
      {title && <div className="empty__title">{title}</div>}
      {children && <p>{children}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

// Big friendly empty state in a card: illustration circle, title, text, action.
export function HeroEmpty({ icon, title, children, action }) {
  return (
    <div className="card hero-empty">
      <div className="hero-empty__art"><Icon name={icon} size={52} stroke={1.8} /></div>
      <h3 className="hero-empty__title">{title}</h3>
      {children && <p className="hero-empty__text">{children}</p>}
      {action}
    </div>
  );
}

// Soft callout with a lightbulb-style icon ("Quick tip").
export function TipCard({ title = 'Quick tip', children }) {
  return (
    <div className="tip-card">
      <span className="tip-card__ic"><Icon name="sparkle" size={22} /></span>
      <div>
        <div className="tip-card__t">{title}</div>
        <p className="tip-card__d">{children}</p>
      </div>
    </div>
  );
}

// ---- Skeleton loaders (content placeholders shown instead of a blocking spinner) ----
export function Skeleton({ h = 16, w = '100%', r = 8, style }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r, ...style }} aria-hidden="true" />;
}
export function SkeletonCard({ lines = 2 }) {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <Skeleton h={22} w="55%" />
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} h={14} w={i % 2 ? '70%' : '90%'} style={{ marginTop: 12 }} />)}
    </div>
  );
}
// Generic page placeholder used by the lazy-route Suspense fallback.
export function PageSkeleton() {
  return (
    <div className="stack" role="status" aria-label="Loading">
      <Skeleton h={28} w="40%" />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function Field({ label, children, hint, error, id }) {
  const auto = useId();
  const hintId = hint ? `${id || auto}-hint` : undefined;
  const errId = error ? `${id || auto}-err` : undefined;
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      {children}
      {hint && <span className="field__hint" id={hintId}>{hint}</span>}
      {error && <span className="field__err" id={errId}>{error}</span>}
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

// Large on/off switch with an On/Off word inside, so state is readable
// without relying on colour alone.
// The visible track sits inside a 48px-tall button, so the target is
// comfortable without needing the "Bigger buttons" preference.
export function Toggle({ checked, onChange, label, labelledBy, describedBy, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked}
      aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} aria-describedby={describedBy}
      disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch__track" aria-hidden="true">
        <span className="switch__label">{checked ? 'On' : 'Off'}</span>
      </span>
    </button>
  );
}

// iOS-style segmented control.
//
// Two roles, because the same look was doing two different jobs:
//   * kind="radio" (default): picks a value (text size, alert timing). A
//     radiogroup with arrow keys.
//   * kind="tabs": switches between panels (Today / History / Medicines).
//     Proper tabs: ids, aria-controls, roving tabindex, Arrow/Home/End.
// Options wrap onto a second row at large text sizes instead of overflowing.
export function SegmentedControl({ options, value, onChange, kind = 'radio', label, idBase }) {
  const autoId = useId();
  const base = idBase || `seg${autoId.replace(/:/g, '')}`;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const tabs = kind === 'tabs';
  const refs = useRef([]);

  function onKeyDown(e) {
    const n = options.length;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next == null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="segmented" role={tabs ? 'tablist' : 'radiogroup'} aria-label={label}
      style={{ '--seg-n': options.length, '--seg-i': idx }} onKeyDown={onKeyDown}>
      <span className="segmented__thumb" aria-hidden="true" />
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" ref={(el) => { refs.current[i] = el; }}
            role={tabs ? 'tab' : 'radio'}
            id={tabs ? `${base}-tab-${o.value}` : undefined}
            aria-controls={tabs ? `${base}-panel-${o.value}` : undefined}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            tabIndex={on ? 0 : -1}
            className={`segmented__item${on ? ' is-active' : ''}`}
            onClick={() => onChange(o.value)}>{o.label}</button>
        );
      })}
    </div>
  );
}

/** The panel a kind="tabs" SegmentedControl controls. */
export function TabPanel({ idBase, value, children }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${value}`} aria-labelledby={`${idBase}-tab-${value}`} tabIndex={-1} className="tabpanel">
      {children}
    </div>
  );
}

// Bottom-sheet modal. Closing from inside the sheet (Escape, the X, a tap on
// the backdrop) plays the slide-down first; a parent that simply unmounts it
// after a save still closes instantly, which is what you want after an action.
//
// Focus handling (entry, Tab trap, inert background, Escape, restore) comes
// from useDialog, shared with every other dialog. The body scrolls inside the
// sheet; a `footer` stays pinned below it so the main action is always
// reachable, even with the on-screen keyboard up.
export function Modal({ title, children, onClose, wide, footer }) {
  const [leaving, setLeaving] = useState(false);
  const ref = useRef(null);
  const titleId = useId();
  const close = useCallback(() => {
    if (!onClose) return;
    setLeaving(true);
    setTimeout(() => onClose(), 220);
  }, [onClose]);
  useDialog(ref, { onEscape: onClose ? close : undefined });

  return createPortal(
    <div className={`sheet-overlay${leaving ? ' is-leaving' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className={`sheet${wide ? ' sheet--wide' : ''}${footer ? ' sheet--footed' : ''}${leaving ? ' is-leaving' : ''}`}
        role="dialog" aria-modal="true" {...(title ? { 'aria-labelledby': titleId } : { 'aria-label': 'Dialog' })}>
        <div className="sheet__grab" aria-hidden="true" />
        {title && (
          <div className="sheet__head">
            <h2 className="sheet__title" id={titleId}>{title}</h2>
            <button type="button" className="icon-btn sheet__close" aria-label={`Close ${title}`} onClick={close}><Icon name="close" size={18} stroke={2.6} /></button>
          </div>
        )}
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// A section that folds down to one line once it is set up. The summary says
// what is chosen ("Light theme · Large text") so it is useful folded, and the
// whole header is one big button. Open/closed is remembered per section.
export function Collapsible({ id, icon, title, summary, children, defaultOpen = true, forceOpen, onToggle }) {
  const key = `myday_section_${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? defaultOpen : v === '1';
    } catch { return defaultOpen; }
  });
  const isOpen = forceOpen ?? open;
  const bodyId = useId();
  function toggle() {
    const next = !isOpen;
    setOpen(next);
    try { localStorage.setItem(key, next ? '1' : '0'); } catch {}
    onToggle?.(next);
  }
  return (
    <section className={`card fold${isOpen ? ' is-open' : ''}`} aria-labelledby={`${bodyId}-h`}>
      <h2 className="fold__h" id={`${bodyId}-h`}>
        <button type="button" className="fold__btn" aria-expanded={isOpen} aria-controls={bodyId} onClick={toggle}>
          {icon && <span className="fold__ic" aria-hidden="true"><Icon name={icon} size={22} /></span>}
          <span className="fold__main">
            <span className="fold__t">{title}</span>
            {!isOpen && summary && <span className="fold__s">{summary}</span>}
          </span>
          <Icon name="chevron" size={22} className="fold__chev" />
        </button>
      </h2>
      <div id={bodyId} className="fold__body" hidden={!isOpen}>{isOpen && children}</div>
    </section>
  );
}
