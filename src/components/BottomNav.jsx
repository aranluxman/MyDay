import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { Modal } from './ui.jsx';
import { useLiquidSlider } from '../hooks/useLiquidDrag.js';

// Destinations, as in the November 2026 design. The side rail (laptop and
// tablet) lists Home, Medicines, Appointments, Contacts and Health diary, then
// Games and Settings. Phones show Home, Medicines, Appointments and Diary plus
// a labelled "More" (Contacts, Games, Settings), so Appointments is always one
// tap away. Help is not a destination: "How to use MyDay" lives in Settings.
// The visible label is the accessible name; `short` is the phone's label.
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true, phone: true },
  { to: '/medication', icon: 'pill', label: 'Medicines', phone: true },
  { to: '/appointments', icon: 'calendar', label: 'Appointments', phone: true },
  { to: '/contacts', icon: 'users', label: 'Contacts' },
  { to: '/updates', icon: 'heartPulse', label: 'Health diary', short: 'Diary', phone: true },
  { to: '/games', icon: 'brain', label: 'Games', group: 'end' },
  { to: '/profile', icon: 'gear', label: 'Settings', end: true },
];
const MORE = [
  { to: '/contacts', icon: 'users', label: 'Contacts', desc: 'Family, doctor and pharmacy, one tap away' },
  { to: '/games', icon: 'brain', label: 'Games', desc: 'Brain games and your progress' },
  { to: '/profile', icon: 'gear', label: 'Settings', desc: 'About me, reminders, text size, How to use MyDay' },
];

export function BottomNav() {
  const ref = useRef(null);
  const lensRef = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = MORE.some((m) => pathname === m.to || pathname.startsWith(`${m.to}/`));

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
            className={({ isActive }) => `bottom-nav__item${it.phone ? '' : ' bottom-nav__item--wide'}${it.group === 'end' ? ' bottom-nav__item--split' : ''}${isActive ? ' is-active' : ''}`}>
            <span className="bottom-nav__ic" aria-hidden="true"><Icon name={it.icon} size={25} /></span>
            {it.short
              ? <span className="bottom-nav__label"><span className="bottom-nav__long">{it.label}</span><span className="bottom-nav__short">{it.short}</span></span>
              : <span className="bottom-nav__label">{it.label}</span>}
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

