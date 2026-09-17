import { useEffect, useState } from 'react';
import { isInstalled } from '../lib/push.js';

// PWA install handling.
//  - installed: app is running as an installed PWA (hide the button)
//  - canPrompt: the browser gave us an install prompt we can trigger
//  - install(): triggers it; returns true if a prompt was shown
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  // Shares isInstalled() with push.js so "is this installed?" has one answer.
  // The local check here missed display-mode: minimal-ui and fullscreen, which
  // meant an installed app could still be shown "Add to Home Screen" steps.
  const [installed, setInstalled] = useState(isInstalled);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // Re-ask isInstalled() rather than trusting one query's matches, so any of
    // the standalone-ish display modes flips the flag.
    const onMode = () => setInstalled(isInstalled());
    const queries = ['standalone', 'minimal-ui', 'fullscreen']
      .map((m) => window.matchMedia?.(`(display-mode: ${m})`))
      .filter(Boolean);
    queries.forEach((mq) => mq.addEventListener?.('change', onMode));
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      queries.forEach((mq) => mq.removeEventListener?.('change', onMode));
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
