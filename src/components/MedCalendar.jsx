import { useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Spinner } from './ui.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { dosesInRange } from '../lib/db.js';
import { localDateStr, deviceTimezone, prettyDate } from '../lib/format.js';

// Calendars are always Sunday-first; the old "Week starts on" preference was
// one more thing to get wrong for no real benefit.
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
// Word marks inside each day so status never relies on colour alone.
const MARK = { taken: '✓', pending: '•', missed: '!' };
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function MedCalendar({ selected, onPick }) {
  const today = localDateStr(deviceTimezone());
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const first = new Date(cursor.y, cursor.m, 1);
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const startWd = first.getDay();
  const fromIso = iso(cursor.y, cursor.m, 1);
  const toIso = iso(cursor.y, cursor.m, daysInMonth);

  const { data, loading } = useAsync(() => dosesInRange(fromIso, toIso), [fromIso, toIso]);

  const byDate = useMemo(() => {
    const map = {};
    for (const d of data || []) {
      const e = (map[d.dose_date] ||= { taken: 0, missed: 0, pending: 0, total: 0 });
      e[d.status]++; e.total++;
    }
    return map;
  }, [data]);

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
    onPick(today);
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
      {loading ? <Spinner label="" /> : (
        <div className="cal__grid">
          {cells.map((day, i) => {
            if (!day) return <span key={i} className="cal__cell cal__cell--empty" />;
            const dStr = iso(cursor.y, cursor.m, day);
            const agg = byDate[dStr];
            const status = !agg ? 'none' : agg.missed ? 'missed' : agg.pending ? 'pending' : 'taken';
            const cls = `cal__cell${status !== 'none' ? ` cal__cell--${status}` : ''}${dStr === today ? ' is-today' : ''}${dStr === selected ? ' is-selected' : ''}`;
            const label = `${prettyDate(dStr)}${agg ? `: ${agg.taken} taken, ${agg.pending} to take, ${agg.missed} missed` : ': no doses'}`;
            return (
              <button key={i} className={cls} onClick={() => onPick(dStr)} aria-label={label}
                aria-current={dStr === today ? 'date' : undefined}>
                <span className="cal__day">{day}</span>
                <span className={`cal__mark cal__mark--${status}`} aria-hidden="true">{MARK[status] || ''}</span>
              </button>
            );
          })}
        </div>
      )}
      {!onThisMonth && <button className="cal__today-btn" onClick={goToday}>Back to today</button>}
      <div className="cal__legend">
        <span className="lg--taken">✓ Taken</span>
        <span className="lg--pending">• To take</span>
        <span className="lg--missed">! Missed</span>
      </div>
    </div>
  );
}
