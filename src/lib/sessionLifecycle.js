// Let Supabase own tokens and refresh locking. A failed session lookup is not
// proof of logout: expired access tokens can be waiting for the network.
export function watchSession(auth, { onSession, onError, onRecovery }, {
  window: win = window,
  document: doc = document,
  retryMs = 15_000,
} = {}) {
  let active = true;
  let revision = 0;
  let pending = false;
  let timer;

  function cancelRetry() {
    win.clearTimeout(timer);
    timer = undefined;
  }

  async function retry() {
    if (!active || pending) return;
    cancelRetry();
    pending = true;
    const startedAt = revision;
    try {
      const { data, error } = await auth.getSession();
      // A sign-out or newer auth event wins over an older lookup.
      if (!active || revision !== startedAt) return;
      if (error) throw error;
      onError(null);
      onSession(data.session);
    } catch {
      if (!active || revision !== startedAt) return;
      // Do not clear SDK storage or present a login form for a failed lookup.
      onError('We could not reconnect to your account. Check your internet connection and try again.');
      timer = win.setTimeout(retry, retryMs);
    } finally {
      pending = false;
    }
  }

  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (!active) return;
    // INITIAL_SESSION can be null on a retryable refresh failure. getSession
    // exposes the error; use that result to distinguish failure from no login.
    if (event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_OUT' || session) {
      revision += 1;
      cancelRetry();
      onError(null);
      onSession(session);
    }
    if (event === 'PASSWORD_RECOVERY') onRecovery(true);
    if (event === 'SIGNED_OUT') onRecovery(false);
    // Keep this callback synchronous: auth calls here can deadlock SDK locks.
  });

  const wake = () => { if (doc.visibilityState === 'visible') void retry(); };
  win.addEventListener('online', retry);
  doc.addEventListener('visibilitychange', wake);
  void retry();

  return {
    retry,
    unsubscribe() {
      active = false;
      cancelRetry();
      subscription.unsubscribe();
      win.removeEventListener('online', retry);
      doc.removeEventListener('visibilitychange', wake);
    },
  };
}
