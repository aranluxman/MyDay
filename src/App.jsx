import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { UIProvider } from './context/UIContext.jsx';
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

function Root() {
  const { user, loading } = useApp();
  if (loading) {
    return <div className="content"><PageSkeleton /></div>;
  }
  if (!user) {
    return (
      <Suspense fallback={<div className="content"><PageSkeleton /></div>}>
        <Routes>
          <Route path="/get-started" element={<Onboarding />} />
          <Route path="/signin" element={<SignIn />} />
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
      <UIProvider>
        <Root />
      </UIProvider>
    </AppProvider>
  );
}
