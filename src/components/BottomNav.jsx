import { NavLink } from 'react-router-dom';
import { Icon } from './Icon.jsx';

// Six destinations. The row scrolls horizontally on very narrow phones so every
// label stays readable (no truncation) — labels match each page's title.
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/updates', icon: 'pulse', label: 'Updates' },
  { to: '/medication', icon: 'pill', label: 'Medication' },
  { to: '/appointments', icon: 'calendar', label: 'Appointments' },
  { to: '/games', icon: 'brain', label: 'Games' },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {ITEMS.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          aria-label={it.label}
          className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}>
          <Icon name={it.icon} size={25} />
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
