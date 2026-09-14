import { NavLink } from 'react-router-dom';
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
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
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
