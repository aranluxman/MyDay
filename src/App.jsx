import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { UIProvider } from './context/UIContext.jsx';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { AppShell } from './components/AppShell.jsx';
import { PageSkeleton } from './components/ui.jsx';

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
const ForgotPassword = lazy(() => import('./screens/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./screens/ResetPassword.jsx'));

function Root() {
  const { user, loading, recovery, endRecovery } = useApp();
  const { pathname } = useLocation();
  const publicFallback = <div className="content"><PageSkeleton /></div>;

  // Public guardian page: a guardian is a different person with no MyDay
  // account, on their own device, so this renders regardless of auth. It is
  // also the PWA start_url when the dashboard is installed on its own, so it
  // must never depend on a session.
  if (pathname === '/guardian') {
    // An old shared invite LINK still pairs through the original join screen;
    // everything else — and every return visit — is the dashboard.
    const fromInviteLink = new URLSearchParams(window.location.search).has('invite');
    return (
      <Suspense fallback={publicFallback}>
        {fromInviteLink ? <GuardianJoin /> : <Guardian />}
      </Suspense>
    );
  }

  // Opening a recovery link signs the person in, so /reset-password has to win
  // over the normal routes until they've actually chosen a new password.
  if (pathname === '/reset-password' || recovery) {
    return <Suspense fallback={publicFallback}><ResetPassword ready={recovery || !!user} onDone={endRecovery} /></Suspense>;
  }

  if (loading) {
    return publicFallback;
  }
  if (!user) {
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
        <Route path="/appointments" element={<LazyScreen><Appointments /></LazyScreen>} />
        <Route path="/profile" element={<LazyScreen><Profile /></LazyScreen>} />
        <Route path="/games" element={<LazyScreen><Games /></LazyScreen>} />
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
