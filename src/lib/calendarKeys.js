// Keyboard movement around a month calendar, as a pure function so it can be
// tested: the arrows move a day or a week, Home and End go to the start and
// end of the week (Sunday-first), Page Up and Page Down move a month and keep
// the day where they can (Jan 31 + one month is Feb 28/29, not Mar 3).

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** The ISO date `n` days from `isoDate`. */
export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const at = new Date(y, m - 1, d + n);
  return iso(at.getFullYear(), at.getMonth(), at.getDate());
}

/** The day a key moves to from `isoDate`, or null for keys the grid ignores. */
export function dayForKey(key, isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  switch (key) {
    case 'ArrowLeft': return addDays(isoDate, -1);
    case 'ArrowRight': return addDays(isoDate, 1);
    case 'ArrowUp': return addDays(isoDate, -7);
    case 'ArrowDown': return addDays(isoDate, 7);
    case 'Home': return addDays(isoDate, -wd);
    case 'End': return addDays(isoDate, 6 - wd);
    case 'PageUp':
    case 'PageDown': {
      const target = new Date(y, m - 1 + (key === 'PageUp' ? -1 : 1), 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return iso(target.getFullYear(), target.getMonth(), Math.min(d, last));
    }
    default: return null;
  }
}
