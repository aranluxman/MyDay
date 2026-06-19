import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { UIProvider } from './context/UIContext.jsx';
import { AppShell } from './components/AppShell.jsx';
import { Spinner } from './components/ui.jsx';
import Auth from './screens/Auth.jsx';
import Home from './screens/Home.jsx';
import Updates from './screens/Updates.jsx';
import Medication from './screens/Medication.jsx';
import Appointments from './screens/Appointments.jsx';
import Profile from './screens/Profile.jsx';
import Games from './screens/Games.jsx';

function Root() {
  const { user, loading } = useApp();
  if (loading) return <div className="boot"><Spinner label="MyDay" /></div>;
  if (!user) return <Auth />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="/medication" element={<Medication />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/games" element={<Games />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
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
