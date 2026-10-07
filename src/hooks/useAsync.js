import { useState, useEffect, useCallback, useRef } from 'react';

// Loads async data, exposes { data, loading, error, reload, refreshing }.
//
// A reload() keeps the current data on screen while it refreshes (refreshing
// is true, loading stays false). Before, every reload blanked the list to a
// skeleton — after tapping "Done" the whole Today list flashed away and
// keyboard focus fell to the page. Changing `deps` (a different day, say)
// still shows loading, because the old data would be wrong for the new view.
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null, refreshing: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const depsKey = JSON.stringify(deps);
  const lastKey = useRef(depsKey);
  useEffect(() => {
    let alive = true;
    const sameView = lastKey.current === depsKey;
    lastKey.current = depsKey;
    setState((s) => (sameView && s.data != null
      ? { ...s, refreshing: true, error: null }
      : { data: null, loading: true, error: null, refreshing: false }));
    Promise.resolve(loader())
      .then((data) => alive && setState({ data, loading: false, error: null, refreshing: false }))
      .catch((error) => {
        console.error(error);
        if (alive) setState((s) => ({ data: sameView ? s.data : null, loading: false, error, refreshing: false }));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, tick]);
  return { ...state, reload };
}
