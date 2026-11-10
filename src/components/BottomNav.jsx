import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from './Icon.jsx';

// Destinations. Phones show Home, Medicines, Appointments, Diary and More; the
// side rail on a laptop or tablet has room to list every page, so it has no
// More. The visible label is the accessible name; `short` is the phone's label.
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', end: true, phone: true },
  { to: '/medication', icon: 'pill', label: 'Medicines', phone: true },
  { to: '/appointments', icon: 'calendar', label: 'Appointments', phone: true },
  { to: '/contacts', icon: 'users', label: 'Contacts' },
  { to: '/updates', icon: 'notes', label: 'Health diary', short: 'Diary', phone: true },
  { to: '/games', icon: 'brain', label: 'Games', group: 'end' },
  { to: '/profile', icon: 'gear', label: 'Settings', end: true },
];
// Pages that live under More on a phone: More stays lit while you are in one.
export const MORE_PAGES = ['/more', '/contacts', '/games', '/profile'];

export function BottomNav() {
  const { pathname } = useLocation();
  const inMore = MORE_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {ITEMS.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          className={({ isActive }) => `bottom-nav__item${it.phone ? '' : ' bottom-nav__item--wide'}${it.group === 'end' ? ' bottom-nav__item--split' : ''}${isActive ? ' is-active' : ''}`}>
          <span className="bottom-nav__ic" aria-hidden="true"><Icon name={it.icon} size={25} /></span>
          {it.short
            ? <span className="bottom-nav__label"><span className="bottom-nav__long">{it.label}</span><span className="bottom-nav__short">{it.short}</span></span>
            : <span className="bottom-nav__label">{it.label}</span>}
        </NavLink>
      ))}
      <NavLink to="/more" className={`bottom-nav__item bottom-nav__more${inMore ? ' is-active' : ''}`}
        aria-current={inMore ? 'page' : undefined}>
        <span className="bottom-nav__ic" aria-hidden="true"><Icon name="more" size={25} stroke={3} /></span>
        <span className="bottom-nav__label">More</span>
      </NavLink>
    </nav>
  );
}
