import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav.jsx';
import { Avatar } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { InstallButton } from './InstallButton.jsx';
import { DueAlarm } from './DueAlarm.jsx';
import { useApp } from '../context/AppContext.jsx';
import { playAlarmOnce } from '../lib/alarm.js';
import { modeOf, nextMode, themeForMode } from '../lib/appearance.js';

const MODE_WORDS = { system: 'match my device', light: 'light mode', dark: 'dark mode' };

const TITLES = {
  '/': 'MyDay',
  '/updates': 'Health diary',
  '/medication': 'Medicines',
  '/appointments': 'Appointments',
  '/profile': 'Settings',
  '/contacts': 'Contacts',
  '/games': 'Games',
  '/medication/ask': 'Ask about medicines',
};

// Medicines and Appointments have their own "+ Add" in the top bar; these two
// get one too (Today's opens a short menu).
const ADD_PAGES = new Set(['/', '/updates']);
// Pages that carry the profile photo in the top bar, as a way into Profile.
const AVATAR_PAGES = new Set(['/']);

const ADD_ACTIONS = [
  { icon: 'pill', label: 'Add a medicine', desc: 'Pills, vitamins, drops', to: '/medication', add: 'med' },
  { icon: 'calendar', label: 'Add an appointment', desc: 'Doctor, clinic, dentist', to: '/appointments', add: 'appt' },
  { icon: 'notes', label: 'Add a health note', desc: 'How you feel today', to: '/updates', add: 'diary' },
  { icon: 'phone', label: 'Add a contact', desc: 'Pharmacy, doctor, family', to: '/contacts', add: 'contact' },
];

export function AppShell() {
  const { theme, resolvedTheme, setTheme, profile } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const title = TITLES[pathname] || 'MyDay';
  const mode = modeOf(theme);
  const next = nextMode(theme);
  const modeIcon = mode === 'system' ? 'monitor' : mode === 'dark' ? 'moon' : 'sun';
  const isHome = pathname === '/';
  // Adding lives in the top bar on every page, never floating over the
  // content or beside the tab bar. Health diary's button does that page's one
  // job directly; only Today keeps the short menu of everything addable.
  const showAdd = ADD_PAGES.has(pathname);
  const addDirect = pathname === '/updates' ? ADD_ACTIONS.find((a) => a.add === 'diary') : null;
  const addRef = useRef(null);
  const mainRef = useRef(null);
  const firstRoute = useRef(true);
  const online = useOnline();

  // A meaningful page title for every route (tabs, history, screen readers).
  useEffect(() => { document.title = pathname === '/' ? 'Home · MyDay' : `${title} · MyDay`; }, [pathname, title]);

  // A missed-dose push arriving while MyDay is open sets off the loud alarm,
  // once per dose — an ordinary notification sound is too easy to miss.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return undefined;
    const onMsg = (e) => { if (e.data?.type === 'myday-missed') playAlarmOnce(e.data.doseId || `push-${Date.now()}`); };
    sw.addEventListener('message', onMsg);
    return () => sw.removeEventListener('message', onMsg);
  }, []);

  // The large title shrinks into a compact bar once the page moves, the way
  // iOS navigation bars do.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    setAddOpen(false);
    // After navigating, start a keyboard / screen reader user at the new
    // page's content rather than leaving focus on the tab they pressed.
    if (firstRoute.current) { firstRoute.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  function doAdd(a) {
    setAddOpen(false);
    navigate(a.to, { state: { add: a.add } });
  }

  return (
    <div className="app-shell" data-page={pathname}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to main content</a>
      <Ambient />
      <DueAlarm />
      {/* Honest about the network: an action taken offline is NOT saved, and
          the screens say so rather than pretending. */}
      {!online && (
        <div className="offline-bar" role="status">
          <Icon name="alert" size={20} /> You are offline. Nothing you tap is saved until you reconnect.
        </div>
      )}
      <header className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
        <h1 className="topbar__title" id="page-title">{isHome ? <><Icon name="leaf" size={26} className="topbar__leaf" />My<span className="topbar__accent">Day</span></> : title}</h1>
        <div className="topbar__tools">
          <InstallButton />
          {showAdd && (
            <button type="button" ref={addRef} className={`topbar__add${addOpen ? ' is-open' : ''}`}
              aria-haspopup={addDirect ? undefined : 'menu'} aria-expanded={addDirect ? undefined : addOpen}
              aria-label={addDirect ? 'Add health note' : 'Add'}
              onClick={() => (addDirect ? doAdd(addDirect) : setAddOpen((v) => !v))}>
              <Icon name="plus" size={22} stroke={2.6} /> <span>{addDirect ? 'Add note' : 'Add'}</span>
            </button>
          )}
          {pathname === '/medication' && (
            <button type="button" className="topbar__add" aria-label="Add a medicine" onClick={() => navigate('/medication', { state: { add: 'med' } })}>
              <Icon name="plus" size={22} stroke={2.6} /> <span>Add</span>
            </button>
          )}
          {pathname === '/appointments' && (
            <button type="button" className="topbar__add" aria-label="Add an appointment" onClick={() => navigate('/appointments', { state: { add: 'appt' } })}>
              <Icon name="plus" size={22} stroke={2.6} /> <span>Add</span>
            </button>
          )}
          <button className={`topbar__btn${pathname === '/updates' ? ' topbar__btn--label' : ''}`} data-mode={mode}
            aria-label={`Theme: switch to ${MODE_WORDS[next]} (now ${MODE_WORDS[mode]}${mode === 'system' ? `, ${resolvedTheme === 'dark' ? 'dark' : 'light'}` : ''})`}
            title={`Now ${MODE_WORDS[mode]} — tap for ${MODE_WORDS[next]}`} onClick={() => setTheme(themeForMode(next, theme))}>
            <Icon name={modeIcon} size={24} />
            {pathname === '/updates' && <span className="topbar__btn-l">Theme</span>}
          </button>
          {AVATAR_PAGES.has(pathname) && (
            <button type="button" className="topbar__avatar" aria-label="Settings and about me" onClick={() => navigate('/profile')}>
              <Avatar name={profile?.full_name} color={profile?.avatar_color} size={48} src={profile?.avatar_url} />
            </button>
          )}
        </div>
      </header>

      {/* Keyed on the route so each screen plays its entrance. */}
      <main className="content" id="main" ref={mainRef} tabIndex={-1} aria-labelledby="page-title"><div className="page" key={pathname}><Outlet /></div></main>

      {showAdd && addOpen && <AddMenu anchor={addRef} onPick={doAdd} onClose={() => { setAddOpen(false); addRef.current?.focus(); }} />}

      <BottomNav />
    </div>
  );
}

// The Add button's menu: a short list that drops out of the button itself, so
// it reads as "the things this button does" rather than a new screen to learn.
function AddMenu({ anchor, onPick, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  // Hang the menu below the top-bar button, wherever the layout has put it.
  useLayoutEffect(() => {
    const place = () => {
      const btn = anchor?.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPos({ right: Math.max(12, window.innerWidth - r.right), top: r.bottom + 8, bottom: 'auto' });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);
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

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
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
