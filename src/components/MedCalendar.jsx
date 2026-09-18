import { useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Spinner } from './ui.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { dosesInRange } from '../lib/db.js';
import { dayMarkFromCounts } from '../lib/doseState.js';
import { localDateStr, deviceTimezone, prettyDate } from '../lib/format.js';

// Calendars are always Sunday-first; the old "Week starts on" preference was
// one more thing to get wrong for no real benefit.
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Word marks inside each day so status never relies on colour alone. 'partial'
// is a day that was neither fully taken nor fully missed — it used to be drawn
// as wholly missed, which is what made the calendar contradict Home's counters.
const MARK = { taken: '✓', partial: '◐', pending: '•', missed: '!' };
const MARK_WORD = { taken: 'all taken', partial: 'partly taken', pending: 'to take', missed: 'missed' };

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * Month grid of medication adherence.
 *
 * @param counts  Optional pre-aggregated { 'YYYY-MM-DD': {taken,missed,pending} }.
 *                The guardian dashboard passes this in (it has no Supabase
 *                session and reads through an edge function), so both sides
 *                render from the same component and the marks always match.
 */
export function MedCalendar({ selected, onPick, counts }) {
  const today = localDateStr(deviceTimezone());
  const [cursor, setCursor] = useState(() => {
    // Open on the selected day's month when one is given, so a guardian
    // tapping into last month doesn't get bounced back to today.
    if (selected) {
      const [y, m] = selected.split('-').map(Number);
      if (Number.isFinite(y) && Number.isFinite(m)) return { y, m: m - 1 };
    }
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const first = new Date(cursor.y, cursor.m, 1);
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const startWd = first.getDay();
  const fromIso = iso(cursor.y, cursor.m, 1);
  const toIso = iso(cursor.y, cursor.m, daysInMonth);

  const external = !!counts;
  // Hooks cannot be called conditionally, so the query is always declared and
  // simply short-circuited when the caller supplied its own data.
  const { data, loading } = useAsync(
    () => (external ? Promise.resolve([]) : dosesInRange(fromIso, toIso)),
    [fromIso, toIso, external]
  );

  const byDate = useMemo(() => {
    if (external) return counts;
    const map = {};
    for (const d of data || []) {
      const e = (map[d.dose_date] ||= { taken: 0, missed: 0, pending: 0, skipped: 0, total: 0 });
      // 'skipped' needs its own bucket: counted as pending it would leave a
      // deliberate "not today" showing as still to take, for ever.
      if (e[d.status] != null) e[d.status]++;
      e.total++;
    }
    return map;
  }, [data, counts, external]);

  function shift(delta) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }
  const now = new Date();
  const onThisMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth();
  function goToday() {
    setCursor({ y: now.getFullYear(), m: now.getMonth() });
    onPick?.(today);
  }

  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  const monthLabel = first.toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <div className="cal">
      <div className="cal__head">
        <button className="cal__nav" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="back" size={24} /></button>
        <span className="cal__title" aria-live="polite">{monthLabel}</span>
        <button className="cal__nav" aria-label="Next month" onClick={() => shift(1)}><Icon name="chevron" size={24} /></button>
      </div>
      <div className="cal__weekdays">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
      {loading && !external ? <Spinner label="" /> : (
        <div className="cal__grid">
          {cells.map((day, i) => {
            if (!day) return <span key={i} className="cal__cell cal__cell--empty" />;
            const dStr = iso(cursor.y, cursor.m, day);
            const agg = byDate?.[dStr];
            const status = dayMarkFromCounts(agg);
            const cls = `cal__cell${status !== 'none' ? ` cal__cell--${status}` : ''}`
              + `${dStr === today ? ' is-today' : ''}${dStr === selected ? ' is-selected' : ''}`;
            const label = `${prettyDate(dStr)}${agg
              ? `: ${MARK_WORD[status]} — ${agg.taken || 0} taken, ${agg.pending || 0} to take, ${agg.missed || 0} missed`
              : ': no doses'}`;
            const Cell = onPick ? 'button' : 'span';
            return (
              <Cell key={i} className={cls} onClick={onPick ? () => onPick(dStr) : undefined} aria-label={label}
                aria-current={dStr === today ? 'date' : undefined}>
                <span className="cal__day">{day}</span>
                <span className={`cal__mark cal__mark--${status}`} aria-hidden="true">{MARK[status] || ''}</span>
              </Cell>
            );
          })}
        </div>
      )}
      {!onThisMonth && <button className="cal__today-btn" onClick={goToday}>Back to today</button>}
      <div className="cal__legend">
        <span className="lg--taken">✓ All taken</span>
        <span className="lg--partial">◐ Some taken</span>
        <span className="lg--pending">• To take</span>
        <span className="lg--missed">! Missed</span>
      </div>
    </div>
  );
}
