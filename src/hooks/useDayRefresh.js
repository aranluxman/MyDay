import { useEffect } from 'react';

// A reopened app must read the saved dose states, and a page left open must
// advance from morning to evening (or to a new day) without a manual reload.
export function useDayRefresh(reload) {
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [reload]);
}
