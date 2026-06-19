import { useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Spinner } from './ui.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { dosesInRange } from '../lib/db.js';
import { localDateStr, deviceTimezone } from '../lib/format.js';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
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

  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  const monthLabel = first.toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <div className="cal">
      <div className="cal__head">
        <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="back" size={22} /></button>
        <span className="cal__title">{monthLabel}</span>
        <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><Icon name="chevron" size={22} /></button>
      </div>
      <div className="cal__weekdays">{WD.map((w, i) => <span key={i}>{w}</span>)}</div>
      {loading ? <Spinner label="" /> : (
        <div className="cal__grid">
          {cells.map((day, i) => {
            if (!day) return <span key={i} className="cal__cell cal__cell--empty" />;
            const dStr = iso(cursor.y, cursor.m, day);
            const agg = byDate[dStr];
            const status = !agg ? '' : agg.missed ? 'missed' : agg.pending ? 'pending' : 'taken';
            const cls = `cal__cell${dStr === today ? ' is-today' : ''}${dStr === selected ? ' is-selected' : ''}`;
            return (
              <button key={i} className={cls} onClick={() => onPick(dStr)}>
                <span className="cal__day">{day}</span>
                {status && <span className={`cal__dot cal__dot--${status}`} />}
              </button>
            );
          })}
        </div>
      )}
      <div className="cal__legend">
        <span><i className="cal__dot cal__dot--taken" /> Taken</span>
        <span><i className="cal__dot cal__dot--pending" /> To take</span>
        <span><i className="cal__dot cal__dot--missed" /> Missed</span>
      </div>
    </div>
  );
}
