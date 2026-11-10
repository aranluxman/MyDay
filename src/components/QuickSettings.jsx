import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { Avatar } from './ui.jsx';
import { useDialog } from '../hooks/useDialog.js';
import { useApp } from '../context/AppContext.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { TEXT_SIZES } from '../lib/appearance.js';
import { deliveryStatus } from '../lib/notifications.js';
import { pushSupported } from '../lib/push.js';
import { platformTag } from '../lib/guardian.js';
import { listAccountGuardians } from '../lib/guardianAccount.js';

// What this device can say about phone alerts, in a few honest words. It never
// says alerts "work": only a test alert that the person sees can show that,
// and that check lives in Alerts & reminders.
export function alertSummary({ supported, permission, installed, platform, subscribed }) {
  const s = deliveryStatus({ supported, permission, installed, platform });
  if (s.code === 'unsupported') return { tone: 'warn', label: 'Not supported here', action: 'See why' };
  if (s.code === 'blocked') return { tone: 'warn', label: 'Blocked on this device', action: 'Fix it' };
  if (!s.ok) return { tone: 'warn', label: 'Setup needed', action: 'Set up' };
  if (subscribed === false) return { tone: 'warn', label: 'Setup needed', action: 'Set up' };
  if (subscribed == null) return { tone: 'info', label: 'Checking this device…', action: 'Open' };
  return { tone: 'ok', label: 'Allowed on this device', action: 'Check' };
}

// Is this browser signed up with the push service? null while unknown.
function useSubscribed() {
  const [subscribed, setSubscribed] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!pushSupported()) { if (live) setSubscribed(false); return; }
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (live) setSubscribed(!!sub);
      } catch { if (live) setSubscribed(false); }
    })();
    return () => { live = false; };
  }, []);
  return subscribed;
}

// Quick settings: a panel that drops from the top Settings button. The things
// people change most (text size), the one status they must not be wrong about
// (phone alerts), and the way into everything else. No health details here.
export function QuickSettings({ onClose }) {
  const ref = useRef(null);
  const navigate = useNavigate();
  const { profile, textSize, setTextSize } = useApp();
  const { installed } = useInstallPrompt();
  const subscribed = useSubscribed();
  const [watching, setWatching] = useState([]);
  useDialog(ref, { onEscape: onClose });
  useEffect(() => { listAccountGuardians().then((w) => setWatching(w || [])).catch(() => {}); }, []);

  const go = (to, state) => { onClose(); navigate(to, state ? { state } : undefined); };
  const sizeIdx = Math.max(0, TEXT_SIZES.findIndex((t) => t.id === textSize));
  const alerts = alertSummary({
    supported: pushSupported(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    installed, platform: platformTag(), subscribed,
  });
  const firstName = (profile?.full_name || 'You').split(' ')[0];

  return createPortal(
    <div className="qs-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="qs" role="dialog" aria-modal="true" aria-labelledby="qs-title">
        <div className="qs__head">
          <h2 className="qs__title" id="qs-title">Quick settings</h2>
          <button type="button" className="qs__close" aria-label="Close quick settings" onClick={onClose}>
            <Icon name="close" size={22} stroke={2.4} />
          </button>
        </div>

        <div className="qs__who">
          <Avatar name={profile?.full_name} color={profile?.avatar_color} size={44} src={profile?.avatar_url} />
          <span className="qs__who-main">
            <span className="qs__who-name" translate="no">{firstName}</span>
            <span className="qs__who-role">My profile</span>
          </span>
        </div>

        <div className="qs__group" role="group" aria-labelledby="qs-text">
          <h3 className="qs__label" id="qs-text">Text size</h3>
          <div className="qs__size">
            <button type="button" className="qs__size-btn" disabled={sizeIdx === 0}
              aria-label="Smaller text" onClick={() => setTextSize(TEXT_SIZES[sizeIdx - 1].id)}>A−</button>
            <span className="qs__size-now" role="status">{TEXT_SIZES[sizeIdx].name}</span>
            <button type="button" className="qs__size-btn qs__size-btn--up" disabled={sizeIdx === TEXT_SIZES.length - 1}
              aria-label="Larger text" onClick={() => setTextSize(TEXT_SIZES[sizeIdx + 1].id)}>A+</button>
          </div>
        </div>

        <div className="qs__alerts">
          <span className="qs__ic" aria-hidden="true"><Icon name="bell" size={24} /></span>
          <span className="qs__alerts-main">
            <span className="qs__alerts-t">Phone alerts</span>
            <span className={`qs__status qs__status--${alerts.tone}`}>
              <Icon name={alerts.tone === 'ok' ? 'check' : alerts.tone === 'warn' ? 'alert' : 'clock'} size={16} stroke={2.6} /> {alerts.label}
            </span>
          </span>
          <button type="button" className="qs__setup" aria-label={`${alerts.action}: phone alerts, ${alerts.label}`}
            onClick={() => go('/profile', { open: 'alerts' })}>{alerts.action}</button>
        </div>

        <ul className="qs__links">
          <li>
            <button type="button" className="qs__link" onClick={() => go('/profile', { editProfile: true })}>
              <Icon name="user" size={24} /> <span>Edit profile</span> <Icon name="chevron" size={20} />
            </button>
          </li>
          {watching.length > 0 && (
            <li>
              <button type="button" className="qs__link" onClick={() => go('/guardian')}>
                <Icon name="users" size={24} /> <span>Caregiver dashboard</span> <Icon name="chevron" size={20} />
              </button>
            </li>
          )}
        </ul>

        <button type="button" className="qs__all" onClick={() => go('/profile')}>
          <Icon name="gear" size={22} /> All settings
        </button>
      </div>
    </div>,
    document.body,
  );
}
