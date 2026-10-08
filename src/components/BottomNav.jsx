import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { Modal } from './ui.jsx';

// Destinations. On a phone, six tabs only fit by shrinking their labels to
// about 9px — unreadable — and at the largest text size they overlapped. So a
// phone shows four tabs plus a clearly labelled "More", and the side rail on a
// large screen shows everything. The visible label is the accessible name.
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true, phone: true },
  { to: '/medication', icon: 'pill', label: 'Medicine', phone: true },
  { to: '/appointments', icon: 'calendar', label: 'Visits', phone: true },
  { to: '/updates', icon: 'pulse', label: 'Updates' },
  { to: '/games', icon: 'brain', label: 'Games', phone: true },
  { to: '/profile', icon: 'user', label: 'Profile' },
];
const MORE = [
  { to: '/updates', icon: 'pulse', label: 'Updates', desc: 'Your health notes' },
  { to: '/profile', icon: 'user', label: 'Profile', desc: 'Your details and preferences' },
  { to: '/cards', icon: 'cross', label: 'My cards', desc: 'Health and insurance cards' },
  { to: '/help', icon: 'info', label: 'How to use MyDay', desc: 'A step-by-step guide' },
  { to: '/profile/notifications', icon: 'bell', label: 'Alerts', desc: 'Reminders and notifications' },
];

export function BottomNav() {
  const ref = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = MORE.some((m) => pathname === m.to);

  // One highlight that glides to the active tab instead of each tab lighting
  // up separately. Measured, so it works for the bottom bar and the side rail.
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return undefined;
    const place = () => {
      const a = [...nav.querySelectorAll('.bottom-nav__item.is-active')].find((el) => el.offsetParent !== null);
      if (!a) { nav.style.setProperty('--ind-o', '0'); return; }
      nav.style.setProperty('--ind-x', `${a.offsetLeft}px`);
      nav.style.setProperty('--ind-y', `${a.offsetTop}px`);
      nav.style.setProperty('--ind-w', `${a.offsetWidth}px`);
      nav.style.setProperty('--ind-h', `${a.offsetHeight}px`);
      nav.style.setProperty('--ind-o', '1');
    };
    place();
    window.addEventListener('resize', place);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(nav);
    return () => { window.removeEventListener('resize', place); ro?.disconnect(); };
  }, [pathname]);

  return (
    <>
      <nav className="bottom-nav" aria-label="Main navigation" ref={ref}>
        <span className="bottom-nav__ind" aria-hidden="true" />
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
