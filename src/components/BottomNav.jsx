import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from './Icon.jsx';

// Six destinations. Brain Games used to be reachable only from Home and from a
// row buried in Profile, which meant most people never found it; it earns a tab.
// Labels are shortened so six fit across a phone without sideways scrolling.
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/updates', icon: 'pulse', label: 'Updates' },
  { to: '/medication', icon: 'pill', label: 'Medicine', aria: 'Medication' },
  { to: '/appointments', icon: 'calendar', label: 'Visits', aria: 'Appointments' },
  { to: '/games', icon: 'brain', label: 'Games', aria: 'Brain Games' },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

export function BottomNav() {
  const ref = useRef(null);
  const { pathname } = useLocation();

  // One highlight that glides to the active tab instead of each tab lighting
  // up separately. Measured, so it works for the bottom bar and the side rail.
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return undefined;
    const place = () => {
      const a = nav.querySelector('.bottom-nav__item.is-active');
      if (!a) { nav.style.setProperty('--ind-o', '0'); return; }
      nav.style.setProperty('--ind-x', `${a.offsetLeft}px`);
      nav.style.setProperty('--ind-y', `${a.offsetTop}px`);
      nav.style.setProperty('--ind-w', `${a.offsetWidth}px`);
      nav.style.setProperty('--ind-h', `${a.offsetHeight}px`);
      nav.style.setProperty('--ind-o', '1');
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [pathname]);

  return (
    <nav className="bottom-nav" aria-label="Main navigation" ref={ref}>
      <span className="bottom-nav__ind" aria-hidden="true" />
      {ITEMS.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          aria-label={it.aria || it.label}
          className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}>
          <span className="bottom-nav__ic"><Icon name={it.icon} size={25} /></span>
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
