import { useEffect, useState } from 'react';

// PWA install handling.
//  - installed: app is running as an installed PWA (hide the button)
//  - canPrompt: the browser gave us an install prompt we can trigger
//  - install(): triggers it; returns true if a prompt was shown
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  );

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onMode = (e) => setInstalled(e.matches);
    mq?.addEventListener?.('change', onMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onMode);
    };
  }, []);

  async function install() {
    if (!deferred) return false;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
    return true;
  }

  return { installed, canPrompt: !!deferred, canInstall: !installed && !!deferred, install };
}
