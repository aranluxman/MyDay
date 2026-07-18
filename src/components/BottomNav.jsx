import { NavLink } from 'react-router-dom';
import { Icon } from './Icon.jsx';

// Five destinations, matching the reference design. Brain Games is reached
// from the Home screen so the nav stays roomy and labels stay readable.
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/updates', icon: 'pulse', label: 'Updates' },
  { to: '/medication', icon: 'pill', label: 'Medication' },
  { to: '/appointments', icon: 'calendar', label: 'Appointments' },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {ITEMS.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          aria-label={it.label}
          className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}>
          <span className="bottom-nav__ic"><Icon name={it.icon} size={25} /></span>
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
