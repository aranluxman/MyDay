import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { TimePicker } from './MedicineWizard.jsx';
import { prettyTime, prettyClock } from '../lib/format.js';
import { doseState, canMarkTaken, unlocksAt, STATE_UI } from '../lib/doseState.js';
import { medIcon } from '../lib/medIcon.js';

// Fixed choices, not a text box. "I already took it" is recorded as taken
// via "I took it earlier"; it is not a reason to skip.
const SKIP_REASONS = ['Doctor said to stop', 'I felt unwell', 'I ran out'];

// One dose as a single calm row: the medicine, how much, when, and one button
// on the right. State comes from doseState(), the same function Home, the
// calendar and the guardian dashboard use, so this row can never disagree
// with the counters elsewhere.
//
// Everything that is not "take it now" — "I took it earlier", "Not today",
// the instructions, why a later dose cannot be marked yet — sits one tap
// away: tap the medicine to open it. `simple` (Home) leaves that out, and
// `readOnly` (a past day in History) shows the record only.
export function DoseRow({ dose, actions, windowMinutes, simple, readOnly }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const m = dose.medication || {};
  const st = doseState(dose, { windowMinutes });
  const ui = STATE_UI[st];
  const markable = canMarkTaken(dose, { windowMinutes });
  const unlock = unlocksAt(dose);
  const busy = actions?.pending.has(dose.id);
  const name = dose.name_snapshot || m.name || 'Medicine';
  // What was recorded at the time, if the medicine has been edited since.
  const doseText = dose.dose_snapshot || m.dose;
  const time = prettyTime(dose.scheduled_time);
  const settled = st === 'taken' || st === 'skipped';
  const expandable = !simple && !readOnly;
  const detailsId = `dose-more-${dose.id}`;
  // Colour plus an icon plus a word, never colour alone: the states that need
  // noticing get a chip of their own under the time.
  const flag = ['missed', 'overdue', 'due', 'skipped'].includes(st);

  const main = (
    <>
      <span className="drow__ic" style={{ '--med': m.color || '#2563a8' }} aria-hidden="true"><Icon name={medIcon(m)} size={22} /></span>
      <span className="drow__main">
        <span className="drow__name" translate="no">{name}</span>
        {doseText && <span className="drow__dose">{doseText}{m.strength ? ` · ${m.strength} strength` : ''}</span>}
        <span className="drow__time">
          <Icon name="clock" size={17} /> <span>{time}{st === 'taken' && dose.taken_at ? ` · taken ${prettyClock(new Date(dose.taken_at))}` : ''}</span>
          {expandable && <Icon name="chevron" size={18} className={`drow__chev${open ? ' is-open' : ''}`} />}
        </span>
        {flag && <span className={`drow__flag drow__flag--${ui.tone}`}><Icon name={ui.icon} size={14} stroke={2.6} /> {ui.label}</span>}
      </span>
    </>
  );

  let action = null;
  if (st === 'taken') {
    action = <span className="drow__done"><span className="drow__tick"><Icon name="check" size={18} stroke={2.8} /></span>Taken</span>;
  } else if (!readOnly && markable) {
    action = (
      <button type="button" className="drow__take" disabled={busy}
        aria-label={`Take ${name}, ${time} dose`} onClick={() => actions.take(dose)}>
        <Icon name={busy ? 'clock' : 'pill'} size={20} /> {busy ? 'Saving…' : 'Take'}
      </button>
    );
  } else if (expandable && !settled) {
    // Not open to marking yet: the quieter outline button opens the row,
    // which says when it will be.
    action = (
      <button type="button" className="drow__take drow__take--later" aria-expanded={open} aria-controls={detailsId}
        aria-label={`Take ${name}, ${time} dose — not due yet, show when`} onClick={() => setOpen((v) => !v)}>
        <Icon name="pill" size={20} /> Take
      </button>
    );
  }

  return (
    <li className={`drow drow--${ui.tone}${open ? ' is-open' : ''}`}>
      <div className="drow__row">
        {expandable
          ? <button type="button" className="drow__btn" aria-expanded={open} aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}>{main}<span className="sr-only">: more options</span></button>
          : <div className="drow__btn">{main}</div>}
        {action && <div className="drow__act">{action}</div>}
      </div>

      {expandable && open && (
        <div className="drow__more" id={detailsId}>
          {st === 'skipped' && (
            <p className="drow__note">{dose.skip_reason ? `Not today: ${dose.skip_reason}` : 'Marked as not needed today'}</p>
          )}
          {m.instructions && <p className="drow__note">{m.instructions}</p>}
          {m.note && <p className="drow__note">{m.note}</p>}
          {!settled && !markable && (
            // A status, not an instruction, so it never looks like a stuck button.
            <div className="dose__locked" role="status">
              <span className="dose__locked-ic" aria-hidden="true"><Icon name="clock" size={20} /></span>
              <span>
                <b>{unlock ? `Available at ${prettyClock(unlock)}` : 'Not due yet'}</b>
                <small>Nothing to do until then.</small>
              </span>
            </div>
          )}
          {!settled && !asking && (
            <div className="drow__opts">
              {markable && (
                <button type="button" className="dose__skip" disabled={busy} onClick={() => setEarlier(true)}>
                  <Icon name="clock" size={18} /> I took it earlier
                </button>
              )}
              <button type="button" className="dose__skip" disabled={busy} onClick={() => setAsking(true)}>
                <Icon name="minus" size={18} /> Not today
              </button>
            </div>
          )}
          {!settled && asking && (
            <div className="dose__why">
              <p className="dose__whyq" id={`why-${dose.id}`}>Why not today?</p>
              <div className="dose__reasons" role="group" aria-labelledby={`why-${dose.id}`}>
                {SKIP_REASONS.map((r) => (
                  <button type="button" key={r} className="dose__reason"
                    onClick={() => { setAsking(false); actions.skip(dose, r); }}>{r}</button>
                ))}
                <button type="button" className="dose__reason"
                  onClick={() => { setAsking(false); actions.skip(dose, ''); }}>Another reason</button>
              </div>
              <button type="button" className="dose__skip" onClick={() => setAsking(false)}>Never mind</button>
            </div>
          )}
        </div>
      )}
      {earlier && (
        <TimePicker title="When did you take it?" initial={dose.scheduled_time}
          onCancel={() => setEarlier(false)}
          onPick={(t) => { setEarlier(false); actions.take(dose, takenTimeFor(dose, t)); }} />
      )}
    </li>
  );
}

// The chosen clock time on the dose's own day, never later than now.
function takenTimeFor(dose, hhmm) {
  const [y, mo, d] = dose.dose_date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const at = new Date(y, mo - 1, d, h, m, 0, 0).getTime();
  return new Date(Math.min(at, Date.now())).toISOString();
}
