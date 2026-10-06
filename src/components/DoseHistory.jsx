import { useMemo, useState } from 'react';
import { useAsync } from '../hooks/useAsync.js';
import { EmptyState, SkeletonCard, Button } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { doseHistory } from '../lib/db.js';
import { prettyTime, prettyClock, prettyDate, localDateStr } from '../lib/format.js';
import { doseState, summarise, dayMarkFromCounts, STATE_UI } from '../lib/doseState.js';
import { medIcon } from '../lib/medIcon.js';

// Every dose from the last month as one scrollable list, newest day first.
// The calendar answers "how did Tuesday go?"; this answers "have I been taking
// everything?" without tapping through thirty days one at a time.

const HISTORY_DAYS = 30;
// Days rendered before "Show more" — the same paging the guardian history uses.
const PAGE = 7;

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'taken', label: 'Taken' },
  { id: 'missed', label: 'Missed' },
  { id: 'skipped', label: 'Not today' },
];

export function DoseHistory({ windowMinutes }) {
  const range = useMemo(() => {
    const from = new Date(); from.setDate(from.getDate() - (HISTORY_DAYS - 1));
    return { from: localDateStr(undefined, from), to: localDateStr() };
  }, []);
  const { data, loading, error, reload } = useAsync(() => doseHistory(range.from, range.to), [range.from, range.to]);
  const [filter, setFilter] = useState('all');
  const [medId, setMedId] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const opts = useMemo(() => ({ windowMinutes }), [windowMinutes]);

  const meds = useMemo(() => {
    const seen = new Map();
    for (const d of data || []) {
      if (d.medication_id && !seen.has(d.medication_id)) seen.set(d.medication_id, d.medication?.name || 'Medicine');
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  // Grouped by day before filtering, so a day's "3/4 taken" stays the truth
  // about that day even while the list below is narrowed to one medicine.
  const days = useMemo(() => {
    const map = new Map();
    for (const d of data || []) {
      if (medId !== 'all' && d.medication_id !== medId) continue;
      if (!map.has(d.dose_date)) map.set(d.dose_date, []);
      map.get(d.dose_date).push(d);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, doses]) => ({
        date,
        summary: summarise(doses, opts),
        shown: filter === 'all' ? doses : doses.filter((d) => doseState(d, opts) === filter),
      }))
      .filter((day) => day.shown.length);
  }, [data, medId, filter, opts]);

  if (loading) return <div className="stack"><SkeletonCard lines={3} /><SkeletonCard lines={3} /></div>;
  if (error) return <EmptyState icon="alert" title="Could not load your history" action={<Button onClick={reload}>Try again</Button>} />;
  if (!data.length) return <EmptyState icon="calendar">No doses in the last {HISTORY_DAYS} days yet.</EmptyState>;

  const visible = days.slice(0, limit);
  const more = days.length - visible.length;

  return (
    <div className="stack">
      <div className="hist__filters">
        <div className="chips" role="group" aria-label="Show doses">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`chip${filter === f.id ? ' is-on' : ''}`}
              aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setLimit(PAGE); }}>
              {f.label}
            </button>
          ))}
        </div>
        {meds.length > 1 && (
          <select className="input hist__med" value={medId} aria-label="Show one medicine"
            onChange={(e) => { setMedId(e.target.value); setLimit(PAGE); }}>
            <option value="all">All medicines</option>
            {meds.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {!days.length ? (
        <EmptyState icon="search" title="Nothing to show">
          No {FILTERS.find((f) => f.id === filter).label.toLowerCase()} doses in the last {HISTORY_DAYS} days.
        </EmptyState>
      ) : (
        <>
          {visible.map(({ date, summary: s, shown }) => {
            const mark = dayMarkFromCounts({ taken: s.taken, missed: s.missed, pending: s.toTake, skipped: s.skipped });
            const due = s.total - s.skipped;
            return (
              <section key={date} className="g-day" aria-label={prettyDate(date)}>
                <header className="g-day__head">
                  <h3 className="g-day__title">{date === range.to ? 'Today' : prettyDate(date)}</h3>
                  {due > 0 && (
                    <span className={`g-badge g-badge--${mark === 'taken' ? 'taken' : mark === 'missed' ? 'missed' : mark === 'partial' ? 'overdue' : 'upcoming'}`}>
                      {s.taken}/{due} taken
                    </span>
                  )}
                </header>
                <ul className="g-list">
                  {shown.map((d) => <li key={d.id}><HistoryRow dose={d} opts={opts} /></li>)}
                </ul>
              </section>
            );
          })}
          {more > 0 && (
            <button type="button" className="g-more" onClick={() => setLimit((n) => n + PAGE)}>
              <Icon name="chevron" size={20} />
              Show {Math.min(more, PAGE)} more day{Math.min(more, PAGE) === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function HistoryRow({ dose, opts }) {
  const st = doseState(dose, opts);
  const ui = STATE_UI[st];
  const m = dose.medication || {};
  let detail = null;
  if (st === 'taken' && dose.taken_at) detail = <div className="g-dose__when">Taken at {prettyClock(new Date(dose.taken_at))}</div>;
  else if (st === 'skipped') detail = <div className="g-dose__note">{dose.skip_reason ? `Not today: ${dose.skip_reason}` : 'Marked as not needed'}</div>;
  return (
    <div className={`g-dose g-dose--${ui.tone}`}>
      <span className="g-dose__chip" style={{ background: m.color || 'var(--primary)' }} aria-hidden="true">
        <Icon name={medIcon(m)} size={18} />
      </span>
      <div className="g-dose__main">
        <div className="g-dose__name" translate="no">{m.name || 'Medicine'}</div>
        <div className="g-dose__meta">
          <span>{prettyTime(dose.scheduled_time)} dose</span>
          {m.dose ? <span>{m.dose}</span> : null}
        </div>
        {detail}
      </div>
      <span className={`g-badge g-badge--${ui.tone}`}>
        <Icon name={ui.icon} size={16} /> {ui.label}
      </span>
    </div>
  );
}
