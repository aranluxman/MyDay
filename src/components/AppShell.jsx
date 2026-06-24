import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav.jsx';
import { Icon } from './Icon.jsx';
import { Modal } from './ui.jsx';
import { InstallButton } from './InstallButton.jsx';
import { useApp } from '../context/AppContext.jsx';

const TITLES = {
  '/': 'MyDay',
  '/updates': 'Updates',
  '/medication': 'Medication',
  '/appointments': 'Appointments',
  '/profile': 'Profile',
  '/games': 'Brain Games',
};

const ADD_ACTIONS = [
  { icon: 'pill', label: 'Medication', to: '/medication', add: 'med' },
  { icon: 'calendar', label: 'Appointment', to: '/appointments', add: 'appt' },
  { icon: 'notes', label: 'Health note', to: '/updates', add: 'diary' },
  { icon: 'phone', label: 'Contact', to: '/profile', add: 'contact' },
];

export function AppShell() {
  const { theme, setTheme } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const title = TITLES[pathname] || 'MyDay';
  const isDark = theme === 'dark' || theme === 'midnight';

  function doAdd(a) {
    setAddOpen(false);
    navigate(a.to, { state: { add: a.add } });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1 className="topbar__title">{title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <InstallButton />
          <button className="topbar__btn" aria-label="Switch theme" onClick={() => setTheme(isDark ? 'light' : 'dark')}>
            <Icon name={isDark ? 'sun' : 'moon'} size={24} />
          </button>
        </div>
      </header>

      <main className="content"><Outlet /></main>

      <button className="fab" aria-label="Add" onClick={() => setAddOpen(true)}>
        <Icon name="plus" size={30} stroke={2.6} />
      </button>

      <BottomNav />

      {addOpen && (
        <Modal title="Add something" onClose={() => setAddOpen(false)}>
          <div className="add-grid">
            {ADD_ACTIONS.map((a) => (
              <button key={a.add} className="add-grid__item" onClick={() => doAdd(a)}>
                <span className="add-grid__icon"><Icon name={a.icon} size={28} /></span>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
