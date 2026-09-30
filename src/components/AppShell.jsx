import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav.jsx';
import { Icon } from './Icon.jsx';
import { InstallButton } from './InstallButton.jsx';
import { useApp } from '../context/AppContext.jsx';

const TITLES = {
  '/': 'MyDay',
  '/updates': 'Updates',
  '/medication': 'Medication',
  '/appointments': 'Appointments',
  '/profile': 'Profile',
  '/profile/notifications': 'Alerts',
  '/cards': 'My cards',
  '/games': 'Brain Games',
  '/help': 'Guide',
};

const ADD_ACTIONS = [
  { icon: 'pill', label: 'Add a medicine', desc: 'Pills, vitamins, drops', to: '/medication', add: 'med' },
  { icon: 'calendar', label: 'Add a visit', desc: 'Doctor, clinic, dentist', to: '/appointments', add: 'appt' },
  { icon: 'notes', label: 'Add a health note', desc: 'How you feel today', to: '/updates', add: 'diary' },
  { icon: 'phone', label: 'Add a contact', desc: 'Pharmacy, doctor, family', to: '/profile', add: 'contact' },
];

export function AppShell() {
  const { theme, setTheme } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const title = TITLES[pathname] || 'MyDay';
  const isDark = theme === 'dark' || theme === 'midnight';
  const isHome = pathname === '/';
  // Nothing in the quick-add menu applies while playing a game, and the button
  // sits right on top of the last card in the grid.
  const showAdd = pathname !== '/games';

  // The large title shrinks into a compact bar once the page moves, the way
  // iOS navigation bars do.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); setAddOpen(false); }, [pathname]);

  function doAdd(a) {
    setAddOpen(false);
    navigate(a.to, { state: { add: a.add } });
  }

  return (
    <div className="app-shell" data-page={pathname}>
      <Ambient />
      <header className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
        <h1 className="topbar__title">{title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <InstallButton />
          <button className="topbar__btn" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>
            <Icon name={isDark ? 'sun' : 'moon'} size={24} />
          </button>
        </div>
      </header>

      {/* Keyed on the route so each screen plays its entrance. */}
      <main className="content"><div className="page" key={pathname}><Outlet /></div></main>

      {showAdd && addOpen && <AddMenu onPick={doAdd} onClose={() => setAddOpen(false)} />}

      {showAdd && (
        <button className={`fab${isHome ? ' fab--labeled' : ''}${addOpen ? ' is-open' : ''}`}
          aria-label={addOpen ? 'Close the add menu' : 'Add something'} aria-haspopup="menu" aria-expanded={addOpen}
          onClick={() => setAddOpen((v) => !v)}>
          <Icon name="plus" size={30} stroke={2.6} className="fab__ic" />
          {isHome && <span className="fab__label">{addOpen ? 'Close' : 'Add'}</span>}
        </button>
      )}

      <BottomNav />
    </div>
  );
}

// The + button's menu: a short list that drops out of the button itself, so it
// reads as "the things this button does" rather than a new screen to learn.
function AddMenu({ onPick, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  // Hang the menu off the button wherever the layout has put it (phone bar,
  // tablet rail, desktop corner) instead of repeating each breakpoint here.
  useLayoutEffect(() => {
    const place = () => {
      const fab = document.querySelector('.fab');
      if (!fab) return;
      const r = fab.getBoundingClientRect();
      setPos({ right: Math.max(12, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 12 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...ref.current.querySelectorAll('button')];
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="add-menu__scrim" onClick={onClose} aria-hidden="true" />
      <div className="add-menu" role="menu" aria-label="Add something" ref={ref} style={pos || undefined}>
        {ADD_ACTIONS.map((a) => (
          <button key={a.add} role="menuitem" className="add-menu__item" onClick={() => onPick(a)}>
            <span className="add-menu__ic"><Icon name={a.icon} size={24} /></span>
            <span className="add-menu__main">
              <span className="add-menu__t">{a.label}</span>
              <span className="add-menu__d">{a.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

// Soft colour fields drifting slowly behind the glass. Purely decorative, so
// hidden from assistive tech and frozen by Calm screen / reduced motion.
export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <span className="ambient__blob ambient__blob--a" />
      <span className="ambient__blob ambient__blob--b" />
      <span className="ambient__blob ambient__blob--c" />
    </div>
  );
}
