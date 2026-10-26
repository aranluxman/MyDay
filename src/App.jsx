import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { UIProvider } from './context/UIContext.jsx';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { AppShell } from './components/AppShell.jsx';
import { PageSkeleton } from './components/ui.jsx';
import { isGuardianDevice } from './lib/guardian.js';

// Code-split every screen so the first paint ships only what it needs and
// navigation loads the rest on demand (with a skeleton, never a blank spinner).
const Landing = lazy(() => import('./screens/Landing.jsx'));
const Onboarding = lazy(() => import('./screens/Onboarding.jsx'));
const SignIn = lazy(() => import('./screens/SignIn.jsx'));
const Home = lazy(() => import('./screens/Home.jsx'));
const Updates = lazy(() => import('./screens/Updates.jsx'));
const Medication = lazy(() => import('./screens/Medication.jsx'));
const Appointments = lazy(() => import('./screens/Appointments.jsx'));
const Profile = lazy(() => import('./screens/Profile.jsx'));
const Games = lazy(() => import('./screens/Games.jsx'));
const GuardianJoin = lazy(() => import('./screens/GuardianJoin.jsx'));
const Guardian = lazy(() => import('./screens/Guardian.jsx'));
const AccountGuardian = lazy(() => import('./screens/AccountGuardian.jsx'));
const MedicineAsk = lazy(() => import('./screens/MedicineAsk.jsx'));
const ForgotPassword = lazy(() => import('./screens/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./screens/ResetPassword.jsx'));

function Root() {
  const { user, loading, recovery, endRecovery, sessionError, retrySession } = useApp();
  const { pathname, key } = useLocation();
  const publicFallback = <div className="content"><PageSkeleton /></div>;

  // Legacy invitation links are public. A signed-in person can otherwise be
  // both a MyDay user and a guardian; guests keep their device-only dashboard.
  if (pathname === '/guardian' && new URLSearchParams(window.location.search).has('invite')) {
    return <Suspense fallback={publicFallback}><GuardianJoin /></Suspense>;
  }

  // Opening a recovery link signs the person in, so /reset-password has to win
  // over the normal routes until they've actually chosen a new password.
  if (pathname === '/reset-password' || recovery) {
    return <Suspense fallback={publicFallback}><ResetPassword ready={recovery || !!user} onDone={endRecovery} /></Suspense>;
  }

  if (sessionError && !user) {
    return (
      <main className="content" aria-labelledby="reconnect-title">
        <h1 id="reconnect-title">Let’s reconnect</h1>
        <p role="status">{sessionError}</p>
        <button type="button" className="mkt-btn mkt-btn--primary" onClick={retrySession}>Try again</button>
      </main>
    );
  }
  if (loading) {
    return publicFallback;
  }
  if (pathname === '/guardian') {
    // Someone with their own account who opens the app straight onto
    // /guardian — an icon installed from the guardian page (whose manifest
    // starts there), a reopen, a refresh — wants their own day first. "People
    // I watch" is one tap away on Home. React Router gives the first location
    // of a page load the key 'default'; a tap inside the app never has it.
    // `?from=alert` is a missed-dose alert being tapped, which should open the
    // dashboard it is about.
    const launched = key === 'default' && !window.location.hash && !new URLSearchParams(window.location.search).has('from');
    if (user && launched) return <Navigate to="/" replace />;
    return <Suspense fallback={publicFallback}>{user ? <AccountGuardian /> : <Guardian />}</Suspense>;
  }
  if (!user) {
    // A guardian's phone opening MyDay again — from a bookmark, history, or
    // just typing the address — goes straight back to their dashboard. Landing
    // here instead is what made guardians feel "lost" after closing the tab.
    // `?home=1` is the way out for someone who is not a guardian after all.
    const wantsHome = new URLSearchParams(window.location.search).has('home');
    if (pathname === '/' && !wantsHome && isGuardianDevice()) return <Navigate to="/guardian" replace />;
    return (
      <Suspense fallback={publicFallback}>
        <Routes>
          <Route path="/get-started" element={<Onboarding />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/forgot" element={<ForgotPassword />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    );
  }
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<LazyScreen><Home /></LazyScreen>} />
        <Route path="/updates" element={<LazyScreen><Updates /></LazyScreen>} />
        <Route path="/medication" element={<LazyScreen><Medication /></LazyScreen>} />
        <Route path="/medication/ask" element={<LazyScreen><MedicineAsk /></LazyScreen>} />
        <Route path="/appointments" element={<LazyScreen><Appointments /></LazyScreen>} />
        <Route path="/profile" element={<LazyScreen><Profile /></LazyScreen>} />
        {/* Alerts are a section of Profile now, not a page of their own; old
            links (and the AI helper's navigate action) open that section. */}
        <Route path="/profile/notifications" element={<Navigate to="/profile" state={{ open: 'alerts' }} replace />} />
        <Route path="/games" element={<LazyScreen><Games /></LazyScreen>} />
        {/* The guide now lives at the bottom of Settings; old links land there. */}
        <Route path="/help" element={<Navigate to="/profile" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// Per-screen Suspense boundary so a route swap shows a skeleton in place,
// keeping the top bar and bottom nav mounted (no full-screen flash).
function LazyScreen({ children }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

export default function App() {
  return (
    <AppProvider>
      <SettingsProvider>
        <UIProvider>
          <Root />
        </UIProvider>
      </SettingsProvider>
    </AppProvider>
  );
}
