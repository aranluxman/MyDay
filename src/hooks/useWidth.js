import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The live width of an element, so a screen can choose its layout from the
 * space it actually has (a side rail, split view and text size all change
 * that) rather than from the device. Returns [ref, width].
 */
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
