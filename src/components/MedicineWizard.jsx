import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Button, Input, Toggle } from './ui.jsx';
import { useUI } from '../context/UIContext.jsx';
import {
  UNITS, STEP, clampAmount, formatAmount, buildDoseString, parseDose, describeDose,
} from '../lib/doseUnits.js';
import {
  FREQUENCIES, WEEKDAYS, TIME_PRESETS, normaliseTimes, toTimeString,
  describeSchedule, validateMedicine, courseLength,
} from '../lib/schedule.js';
import { searchMedicineNames } from '../lib/medicineNames.js';
import { saveMedication, uploadMedPhoto, medPhotoUrl, recentMedicineNames } from '../lib/db.js';
import { prettyTime } from '../lib/format.js';

// Adding a medicine, as a short guided sheet instead of one dense form.
//
// The old form was: Name, a free-text "Dose" box, a raw native time input, a
// colour and a note. The free-text dose is why a medicine could be saved as
// "dafs", and the native time input is the worst control on the screen for
// someone with shaky hands and long nails. This asks one thing at a time, in
// words, with controls big enough to hit.
//
// Nothing typed is ever thrown away: a draft is kept on the device, validation
// is inline and forgiving, and leaving mid-way and coming back resumes.

const COLORS = ['#2563a8', '#1e7a3d', '#b3261e', '#8a5a00', '#6d28d9', '#0e7490'];
const DRAFT_KEY = 'myday_med_draft';
const STEPS = ['name', 'amount', 'times', 'often', 'extras', 'review'];
const STEP_TITLES = {
  name: 'What is it called?',
  amount: 'How much do you take?',
  times: 'When do you take it?',
  often: 'How often?',
  extras: 'Anything else?',
  review: 'Does this look right?',
};

export function MedicineWizard({ med, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!med?.id;
  const [step, setStep] = useState(0);
  // +1 forward, -1 back: the step transition slides in the direction of travel.
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({});
  const [form, setForm] = useState(() => initialForm(med));
  const [recent, setRecent] = useState([]);

  useEffect(() => { recentMedicineNames().then(setRecent).catch(() => {}); }, []);

  // Draft: only for a NEW medicine. Resuming a half-finished edit of an
  // existing one would silently reapply changes they walked away from.
  useEffect(() => {
    if (editing) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), form })); } catch {}
  }, [form, editing]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const problems = validateMedicine(form);
  const problemFor = (field) => problems.find((p) => p.field === field);

  const stepId = STEPS[step];
  // Which problems block leaving the step currently on screen.
  const blocking = {
    name: ['name'], amount: [], times: ['times'], often: ['days', 'end_date'], extras: [], review: [],
  }[stepId].map(problemFor).filter(Boolean);

  function go(delta) {
    const next = step + delta;
    if (delta > 0 && blocking.length) {
      setTouched((t) => ({ ...t, [stepId]: true }));
      return;
    }
    if (next < 0 || next >= STEPS.length) return;
    setDir(delta);
    setStep(next);
  }

  async function save() {
    if (problems.length) {
      // Jump back to the first step that still needs something, rather than
      // showing an error next to a button they cannot fix from here.
      const first = STEPS.findIndex((id) =>
        ({ name: ['name'], amount: [], times: ['times'], often: ['days', 'end_date'], extras: [], review: [] })[id]
          .some((f) => problemFor(f)));
      setTouched(Object.fromEntries(STEPS.map((s) => [s, true])));
      if (first >= 0) { setDir(-1); setStep(first); }
      return;
    }
    setBusy(true);
    try {
      const dose = buildDoseString(form.dose_amount, form.dose_unit, form.dose_other);
      await saveMedication({
        id: med?.id,
        name: form.name.trim(),
        dose,
        dose_amount: form.dose_amount,
        dose_unit: form.dose_unit,
        dose_other: form.dose_unit === 'other' ? form.dose_other.trim() : null,
        times: normaliseTimes(form.times),
        frequency: form.frequency,
        days_of_week: form.days_of_week,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        with_food: form.with_food,
        note: form.note.trim(),
        color: form.color,
        photo_path: form.photo_path,
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      ui.toast(editing ? 'Medicine updated.' : 'Medicine added.');
      onSaved();
    } catch (e) {
      // Never a dead end, and never lose what they typed.
      ui.toast(e.message || 'Could not save. Your details are still here — please try again.', 'bad');
      setBusy(false);
    }
  }

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return createPortal(
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet--wizard" role="dialog" aria-modal="true"
        aria-label={editing ? 'Edit medicine' : 'Add a medicine'}>
        <div className="sheet__grab" />

        <div className="wiz__head">
          {/* On the first step there is nothing to go back to, and showing a
              second identical ✕ next to Close just invites a mis-tap. */}
          {step === 0
            ? <span className="wiz__headspacer" aria-hidden="true" />
            : (
              <button className="icon-btn" aria-label="Back" onClick={() => go(-1)}>
                <Icon name="back" size={22} />
              </button>
            )}
          <div className="wiz__headmain">
            <span className="wiz__count">Step {step + 1} of {STEPS.length}</span>
            <span className="wiz__title">{STEP_TITLES[stepId]}</span>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={22} /></button>
        </div>

        <div className="wiz__progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
          aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          <div className="wiz__progressfill" style={{ width: `${pct}%` }} />
        </div>

        <AutoHeight dir={dir} step={step}>
          <div className="wiz__body" key={stepId}>
            {stepId === 'name' && (
              <NameStep value={form.name} recent={recent} onChange={(v) => set({ name: v })}
                problem={touched.name && problemFor('name')} />
            )}
            {stepId === 'amount' && <AmountStep form={form} set={set} />}
            {stepId === 'times' && (
              <TimesStep times={form.times} onChange={(t) => set({ times: t })}
                problem={touched.times && problemFor('times')} />
            )}
            {stepId === 'often' && (
              <OftenStep form={form} set={set}
                dayProblem={touched.often && problemFor('days')}
                dateProblem={touched.often && problemFor('end_date')} />
            )}
            {stepId === 'extras' && <ExtrasStep form={form} set={set} />}
            {stepId === 'review' && <ReviewStep form={form} onJump={(id) => { setDir(-1); setStep(STEPS.indexOf(id)); }} />}
          </div>
        </AutoHeight>

        <div className="wiz__foot">
          {/* Inline, gentle, and attached to the thing that is missing. */}
          {!!blocking.length && touched[stepId] && (
            <p className="wiz__err" role="alert">{blocking[0].message}</p>
          )}
          {stepId === 'review' ? (
            <Button size="lg" icon={busy ? 'clock' : 'check'} disabled={busy} onClick={save}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add this medicine'}
            </Button>
          ) : (
            <Button size="lg" onClick={() => go(1)}>Continue</Button>
          )}
          {stepId !== 'review' && (
            <button className="wiz__skip" onClick={() => { setDir(1); setStep(STEPS.length - 1); }}>
              Skip to the summary
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function initialForm(med) {
  // Editing: prefer the structured columns, then fall back to parsing the old
  // free-text dose, then to showing the raw text as "other" so nothing is lost.
  if (med?.id) {
    const parsed = med.dose_amount == null ? parseDose(med.dose) : null;
    return {
      name: med.name || '',
      dose_amount: med.dose_amount ?? parsed?.amount ?? 1,
      dose_unit: med.dose_unit ?? parsed?.unit ?? (med.dose ? 'other' : 'tablet'),
      dose_other: med.dose_other ?? parsed?.otherText ?? (parsed?.parsed ? '' : (med.dose || '')),
      times: med.times?.length ? [...med.times] : ['08:00'],
      frequency: med.frequency || 'daily',
      days_of_week: med.days_of_week?.map(Number) || [],
      start_date: med.start_date || '',
      end_date: med.end_date || '',
      with_food: !!med.with_food,
      note: med.note || '',
      color: med.color || COLORS[0],
      photo_path: med.photo_path || null,
    };
  }
  // New: resume a draft if one is recent enough to still be what they meant.
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (raw?.form && Date.now() - raw.at < 24 * 3600 * 1000) return raw.form;
  } catch {}
  return {
    name: '', dose_amount: 1, dose_unit: 'tablet', dose_other: '',
    times: ['08:00'], frequency: 'daily', days_of_week: [],
    start_date: '', end_date: '', with_food: false, note: '', color: COLORS[0], photo_path: null,
  };
}

/* ------------------------------- 1. name ------------------------------- */

function NameStep({ value, recent, onChange, problem }) {
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => searchMedicineNames(value, recent, 8), [value, recent]);
  const showList = focused && suggestions.length > 0
    && !(suggestions.length === 1 && suggestions[0].name.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="wiz__step">
      <p className="wiz__hint">Start typing and we'll suggest common names. You can type anything you like.</p>
      <div className="ac">
        <Input value={value} onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          // A click on a suggestion has to land before the list closes.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="e.g. Vitamin D" maxLength={80} autoComplete="off"
          aria-label="Medicine name" aria-invalid={!!problem}
          aria-describedby={problem ? 'name-problem' : undefined} />
        {showList && (
          <ul className="ac__list" role="listbox" aria-label="Suggested names">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button type="button" className="ac__item" role="option" aria-selected={false}
                  onClick={() => { onChange(s.name); setFocused(false); }}>
                  <Icon name={s.source === 'recent' ? 'clock' : 'pill'} size={20} />
                  <span>{s.name}</span>
                  {s.source === 'recent' && <span className="ac__tag">on your list</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {problem && <p className="wiz__err" id="name-problem" role="alert">{problem.message}</p>}
    </div>
  );
}

/* ------------------------------ 2. amount ------------------------------ */

function AmountStep({ form, set }) {
  const unit = form.dose_unit;
  const amount = form.dose_amount;
  // mg / IU / ml are typed, not stepped: nobody reaches 1000 IU with a + button.
  const typed = ['mg', 'IU', 'ml'].includes(unit);

  return (
    <div className="wiz__step">
      <p className="wiz__hint">This is the amount you take at one time.</p>

      {typed ? (
        <label className="wiz__field">
          <span className="wiz__label">How many {unit}?</span>
          <Input type="number" inputMode="decimal" min="0" step="any" value={amount}
            onChange={(e) => set({ dose_amount: e.target.value === '' ? '' : Number(e.target.value) })}
            onBlur={() => set({ dose_amount: clampAmount(amount) })}
            className="input input--big" aria-label={`Amount in ${unit}`} />
        </label>
      ) : (
        <div className="stepper" role="group" aria-label="Amount">
          <button type="button" className="stepper__btn" aria-label="Less"
            onClick={() => set({ dose_amount: clampAmount(Number(amount) - STEP) })}>
            <Icon name="minus" size={28} stroke={2.8} />
          </button>
          <div className="stepper__val" aria-live="polite">
            <span className="stepper__n">{formatAmount(amount)}</span>
            <span className="stepper__u">{unit === 'other' ? (form.dose_other || 'unit') : unit}</span>
          </div>
          <button type="button" className="stepper__btn" aria-label="More"
            onClick={() => set({ dose_amount: clampAmount(Number(amount) + STEP) })}>
            <Icon name="plus" size={28} stroke={2.8} />
          </button>
        </div>
      )}

      <span className="wiz__label" style={{ marginTop: 18, display: 'block' }}>What kind?</span>
      <div className="chips">
        {UNITS.map((u) => (
          <button key={u.id} type="button" aria-pressed={unit === u.id}
            className={`chip${unit === u.id ? ' is-on' : ''}`}
            onClick={() => set({ dose_unit: u.id })}>{u.label}</button>
        ))}
      </div>

      {unit === 'other' && (
        <label className="wiz__field" style={{ marginTop: 14 }}>
          <span className="wiz__label">What do you call it?</span>
          <Input value={form.dose_other} onChange={(e) => set({ dose_other: e.target.value })}
            placeholder="e.g. scoop, spray, spoonful" maxLength={30} aria-label="Unit name" />
        </label>
      )}

      <p className="wiz__preview" aria-live="polite">
        You take <b>{describeDose(amount || 1, unit, form.dose_other)}</b> each time.
      </p>
    </div>
  );
}

/* ------------------------------- 3. times ------------------------------ */

function TimesStep({ times, onChange, problem }) {
  const [picking, setPicking] = useState(false);
  const list = normaliseTimes(times);
  const toggle = (t) => onChange(list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);
  const custom = list.filter((t) => !TIME_PRESETS.some((p) => p.time === t));

  return (
    <div className="wiz__step">
      <p className="wiz__hint">Tap the times you take it. Tap again to remove one.</p>

      <div className="timegrid">
        {TIME_PRESETS.map((p) => {
          const on = list.includes(p.time);
          return (
            <button key={p.id} type="button" aria-pressed={on}
              className={`timecard${on ? ' is-on' : ''}`} onClick={() => toggle(p.time)}>
              <span className="timecard__check" aria-hidden="true">
                {on ? <Icon name="check" size={20} stroke={3} /> : null}
              </span>
              <span className="timecard__label">{p.label}</span>
              <span className="timecard__time">{prettyTime(p.time)}</span>
            </button>
          );
        })}
      </div>

      {!!custom.length && (
        <>
          <span className="wiz__label" style={{ marginTop: 16, display: 'block' }}>Your own times</span>
          <div className="chips">
            {custom.map((t) => (
              <button key={t} type="button" className="chip is-on chip--removable"
                onClick={() => toggle(t)} aria-label={`Remove ${prettyTime(t)}`}>
                {prettyTime(t)} <Icon name="close" size={16} stroke={3} />
              </button>
            ))}
          </div>
        </>
      )}

      <Button variant="ghost" icon="plus" onClick={() => setPicking(true)} className="wiz__addtime">
        Add another time
      </Button>

      {problem && <p className="wiz__err" role="alert">{problem.message}</p>}

      {picking && (
        <TimePicker onCancel={() => setPicking(false)}
          onPick={(t) => { setPicking(false); if (!list.includes(t)) onChange([...list, t]); }} />
      )}
    </div>
  );
}

// A big hour/minute picker. The native <input type="time"> is a tiny,
// inconsistent control that is genuinely hard to operate with shaky hands, so
// this is steppers with large targets and the person's own 12/24-hour setting.
function TimePicker({ onPick, onCancel }) {
  const [h, setH] = useState(9);
  const [m, setM] = useState(0);
  const value = toTimeString(h, m);

  const bump = (setter, cur, delta, mod) => setter(((cur + delta) % mod + mod) % mod);

  // Portalled to <body>: the animated step wrapper has a transform, which
  // makes it a containing block for position:fixed, so rendering in place left
  // this overlay clipped inside the step instead of centred on the screen.
  return createPortal(
    <div className="tp-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="tp" role="dialog" aria-modal="true" aria-label="Choose a time">
        <div className="tp__display" aria-live="polite">{prettyTime(value)}</div>
        <div className="tp__wheels">
          <Wheel label="Hour" value={String(h).padStart(2, '0')}
            onUp={() => bump(setH, h, 1, 24)} onDown={() => bump(setH, h, -1, 24)} />
          <span className="tp__colon" aria-hidden="true">:</span>
          <Wheel label="Minute" value={String(m).padStart(2, '0')}
            onUp={() => bump(setM, m, 5, 60)} onDown={() => bump(setM, m, -5, 60)} />
        </div>
        <div className="btn-row" style={{ marginTop: 18 }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onPick(value)}>Use this time</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
function Wheel({ label, value, onUp, onDown }) {
  return (
    <div className="tp__wheel">
      {/* Visibly labelled, not just for screen readers: two identical stepper
          columns side by side are genuinely ambiguous otherwise. */}
      <span className="tp__wheellabel">{label}</span>
      <button type="button" className="tp__arrow" aria-label={`${label} up`} onClick={onUp}>
        <Icon name="chevron" size={26} style={{ transform: 'rotate(-90deg)' }} />
      </button>
      <div className="tp__num" aria-label={label}>{value}</div>
      <button type="button" className="tp__arrow" aria-label={`${label} down`} onClick={onDown}>
        <Icon name="chevron" size={26} style={{ transform: 'rotate(90deg)' }} />
      </button>
    </div>
  );
}

/* ------------------------------- 4. often ------------------------------ */

function OftenStep({ form, set, dayProblem, dateProblem }) {
  const [showDates, setShowDates] = useState(!!(form.start_date || form.end_date));
  const course = courseLength(form);

  return (
    <div className="wiz__step">
      <div className="optlist" role="radiogroup" aria-label="How often">
        {FREQUENCIES.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={form.frequency === f.id}
            className={`opt${form.frequency === f.id ? ' is-on' : ''}`}
            onClick={() => set({ frequency: f.id })}>
            <span className="opt__dot" aria-hidden="true" />
            <span className="opt__main">
              <span className="opt__t">{f.label}</span>
              {f.id === 'as_needed' && <span className="opt__d">No reminders, and never counted as missed</span>}
              {f.id === 'alternate' && <span className="opt__d">One day on, one day off</span>}
            </span>
          </button>
        ))}
      </div>

      {form.frequency === 'days_of_week' && (
        <>
          <span className="wiz__label" style={{ marginTop: 16, display: 'block' }}>Which days?</span>
          <div className="chips">
            {WEEKDAYS.map((d) => {
              const on = form.days_of_week.includes(d.dow);
              return (
                <button key={d.dow} type="button" aria-pressed={on} aria-label={d.label}
                  className={`chip${on ? ' is-on' : ''}`}
                  onClick={() => set({
                    days_of_week: on
                      ? form.days_of_week.filter((x) => x !== d.dow)
                      : [...form.days_of_week, d.dow].sort(),
                  })}>{d.short}</button>
              );
            })}
          </div>
          {dayProblem && <p className="wiz__err" role="alert">{dayProblem.message}</p>}
        </>
      )}

      <button type="button" className="wiz__disclose" aria-expanded={showDates}
        onClick={() => setShowDates((v) => !v)}>
        <Icon name="chevron" size={20} style={{ transform: showDates ? 'rotate(90deg)' : 'none' }} />
        Start and end dates <span className="wiz__optional">optional</span>
      </button>

      {showDates && (
        <div className="wiz__dates">
          <label className="wiz__field">
            <span className="wiz__label">Start on</span>
            <Input type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </label>
          <label className="wiz__field">
            <span className="wiz__label">Stop on</span>
            <Input type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />
          </label>
          {/* "for 10 days" is how a course is actually prescribed. */}
          <div className="chips">
            {[7, 10, 14, 30].map((n) => (
              <button key={n} type="button" className="chip" onClick={() => {
                const start = form.start_date || new Date().toISOString().slice(0, 10);
                const [y, mo, d] = start.split('-').map(Number);
                const end = new Date(Date.UTC(y, mo - 1, d + n - 1)).toISOString().slice(0, 10);
                set({ start_date: start, end_date: end });
              }}>for {n} days</button>
            ))}
          </div>
          {course && <p className="wiz__preview">That is <b>{course.days} days</b>, {course.doses} doses in total.</p>}
          {dateProblem && <p className="wiz__err" role="alert">{dateProblem.message}</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ 5. extras ------------------------------ */

function ExtrasStep({ form, set }) {
  const ui = useUI();
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    if (!form.photo_path) { setPreview(null); return; }
    medPhotoUrl(form.photo_path).then((u) => { if (alive) setPreview(u); }).catch(() => {});
    return () => { alive = false; };
  }, [form.photo_path]);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProgress(0.08);
    try {
      const path = await uploadMedPhoto(file, setProgress);
      set({ photo_path: path });
    } catch (err) {
      ui.toast(err.message || 'Could not add that photo.', 'bad');
    } finally {
      setProgress(0);
    }
  }

  return (
    <div className="wiz__step">
      <p className="wiz__hint">All optional. Skip any of these.</p>

      <div className="wiz__row">
        <span className="wiz__label">Take with food</span>
        <Toggle checked={form.with_food} onChange={(v) => set({ with_food: v })} label="Take with food" />
      </div>

      <label className="wiz__field">
        <span className="wiz__label">A note to yourself</span>
        <Input value={form.note} onChange={(e) => set({ note: e.target.value })}
          placeholder="e.g. the small white one" maxLength={120} />
      </label>

      <span className="wiz__label" style={{ display: 'block', marginTop: 4 }}>Colour on your list</span>
      <div className="swatches">
        {COLORS.map((c) => (
          <button key={c} type="button" className={`swatch${form.color === c ? ' is-active' : ''}`}
            style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={form.color === c}
            onClick={() => set({ color: c })} />
        ))}
      </div>

      <span className="wiz__label" style={{ display: 'block', marginTop: 16 }}>
        A photo of the pill or the box
      </span>
      <p className="wiz__hint" style={{ marginTop: 2 }}>
        Helpful when several of your medicines look alike. Kept private to your account.
      </p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        onChange={pick} style={{ display: 'none' }} />

      {preview ? (
        <div className="medphoto">
          <img src={preview} alt="The medicine you photographed" />
          <div className="medphoto__acts">
            <Button variant="ghost" size="sm" icon="edit" full={false} onClick={() => fileRef.current?.click()}>Replace</Button>
            <Button variant="danger" size="sm" icon="trash" full={false} onClick={() => set({ photo_path: null })}>Remove</Button>
          </div>
        </div>
      ) : progress > 0 ? (
        <div className="uploading">
          <ProgressRing value={progress} />
          <span>Adding your photo…</span>
        </div>
      ) : (
        <Button variant="ghost" icon="plus" onClick={() => fileRef.current?.click()}>Take or choose a photo</Button>
      )}
    </div>
  );
}

function ProgressRing({ value }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="ring" style={{ '--p': pct }} role="progressbar"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
      <b>{pct}%</b>
    </span>
  );
}

/* ------------------------------ 6. review ------------------------------ */

function ReviewStep({ form, onJump }) {
  const dose = buildDoseString(form.dose_amount, form.dose_unit, form.dose_other);
  const schedule = describeSchedule(form, { prettyTime });
  const name = form.name.trim() || 'this medicine';

  return (
    <div className="wiz__step">
      {/* One sentence, in the order a person would say it out loud. */}
      <p className="wiz__summary">
        <b>{dose}</b> of <b>{name}</b>, {schedule}.
      </p>

      <ul className="wiz__check">
        <Line label="Medicine" value={name} onEdit={() => onJump('name')} />
        <Line label="Amount" value={dose} onEdit={() => onJump('amount')} />
        <Line label="Times" onEdit={() => onJump('times')}
          value={form.frequency === 'as_needed'
            ? 'No set times'
            : (normaliseTimes(form.times).map(prettyTime).join(', ') || 'None yet')} />
        <Line label="How often" value={FREQUENCIES.find((f) => f.id === form.frequency)?.label || 'Every day'}
          onEdit={() => onJump('often')} />
        {form.with_food && <Line label="With food" value="Yes" onEdit={() => onJump('extras')} />}
        {form.note.trim() && <Line label="Note" value={form.note.trim()} onEdit={() => onJump('extras')} />}
      </ul>

      {form.frequency === 'as_needed' && (
        <p className="wiz__hint">
          You will not be reminded about this one, and it will never show as missed.
        </p>
      )}
    </div>
  );
}
function Line({ label, value, onEdit }) {
  return (
    <li className="wiz__line">
      <span className="wiz__linelabel">{label}</span>
      <span className="wiz__linevalue">{value}</span>
      <button type="button" className="wiz__lineedit" onClick={onEdit} aria-label={`Change ${label}`}>Change</button>
    </li>
  );
}

/* ----------------------------- transitions ----------------------------- */

// Slides the step in the direction of travel and animates the sheet's height
// so it does not jump between a short step and a tall one. Both effects are
// pure CSS, so Calm screen and reduced motion switch them off wholesale.
function AutoHeight({ children, dir, step }) {
  const inner = useRef(null);
  const [h, setH] = useState('auto');

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setH(`${el.offsetHeight}px`);
    measure();
    // Steps grow when a disclosure opens or a suggestion list appears.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  return (
    <div className="wiz__view" style={{ height: h }}>
      <div ref={inner} className="wiz__slide" data-dir={dir > 0 ? 'fwd' : 'back'} key={step}>
        {children}
      </div>
    </div>
  );
}
