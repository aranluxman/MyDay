import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { Modal } from './ui.jsx';
import { useLiquidSlider } from '../hooks/useLiquidDrag.js';

// Destinations. On a phone, six tabs only fit by shrinking their labels to
// about 9px — unreadable — and at the largest text size they overlapped. So a
// phone shows four tabs plus a clearly labelled "More", and the side rail on a
// large screen shows everything — including My cards and Alerts, which used
// to live only behind More, so a laptop had no way to reach them at all.
// The visible label is the accessible name.
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true, phone: true },
  { to: '/medication', icon: 'pill', label: 'Medicine', phone: true },
  { to: '/updates', icon: 'pulse', label: 'Updates', phone: true },
  { to: '/appointments', icon: 'calendar', label: 'Visits' },
  { to: '/games', icon: 'brain', label: 'Games', phone: true },
  { to: '/cards', icon: 'cross', label: 'My cards' },
  { to: '/profile/notifications', icon: 'bell', label: 'Alerts' },
  { to: '/profile', icon: 'user', label: 'Profile', end: true },
];
const MORE = [
  { to: '/appointments', icon: 'calendar', label: 'Visits', desc: 'Doctor and clinic appointments' },
  { to: '/profile', icon: 'user', label: 'Profile', desc: 'Your details and preferences' },
  { to: '/cards', icon: 'cross', label: 'My cards', desc: 'Health and insurance cards' },
  { to: '/profile/notifications', icon: 'bell', label: 'Alerts', desc: 'Reminders and notifications' },
];

export function BottomNav() {
  const ref = useRef(null);
  const lensRef = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = MORE.some((m) => pathname === m.to);

  // One glass lens that glides to the active tab — and that you can grab and
  // slide along the bar (or down the side rail) to pick a tab. Letting go
  // over an item "taps" it, so links navigate and More opens as usual.
  const [rail, setRail] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches);
  useEffect(() => {
    const q = window.matchMedia?.('(min-width: 1024px)');
    if (!q) return undefined;
    const on = (e) => setRail(e.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  useLiquidSlider({
    containerRef: ref, lensRef, itemSelector: '.bottom-nav__item', axis: rail ? 'y' : 'x',
    activeKey: `${pathname}|${rail}|${moreOpen}`,
    onCommit: (_, el) => el.click(),
  });

  return (
    <>
      <nav className="bottom-nav" aria-label="Main navigation" ref={ref}>
        <span className="bottom-nav__ind lg-lens" ref={lensRef} aria-hidden="true" />
        {ITEMS.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}
            className={({ isActive }) => `bottom-nav__item${it.phone ? '' : ' bottom-nav__item--wide'}${isActive ? ' is-active' : ''}`}>
            <span className="bottom-nav__ic" aria-hidden="true"><Icon name={it.icon} size={25} /></span>
            <span className="bottom-nav__label">{it.label}</span>
          </NavLink>
        ))}
        <button type="button" className={`bottom-nav__item bottom-nav__more${inMore ? ' is-active' : ''}`}
          aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={inMore ? 'page' : undefined}
          onClick={() => setMoreOpen(true)}>
          <span className="bottom-nav__ic" aria-hidden="true"><Icon name="dots" size={25} /></span>
          <span className="bottom-nav__label">More</span>
        </button>
      </nav>
      {moreOpen && (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          <ul className="more-list">
            {MORE.map((m) => (
              <li key={m.to}>
                <button type="button" className={`menu-row${pathname === m.to ? ' is-current' : ''}`}
                  aria-current={pathname === m.to ? 'page' : undefined}
                  onClick={() => { setMoreOpen(false); navigate(m.to); }}>
                  <span className="menu-row__ic" aria-hidden="true"><Icon name={m.icon} size={22} /></span>
                  <span className="menu-row__main">
                    <span className="menu-row__t">{m.label}</span>
                    <span className="menu-row__d" style={{ display: 'block' }}>{m.desc}</span>
                  </span>
                  <Icon name="chevron" size={22} />
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

