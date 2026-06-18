import { NavLink } from 'react-router-dom';
import { Icon } from './Icon.jsx';

const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/updates', icon: 'pulse', label: 'Updates' },
  { to: '/medication', icon: 'pill', label: 'Medicine' },
  { to: '/appointments', icon: 'calendar', label: 'Visits' },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}>
          <Icon name={it.icon} size={26} />
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
