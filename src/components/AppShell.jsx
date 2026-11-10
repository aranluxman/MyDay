import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav.jsx';
import { Icon } from './Icon.jsx';
import { QuickSettings } from './QuickSettings.jsx';
import { DueAlarm } from './DueAlarm.jsx';
import { useApp } from '../context/AppContext.jsx';
import { playAlarmOnce } from '../lib/alarm.js';

const TITLES = {
  '/': 'MyDay',
  '/updates': 'Health diary',
  '/medication': 'Medicines',
  '/appointments': 'Appointments',
  '/profile': 'Settings',
  '/contacts': 'Contacts',
  '/games': 'Games',
  '/more': 'More',
  '/health': 'Health tracker',
  '/reports': 'Reports',
  '/medication/ask': 'Ask about medicines',
};

// Pages reached from another page say where "back" goes, above their title.
const BACK = {
  '/contacts': { to: '/more', label: 'More' },
  '/games': { to: '/more', label: 'More' },
  '/profile': { to: '/more', label: 'More' },
  '/reports': { to: '/more', label: 'More' },
  '/health': { to: '/updates', label: 'Diary' },
  '/medication/ask': { to: '/medication', label: 'Medicines' },
};

// Each main page has one "Add" beside the profile chip, never floating over
// the content. Home's opens a short menu of everything that can be added.
const ADD_FOR = {
  '/medication': { label: 'Add', aria: 'Add a medicine', to: '/medication', add: 'med' },
  '/appointments': { label: 'Add', aria: 'Add an appointment', to: '/appointments', add: 'appt' },
  '/updates': { label: 'Add note', aria: 'Add health note', to: '/updates', add: 'diary' },
};
// The profile chip sits under the title on the everyday pages.
const CHIP_PAGES = new Set(['/', '/medication', '/appointments', '/updates', '/more', '/contacts', '/games', '/health', '/reports']);

const ADD_ACTIONS = [
  { icon: 'pill', label: 'Add a medicine', desc: 'Pills, vitamins, drops', to: '/medication', add: 'med' },
  { icon: 'calendar', label: 'Add an appointment', desc: 'Doctor, clinic, dentist', to: '/appointments', add: 'appt' },
  { icon: 'notes', label: 'Add a health note', desc: 'How you feel today', to: '/updates', add: 'diary' },
  { icon: 'phone', label: 'Add a contact', desc: 'Pharmacy, doctor, family', to: '/contacts', add: 'contact' },
];

export function AppShell() {
  const { profile } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const title = TITLES[pathname] || 'MyDay';
  const isHome = pathname === '/';
  const back = BACK[pathname];
  const addDirect = ADD_FOR[pathname];
  const showChip = CHIP_PAGES.has(pathname);
  const addRef = useRef(null);
  const mainRef = useRef(null);
  const firstRoute = useRef(true);
  const online = useOnline();
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0];

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

  useEffect(() => {
    window.scrollTo(0, 0);
    setAddOpen(false);
    setQuickOpen(false);
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
      <header className="topbar">
        {back && (
          <button type="button" className="topbar__back" onClick={() => navigate(back.to)}>
            <Icon name="back" size={20} stroke={2.4} /> <span>{back.label}</span>
          </button>
        )}
        <div className="topbar__main">
          <h1 className={`topbar__title${isHome ? ' topbar__title--brand' : ''}`} id="page-title">
            {isHome ? <span aria-label="MyDay" translate="no">MYDAY</span> : title}
          </h1>
          {/* Settings is one labelled button at the top of every page. The
              Settings page itself does not need a way to itself. */}
          {pathname !== '/profile' && (
            <button type="button" className="topbar__settings" aria-haspopup="dialog" aria-expanded={quickOpen}
              onClick={() => setQuickOpen(true)}>
              <Icon name="gear" size={22} /> <span>Settings</span>
            </button>
          )}
        </div>
      </header>

      <main className="content" id="main" ref={mainRef} tabIndex={-1} aria-labelledby="page-title">
        {showChip && (
          <div className="subbar">
            <button type="button" className="who-chip" aria-haspopup="dialog"
              aria-label={`${firstName || 'My profile'}${firstName ? ', my profile' : ''}: open quick settings`}
              onClick={() => setQuickOpen(true)}>
              <Icon name="user" size={22} />
              <span className="who-chip__t">{firstName ? <><span translate="no">{firstName}</span> · My profile</> : 'My profile'}</span>
              <Icon name="chevron" size={18} className="who-chip__chev" />
            </button>
            {isHome && (
              <button type="button" ref={addRef} className={`subbar__add${addOpen ? ' is-open' : ''}`}
                aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>
                <Icon name="plus" size={22} stroke={2.6} /> <span>Add</span>
              </button>
            )}
            {addDirect && (
              <button type="button" className="subbar__add" aria-label={addDirect.aria} onClick={() => doAdd(addDirect)}>
                <Icon name="plus" size={22} stroke={2.6} /> <span>{addDirect.label}</span>
              </button>
            )}
          </div>
        )}
        {/* Keyed on the route so each screen plays its entrance. */}
        <div className="page" key={pathname}><Outlet /></div>
      </main>

      {isHome && addOpen && <AddMenu anchor={addRef} onPick={doAdd} onClose={() => { setAddOpen(false); addRef.current?.focus(); }} />}
      {quickOpen && <QuickSettings onClose={() => setQuickOpen(false)} />}

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
