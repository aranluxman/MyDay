import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Button, Input, Toggle } from './ui.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useDialog } from '../hooks/useDialog.js';
import {
  UNITS, STEP, stepAmount, formatAmount, buildDoseString, parseDose, amountValue, isCountable,
  ROUTES, cleanStrength,
} from '../lib/doseUnits.js';
import {
  FREQUENCIES, WEEKDAYS, TIME_PRESETS, normaliseTimes, toTimeString,
  describeSchedule, courseLength, courseEndDate, courseDays, FIELD_STEP,
} from '../lib/schedule.js';
import { searchMedicineNames } from '../lib/medicineNames.js';
import { toMedicationPayload, medicineProblems } from '../lib/medicationPayload.js';
import { saveMedication, uploadMedPhoto, medPhotoUrl, recentMedicineNames, listContacts } from '../lib/db.js';
import { prettyTime, prettyDate, localDateStr } from '../lib/format.js';

// Adding a medicine, as a short guided sheet instead of one dense form.
//
// One thing at a time, in words, with controls big enough to hit. Nothing
// typed is ever thrown away: a draft is kept on the device, and leaving
// mid-way and coming back resumes.
//
// Safety rules this component enforces (each was a real defect):
//   * The amount is exactly what was typed. It is never rounded, snapped or
//     floored; an amount that cannot be stored exactly is refused.
//   * Every way out — Continue, "Skip to the summary", Save, "Add to review" —
//     runs the same whole-draft validation and lands on the field to fix.
//   * Each problem is announced once, by moving focus to the field it belongs
//     to (which reads its linked message). No duplicate alert regions.
//   * It is a real modal: focus is trapped in it, the page behind is inert,
//     Escape closes it (or, inside the time picker, only the picker).

export const COLORS = [
  { hex: '#2563a8', name: 'Blue' },
  { hex: '#1e7a3d', name: 'Green' },
  { hex: '#b3261e', name: 'Red' },
  { hex: '#8a5a00', name: 'Brown' },
  { hex: '#6d28d9', name: 'Purple' },
  { hex: '#0e7490', name: 'Teal' },
];
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
// The element that receives focus when a field has a problem. Inputs get it
// directly; a group of chips has its message focused instead.
const FIELD_FOCUS = {
  name: 'wiz-name', amount: 'wiz-amount', unit: 'wiz-unit-other', times: 'wiz-times-err',
  days: 'wiz-days-err', start_date: 'wiz-start', end_date: 'wiz-end',
};
const errId = (field) => `wiz-${field}-err`;

// `prefill` comes from reading a photo of the label (see MedicinePhotoScan) or
// from "Copy": the fields are filled in and the sheet opens on the review step,
// so the person checks every line before anything is saved.
export function MedicineWizard({ med, prefill, stageDraft, onDraftChange, onStage, onClose, onSaved, onRemove }) {
  const ui = useUI();
  const editing = !!med?.id;
  const staging = !!onStage;
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const titleId = useId();
  const [initial] = useState(() => initialForm(med, prefill?.form, stageDraft?.form, staging));
  const [form, setForm] = useState(initial.form);
  const [step, setStep] = useState(() => stageDraft?.step ?? (prefill && !editing ? STEPS.length - 1 : 0));
  // +1 forward, -1 back: the step transition slides in the direction of travel.
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  // Fields whose problem is on show. A message appears once the person has
  // tried to move on, never while they are still typing the first time.
  const [shown, setShown] = useState(() => (prefill ? new Set(['name', 'amount', 'unit', 'times', 'days', 'start_date', 'end_date']) : new Set()));
  const [recent, setRecent] = useState([]);
  const [resumed, setResumed] = useState(initial.resumed);
  const focusNext = useRef('title');
  const [focusTick, setFocusTick] = useState(0);
  const saving = useRef(false);

  useEffect(() => { recentMedicineNames().then(setRecent).catch(() => {}); }, []);
  useEffect(() => { onDraftChange?.({ form, step }); }, [form, step]);

  // Draft: only for a NEW medicine. Resuming a half-finished edit of an
  // existing one would silently reapply changes they walked away from.
  useEffect(() => {
    if (editing || staging) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), form })); } catch {}
  }, [form, editing, staging]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const problems = medicineProblems(form);
  const problemFor = (field) => (shown.has(field) ? problems.find((p) => p.field === field) : null);
  const stepId = STEPS[step];
  const dirty = JSON.stringify(form) !== JSON.stringify(initial.form);

  // Move focus after the step has rendered: to the field that needs fixing,
  // or to the new step's heading so a screen reader announces where they are.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (!target) return;
    const el = target === 'title' ? titleRef.current : document.getElementById(FIELD_FOCUS[target]);
    (el || titleRef.current)?.focus({ preventScroll: false });
  }, [step, focusTick]);

  function goTo(index, { focus = 'title' } = {}) {
    setDir(index >= step ? 1 : -1);
    focusNext.current = focus;
    setStep(index);
    setFocusTick((n) => n + 1);
  }

  // Shows the first problem (from `fields`, or any) and takes them to it.
  function stopAt(list) {
    const first = list[0];
    setShown((s) => new Set([...s, ...list.map((p) => p.field)]));
    goTo(STEPS.indexOf(FIELD_STEP[first.field] || 'review'), { focus: first.field });
  }

  function next() {
    const here = problems.filter((p) => FIELD_STEP[p.field] === stepId);
    if (here.length) { stopAt(here); return; }
    goTo(step + 1);
  }

  // "Skip to the summary" used to jump straight to review with Save enabled
  // for "on no days yet" / "at no set time". It now checks the whole draft.
  function skipToSummary() {
    if (problems.length) { stopAt(problems); return; }
    goTo(STEPS.length - 1);
  }

  async function save() {
    if (saving.current) return; // a second tap while saving does nothing
    if (problems.length) { stopAt(problems); return; }
    let payload;
    try { payload = toMedicationPayload(form); } catch (e) { ui.toast(e.message, 'bad'); return; }
    if (staging) { onStage(form); return; }
    saving.current = true;
    setBusy(true);
    try {
      await saveMedication({ id: med?.id, ...payload }, editing ? med : null);
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      ui.toast(editing ? `${payload.name} updated: ${payload.dose}.` : `${payload.name} added: ${payload.dose}.`);
      onSaved();
    } catch (e) {
      // Never a dead end, and never lose what they typed.
      ui.toast(e.message || 'Could not save. Your details are still here — please try again.', 'bad');
      saving.current = false;
      setBusy(false);
    }
  }

  // Closing an edit with changes asks first: walking away from a changed
  // dose must be a decision, not an accident. A new medicine keeps its draft.
  async function requestClose() {
    if (busy) return;
    if (editing && dirty) {
      const ok = await ui.confirm({
        title: `Discard changes to ${med.name}?`,
        message: 'Your saved medicine stays exactly as it was.',
        confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true,
      });
      if (!ok) return;
    } else if (!editing && !staging && dirty) {
      ui.toast('Kept on this device — you can finish it later.', 'info');
    }
    onClose();
  }

  function startOver() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setForm(blankForm());
    setShown(new Set());
    setResumed(false);
    goTo(0, { focus: 'name' });
  }

  useDialog(dialogRef, { onEscape: requestClose });
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return createPortal(
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div ref={dialogRef} className="sheet sheet--wizard" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet__grab" aria-hidden="true" />

        <div className="wiz__head">
          {/* On the first step there is nothing to go back to, and showing a
              second identical ✕ next to Close just invites a mis-tap. */}
          {step === 0
            ? <span className="wiz__headspacer" aria-hidden="true" />
            : (
              <button type="button" className="icon-btn" aria-label={`Back to ${STEP_TITLES[STEPS[step - 1]].toLowerCase()}`}
                onClick={() => goTo(step - 1)}>
                <Icon name="back" size={22} />
              </button>
            )}
          <div className="wiz__headmain">
            <span className="wiz__count">
              {editing ? `Editing ${med.name}` : staging ? 'Preparing a medicine' : 'Adding a medicine'} · Step {step + 1} of {STEPS.length}
            </span>
            <h2 className="wiz__title" id={titleId} ref={titleRef} tabIndex={-1}>{STEP_TITLES[stepId]}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}><Icon name="close" size={22} /></button>
        </div>

        <div className="wiz__progress" aria-hidden="true">
          <div className="wiz__progressfill" style={{ width: `${pct}%` }} />
        </div>

        <AutoHeight dir={dir} step={step}>
          <div className="wiz__body" key={stepId}>
            {stepId === 'name' && (
              <>
                {resumed && (
                  <div className="wiz__resume" role="status">
                    <span>We kept what you typed last time.</span>
                    <button type="button" className="linkbtn" onClick={startOver}>Start over</button>
                  </div>
                )}
                <NameStep value={form.name} recent={recent} onChange={(v) => set({ name: v })} problem={problemFor('name')} />
              </>
            )}
            {stepId === 'amount' && <AmountStep form={form} set={set} problem={problemFor('amount')} unitProblem={problemFor('unit')} />}
            {stepId === 'times' && (
              <TimesStep times={form.times} asNeeded={form.frequency === 'as_needed'}
                onChange={(t) => set({ times: t })} problem={problemFor('times')} />
            )}
            {stepId === 'often' && (
              <OftenStep form={form} set={set} dayProblem={problemFor('days')}
                startProblem={problemFor('start_date')} endProblem={problemFor('end_date')} />
            )}
            {stepId === 'extras' && <ExtrasStep form={form} set={set} />}
            {stepId === 'review' && (
              <ReviewStep form={form} scan={editing ? null : prefill} problems={problems}
                onFix={(p) => stopAt([p])} onJump={(id) => goTo(STEPS.indexOf(id))}
                onRemove={editing && onRemove ? () => onRemove(med) : null} medName={med?.name} />
            )}
          </div>
        </AutoHeight>

        <div className="wiz__foot">
          {stepId === 'review' ? (
            <Button size="lg" icon={busy ? 'clock' : 'check'} disabled={busy} aria-disabled={busy || undefined} onClick={save}>
              {busy ? 'Saving…' : editing ? 'Save changes' : staging ? 'Add to review' : 'Add this medicine'}
            </Button>
          ) : (
            <Button size="lg" onClick={next}>Continue</Button>
          )}
          {stepId !== 'review' && (
            <button type="button" className="wiz__skip" onClick={skipToSummary}>
              Skip to the summary
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function blankForm() {
  return {
    name: '', dose_amount: '1', dose_unit: 'tablet', dose_other: '', strength: '', route: '', instructions: '',
    times: ['08:00'], frequency: 'daily', days_of_week: [],
    start_date: '', end_date: '', with_food: false, note: '', color: COLORS[0].hex, photo_path: null,
    stock_quantity: '', refill_threshold: '', pharmacy_contact_id: '', prescriber_contact_id: '',
  };
}

// Amounts live in the form as the text in the box, so "1 1/2" or "0.125"
// is shown back exactly as it will be saved.
const amountText = (n, unit) => (n == null || n === '' ? '' : typeof n === 'string' ? n : formatAmount(n, unit));

function initialForm(med, fromPhoto, stagedForm, staging) {
  const blank = blankForm();
  // Editing: prefer the structured columns, then fall back to parsing the old
  // free-text dose, then to showing the raw text as "other" so nothing is lost.
  if (med?.id) {
    const parsed = med.dose_amount == null ? parseDose(med.dose) : null;
    const unit = med.dose_unit ?? parsed?.unit ?? (med.dose ? 'other' : 'tablet');
    return {
      resumed: false,
      form: {
        ...blank,
        name: med.name || '',
        dose_amount: amountText(med.dose_amount != null ? Number(med.dose_amount) : parsed?.amount ?? '', unit),
        dose_unit: unit,
        dose_other: med.dose_other ?? parsed?.otherText ?? (parsed?.parsed ? '' : (med.dose || '')),
        strength: med.strength || '',
        route: med.route || '',
        instructions: med.instructions || '',
        times: med.times?.length ? [...med.times] : [],
        frequency: med.frequency || 'daily',
        days_of_week: med.days_of_week?.map(Number) || [],
        start_date: med.start_date || '',
        end_date: med.end_date || '',
        with_food: !!med.with_food,
        note: med.note || '',
        color: med.color || COLORS[0].hex,
        photo_path: med.photo_path || null,
        stock_quantity: med.stock_quantity ?? '',
        refill_threshold: med.refill_threshold ?? '',
        pharmacy_contact_id: med.pharmacy_contact_id || '',
        prescriber_contact_id: med.prescriber_contact_id || '',
      },
    };
  }
  // Rows from the database (a copy) or the scanner carry null for empty text;
  // the form works with strings, so nulls become '' rather than crashing.
  const withAmount = (f) => {
    const out = { ...f, dose_amount: amountText(f.dose_amount, f.dose_unit) };
    for (const k of Object.keys(blank)) if (out[k] == null && typeof blank[k] === 'string') out[k] = '';
    if (!Array.isArray(out.times)) out.times = [];
    if (!Array.isArray(out.days_of_week)) out.days_of_week = [];
    return out;
  };
  if (stagedForm) return { resumed: false, form: withAmount({ ...blank, ...stagedForm }) };
  // Read from a photo or copied: that wins over any old draft.
  if (fromPhoto) return { resumed: false, form: withAmount({ ...blank, ...fromPhoto }) };
  if (staging) return { resumed: false, form: blank };
  // New: resume a draft if one is recent enough to still be what they meant.
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (raw?.form && Date.now() - raw.at < 24 * 3600 * 1000) {
      return { resumed: true, form: withAmount({ ...blank, ...raw.form }) };
    }
  } catch {}
  return { resumed: false, form: blank };
}

/** A visible error, linked to its field by id. Focusable so a group's message can take focus. */
function FieldError({ field, problem }) {
  if (!problem) return null;
  return (
    <p className="wiz__err" id={errId(field)} tabIndex={-1}>
      <Icon name="alert" size={18} /> <span>{problem.message}</span>
    </p>
  );
}

/* ------------------------------- 1. name ------------------------------- */

function NameStep({ value, recent, onChange, problem }) {
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => searchMedicineNames(value, recent, 8), [value, recent]);
  const showList = focused && suggestions.length > 0
    && !(suggestions.length === 1 && suggestions[0].name.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="wiz__step">
      <label className="wiz__label" htmlFor="wiz-name">Medicine name</label>
      <p className="wiz__hint" id="wiz-name-hint">Start typing and we'll suggest common names. You can type anything you like.</p>
      <div className="ac">
        <Input id="wiz-name" value={value} onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          // A click on a suggestion has to land before the list closes.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="e.g. Vitamin D" maxLength={80} autoComplete="off" enterKeyHint="next"
          aria-invalid={!!problem} aria-describedby={problem ? `${errId('name')} wiz-name-hint` : 'wiz-name-hint'} />
        {showList && (
          <ul className="ac__list" aria-label="Suggested names">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button type="button" className="ac__item"
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
      <FieldError field="name" problem={problem} />
    </div>
  );
}

/* ------------------------------ 2. amount ------------------------------ */

function AmountStep({ form, set, problem, unitProblem }) {
  const unit = form.dose_unit;
  const countable = isCountable(unit) && unit !== 'other' ? true : unit === 'other';
  const unitLabel = unit === 'other' ? (form.dose_other || 'unit') : UNITS.find((u) => u.id === unit)?.plural || unit;
  const preview = buildDoseString(form.dose_amount, unit, form.dose_other);
  const describedBy = [problem ? errId('amount') : null, 'wiz-amount-hint'].filter(Boolean).join(' ');

  function bump(delta) {
    const n = stepAmount(amountValue(form.dose_amount) ?? 0, delta);
    set({ dose_amount: formatAmount(n, unit) });
  }

  return (
    <div className="wiz__step">
      <label className="wiz__label" htmlFor="wiz-amount">Amount you take each time</label>
      <div className={`amountbox${problem ? ' is-invalid' : ''}`}>
        {countable && (
          <button type="button" className="stepper__btn" aria-label={`${STEP} less`} onClick={() => bump(-STEP)}>
            <Icon name="minus" size={26} stroke={2.8} />
          </button>
        )}
        <input id="wiz-amount" className="input input--big amountbox__input" type="text" inputMode="decimal"
          autoComplete="off" enterKeyHint="done" value={String(form.dose_amount ?? '')}
          onChange={(e) => set({ dose_amount: e.target.value })}
          aria-invalid={!!problem} aria-describedby={describedBy} />
        <span className="amountbox__unit" aria-hidden="true">{unitLabel}</span>
        {countable && (
          <button type="button" className="stepper__btn" aria-label={`${STEP} more`} onClick={() => bump(STEP)}>
            <Icon name="plus" size={26} stroke={2.8} />
          </button>
        )}
      </div>
      <p className="wiz__hint" id="wiz-amount-hint">Type it exactly as the label says, like 2.5, 0.125 or 1/2. We never round it.</p>
      <FieldError field="amount" problem={problem} />

      <span className="wiz__label" id="wiz-unit-label" style={{ marginTop: 18, display: 'block' }}>What kind?</span>
      <div className="chips" role="group" aria-labelledby="wiz-unit-label">
        {UNITS.map((u) => (
          <button key={u.id} type="button" aria-pressed={unit === u.id}
            className={`chip${unit === u.id ? ' is-on' : ''}`}
            onClick={() => set({ dose_unit: u.id })}>{u.label}</button>
        ))}
      </div>

      {unit === 'other' && (
        <div className="wiz__field" style={{ marginTop: 14 }}>
          <label className="wiz__label" htmlFor="wiz-unit-other">What do you call it?</label>
          <Input id="wiz-unit-other" value={form.dose_other} onChange={(e) => set({ dose_other: e.target.value })}
            placeholder="e.g. scoop, spray, spoonful" maxLength={30}
            aria-invalid={!!unitProblem} aria-describedby={unitProblem ? errId('unit') : undefined} />
          <FieldError field="unit" problem={unitProblem} />
        </div>
      )}

      <p className="wiz__preview" aria-live="polite">
        {preview ? <>You take <b>{preview}</b> each time.</> : 'Enter the amount to see it here.'}
      </p>

      <div className="wiz__group">
        <label className="wiz__label" htmlFor="wiz-strength">Strength printed on the box <span className="wiz__optional">optional</span></label>
        <Input id="wiz-strength" value={form.strength || ''} onChange={(e) => set({ strength: e.target.value })}
          placeholder="e.g. 5 mg, or 250 mg / 5 mL" maxLength={40} aria-describedby="wiz-strength-hint" />
        <p className="wiz__hint" id="wiz-strength-hint">
          What one {countable && unit !== 'other' ? UNITS.find((u) => u.id === unit)?.label : 'dose'} contains. This is not how much you take — that is the amount above.
        </p>
      </div>
      <div className="wiz__group">
        <label className="wiz__label" htmlFor="wiz-route">How you take it <span className="wiz__optional">optional</span></label>
        <select id="wiz-route" className="input input--select" value={form.route || ''} onChange={(e) => set({ route: e.target.value })}>
          <option value="">Not set</option>
          {ROUTES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ------------------------------- 3. times ------------------------------ */

function TimesStep({ times, asNeeded, onChange, problem }) {
  const [picking, setPicking] = useState(false);
  const list = normaliseTimes(times);
  const toggle = (t) => onChange(list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);
  const custom = list.filter((t) => !TIME_PRESETS.some((p) => p.time === t));

  return (
    <div className="wiz__step">
      <p className="wiz__hint" id="wiz-times-hint">
        {asNeeded
          ? 'This medicine is "only when needed", so times are optional.'
          : 'Tap the times you take it. Tap again to remove one.'}
      </p>

      <div className="timegrid" role="group" aria-label="Times of day" aria-describedby={problem ? errId('times') : 'wiz-times-hint'}>
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
          <span className="wiz__label" style={{ marginTop: 16, display: 'block' }} id="wiz-own-times">Your own times</span>
          <div className="chips" role="group" aria-labelledby="wiz-own-times">
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

      <FieldError field="times" problem={problem} />

      {picking && (
        <TimePicker existing={list} onCancel={() => setPicking(false)}
          onPick={(t) => { setPicking(false); onChange([...list, t]); }} />
      )}
    </div>
  );
}

// Choosing a time. Any minute can be entered — a prescription for 7:10 is
// real — either by typing into the device's own time field or with large
// hour/minute buttons. AM/PM is shown in words. A time already on the list is
// refused here, so duplicates cannot be created.
export function TimePicker({ onPick, onCancel, existing = [], initial = '09:00', title = 'Choose a time' }) {
  const [h0, m0] = initial.split(':').map(Number);
  const [h, setH] = useState(h0);
  const [m, setM] = useState(m0);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const typedRef = useRef(null);
  const tId = useId();
  const value = toTimeString(h, m);
  useDialog(ref, { onEscape: onCancel, initialFocus: typedRef });

  const wrap = (v, mod) => ((v % mod) + mod) % mod;
  const setHour = (v) => { setError(''); setH(wrap(v, 24)); };
  const setMinute = (v) => { setError(''); setM(wrap(v, 60)); };
  const pm = h >= 12;

  function use() {
    if (existing.includes(value)) { setError(`${prettyTime(value)} is already on your list.`); return; }
    onPick(value);
  }

  // Portalled to <body>: the animated step wrapper has a transform, which
  // makes it a containing block for position:fixed.
  return createPortal(
    <div className="tp-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} className="tp" role="dialog" aria-modal="true" aria-labelledby={tId}>
        <h2 className="tp__title" id={tId}>{title}</h2>
        <div className="tp__display" aria-live="polite">{prettyTime(value)}</div>

        <label className="wiz__label" htmlFor="tp-typed">Type a time</label>
        <input id="tp-typed" ref={typedRef} type="time" step="60" className="input input--big tp__typed" value={value}
          onChange={(e) => {
            const [hh, mm] = String(e.target.value || '').split(':').map(Number);
            if (Number.isFinite(hh) && Number.isFinite(mm)) { setHour(hh); setMinute(mm); }
          }} />

        <div className="tp__wheels">
          <Wheel label="Hour" value={String(h).padStart(2, '0')} onUp={() => setHour(h + 1)} onDown={() => setHour(h - 1)} />
          <span className="tp__colon" aria-hidden="true">:</span>
          <Wheel label="Minute" value={String(m).padStart(2, '0')} onUp={() => setMinute(m + 1)} onDown={() => setMinute(m - 1)} />
        </div>
        <div className="tp__quick" role="group" aria-label="Morning or afternoon">
          <button type="button" className={`chip${!pm ? ' is-on' : ''}`} aria-pressed={!pm} onClick={() => pm && setHour(h - 12)}>AM (morning)</button>
          <button type="button" className={`chip${pm ? ' is-on' : ''}`} aria-pressed={pm} onClick={() => !pm && setHour(h + 12)}>PM (afternoon/evening)</button>
        </div>
        <div className="tp__quick" role="group" aria-label="Minutes">
          {[0, 15, 30, 45].map((q) => (
            <button key={q} type="button" className={`chip${m === q ? ' is-on' : ''}`} aria-pressed={m === q}
              onClick={() => setMinute(q)}>:{String(q).padStart(2, '0')}</button>
          ))}
        </div>
        {error && <p className="wiz__err" role="alert"><Icon name="alert" size={18} /> <span>{error}</span></p>}
        <div className="btn-row" style={{ marginTop: 18 }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={use}>Use {prettyTime(value)}</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
function Wheel({ label, value, onUp, onDown }) {
  return (
    <div className="tp__wheel" role="group" aria-label={label}>
      {/* Visibly labelled, not just for screen readers: two identical stepper
          columns side by side are genuinely ambiguous otherwise. */}
      <span className="tp__wheellabel" aria-hidden="true">{label}</span>
      <button type="button" className="tp__arrow" aria-label={`${label} up, now ${value}`} onClick={onUp}>
        <Icon name="chevron" size={26} style={{ transform: 'rotate(-90deg)' }} />
      </button>
      <div className="tp__num" aria-hidden="true">{value}</div>
      <button type="button" className="tp__arrow" aria-label={`${label} down, now ${value}`} onClick={onDown}>
        <Icon name="chevron" size={26} style={{ transform: 'rotate(90deg)' }} />
      </button>
    </div>
  );
}

/* ------------------------------- 4. often ------------------------------ */

function RadioCards({ label, options, value, onChange }) {
  const refs = useRef([]);
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  function onKeyDown(e) {
    const n = options.length;
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + n) % n;
    if (next == null) return;
    e.preventDefault();
    onChange(options[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div className="optlist" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((f, i) => (
        <button key={f.id} type="button" role="radio" aria-checked={value === f.id} tabIndex={value === f.id ? 0 : -1}
          ref={(el) => { refs.current[i] = el; }}
          className={`opt${value === f.id ? ' is-on' : ''}`} onClick={() => onChange(f.id)}>
          <span className="opt__dot" aria-hidden="true" />
          <span className="opt__main">
            <span className="opt__t">{f.label}</span>
            {f.desc && <span className="opt__d">{f.desc}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

const FREQ_DESC = {
  as_needed: 'No reminders, and never counted as missed',
  alternate: 'One day on, one day off, counted from the start date',
};

function OftenStep({ form, set, dayProblem, startProblem, endProblem }) {
  const [showDates, setShowDates] = useState(!!(form.start_date || form.end_date || startProblem || endProblem));
  const course = courseLength(form);

  return (
    <div className="wiz__step">
      <RadioCards label="How often" value={form.frequency}
        options={FREQUENCIES.map((f) => ({ ...f, desc: FREQ_DESC[f.id] }))}
        onChange={(v) => set({ frequency: v })} />

      {form.frequency === 'days_of_week' && (
        <>
          <span className="wiz__label" id="wiz-days-label" style={{ marginTop: 16, display: 'block' }}>Which days?</span>
          <div className="chips" role="group" aria-labelledby="wiz-days-label" aria-describedby={dayProblem ? errId('days') : undefined}>
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
          <FieldError field="days" problem={dayProblem} />
        </>
      )}
      {form.frequency === 'alternate' && !form.start_date && (
        <p className="wiz__hint">Counted from today unless you set a start date below.</p>
      )}

      <button type="button" className="wiz__disclose" aria-expanded={showDates} aria-controls="wiz-dates"
        onClick={() => setShowDates((v) => !v)}>
        <Icon name="chevron" size={20} style={{ transform: showDates ? 'rotate(90deg)' : 'none' }} />
        Start and stop dates <span className="wiz__optional">optional</span>
      </button>

      {showDates && (
        <div className="wiz__dates" id="wiz-dates">
          <div className="wiz__field">
            <label className="wiz__label" htmlFor="wiz-start">Start on</label>
            <Input id="wiz-start" type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })}
              aria-invalid={!!startProblem} aria-describedby={startProblem ? errId('start_date') : undefined} />
            <FieldError field="start_date" problem={startProblem} />
          </div>
          <div className="wiz__field">
            <label className="wiz__label" htmlFor="wiz-end">Stop after</label>
            <Input id="wiz-end" type="date" value={form.end_date} min={form.start_date || undefined}
              onChange={(e) => set({ end_date: e.target.value })}
              aria-invalid={!!endProblem} aria-describedby={endProblem ? errId('end_date') : undefined} />
            <FieldError field="end_date" problem={endProblem} />
          </div>
          {/* "for 10 days" is how a course is actually prescribed. Day one is
              the start date, so 10 days from Oct 12 stops after Oct 21. */}
          <div className="chips" role="group" aria-label="Course length">
            {[7, 10, 14, 30].map((n) => (
              <button key={n} type="button" className="chip" onClick={() => {
                const start = form.start_date || localDateStr();
                set({ start_date: start, end_date: courseEndDate(start, n) });
              }}>for {n} days</button>
            ))}
            {(form.start_date || form.end_date) && (
              <button type="button" className="chip" onClick={() => set({ start_date: '', end_date: '' })}>No dates</button>
            )}
          </div>
          {course && course.calendarDays && (
            <p className="wiz__preview">
              {prettyDate(form.start_date)} to {prettyDate(form.end_date)}: <b>{course.calendarDays} days</b>
              {form.frequency !== 'as_needed' && <>, {course.doses} doses in total</>}.
            </p>
          )}
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
  const [contacts, setContacts] = useState([]);
  const fileRef = useRef(null);
  const unit = UNITS.find((u) => u.id === form.dose_unit);
  const stockWord = form.dose_unit === 'other' ? (form.dose_other || 'doses') : unit?.plural || 'doses';

  useEffect(() => { listContacts().then(setContacts).catch(() => {}); }, []);
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

  const pharmacies = contacts.filter((c) => c.type === 'pharmacy');
  const prescribers = contacts.filter((c) => c.type === 'provider' || c.type === 'clinic');

  return (
    <div className="wiz__step">
      <p className="wiz__hint">All optional. Skip any of these.</p>

      <div className="wiz__row">
        <span className="wiz__label" id="wiz-food-label">Take with food</span>
        <Toggle checked={form.with_food} onChange={(v) => set({ with_food: v })} labelledBy="wiz-food-label" />
      </div>

      <div className="wiz__field">
        <label className="wiz__label" htmlFor="wiz-instructions">Directions from the label</label>
        <Input id="wiz-instructions" value={form.instructions || ''} onChange={(e) => set({ instructions: e.target.value })}
          placeholder="e.g. Swallow whole. Avoid grapefruit." maxLength={200} />
      </div>

      <div className="wiz__field">
        <label className="wiz__label" htmlFor="wiz-note">A note to yourself</label>
        <Input id="wiz-note" value={form.note} onChange={(e) => set({ note: e.target.value })}
          placeholder="e.g. the small white one" maxLength={120} />
      </div>

      <span className="wiz__label" id="wiz-colour-label" style={{ display: 'block', marginTop: 4 }}>Colour on your list</span>
      <div className="swatches" role="radiogroup" aria-labelledby="wiz-colour-label">
        {COLORS.map((c) => (
          <button key={c.hex} type="button" role="radio" aria-checked={form.color === c.hex}
            className={`swatch${form.color === c.hex ? ' is-active' : ''}`}
            style={{ background: c.hex }} aria-label={c.name} title={c.name}
            onClick={() => set({ color: c.hex })}>
            {form.color === c.hex && <Icon name="check" size={20} stroke={3} />}
          </button>
        ))}
      </div>

      <fieldset className="wiz__fieldset">
        <legend className="wiz__label">Supply and refills <span className="wiz__optional">optional</span></legend>
        <p className="wiz__hint" style={{ marginTop: 0 }}>
          Counted down only when you mark a dose taken. You can always log a dose even if this is blank.
        </p>
        <div className="wiz__two">
          <div className="wiz__field">
            <label className="wiz__label" htmlFor="wiz-stock">{capital(stockWord)} you have now</label>
            <Input id="wiz-stock" type="text" inputMode="decimal" value={String(form.stock_quantity ?? '')}
              onChange={(e) => set({ stock_quantity: e.target.value.replace(/[^\d.]/g, '') })} />
          </div>
          <div className="wiz__field">
            <label className="wiz__label" htmlFor="wiz-refill">Remind me to refill at</label>
            <Input id="wiz-refill" type="text" inputMode="decimal" value={String(form.refill_threshold ?? '')}
              onChange={(e) => set({ refill_threshold: e.target.value.replace(/[^\d.]/g, '') })} />
          </div>
        </div>
        {!!pharmacies.length && (
          <div className="wiz__field">
            <label className="wiz__label" htmlFor="wiz-pharmacy">Pharmacy</label>
            <select id="wiz-pharmacy" className="input input--select" value={form.pharmacy_contact_id || ''}
              onChange={(e) => set({ pharmacy_contact_id: e.target.value })}>
              <option value="">Not set</option>
              {pharmacies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {!!prescribers.length && (
          <div className="wiz__field">
            <label className="wiz__label" htmlFor="wiz-prescriber">Prescriber</label>
            <select id="wiz-prescriber" className="input input--select" value={form.prescriber_contact_id || ''}
              onChange={(e) => set({ prescriber_contact_id: e.target.value })}>
              <option value="">Not set</option>
              {prescribers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </fieldset>

      <span className="wiz__label" style={{ display: 'block', marginTop: 16 }}>
        A photo of the pill or the box
      </span>
      <p className="wiz__hint" style={{ marginTop: 2 }}>
        Helpful when several of your medicines look alike. Kept private to your account.
      </p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        onChange={pick} style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />

      {preview ? (
        <div className="medphoto">
          <img src={preview} alt="The medicine you photographed" />
          <div className="medphoto__acts">
            <Button variant="ghost" size="sm" icon="edit" full={false} onClick={() => fileRef.current?.click()}>Replace photo</Button>
            <Button variant="danger" size="sm" icon="trash" full={false} onClick={() => set({ photo_path: null })}>Remove photo</Button>
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
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

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

function ReviewStep({ form, scan, problems, onFix, onJump, onRemove, medName }) {
  const dose = buildDoseString(form.dose_amount, form.dose_unit, form.dose_other);
  const schedule = describeSchedule(form, { prettyTime });
  const name = form.name.trim() || 'this medicine';
  const route = ROUTES.find((r) => r.id === form.route)?.label;
  const strength = cleanStrength(form.strength);
  const days = courseDays(form.start_date, form.end_date);

  return (
    <div className="wiz__step">
      {scan?.copiedFrom && (
        <div className="aiscan-note" role="status">
          <Icon name="info" size={20} />
          <div><b>This is a copy of {scan.copiedFrom}.</b> Nothing is saved yet. Check every line and change what is different.</div>
        </div>
      )}
      {scan && !scan.copiedFrom && (
        <div className={`aiscan-note${scan.confidence === 'low' || scan.warnings?.length ? ' aiscan-note--warn' : ''}`} role="status">
          <Icon name="sparkle" size={20} />
          <div>
            <b>Filled in from your {scan.photoCount > 1 ? `${scan.photoCount} photos` : 'photo'}.</b> Please check each line against the label and tap
            Change to fix anything.
            {!!scan.warnings?.length && (
              <ul className="aiscan-note__list">
                {scan.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* One summary of what still blocks saving; each entry takes them to the field. */}
      {!!problems.length && (
        <div className="wiz__problems" id="wiz-problems">
          <p className="wiz__problems-t"><Icon name="alert" size={20} /> {problems.length === 1 ? 'One thing to fix before saving' : `${problems.length} things to fix before saving`}</p>
          <ul>
            {problems.map((p) => (
              <li key={p.field}><button type="button" className="linkbtn" onClick={() => onFix(p)}>{p.message}</button></li>
            ))}
          </ul>
        </div>
      )}

      {!problems.length && (
        <p className="wiz__summary">
          <b>{dose}</b> of <b translate="no">{name}</b>, {schedule}.
        </p>
      )}

      <ul className="wiz__check">
        <Line label="Medicine" value={name} onEdit={() => onJump('name')} />
        <Line label="Amount each time" value={dose || 'Not set'} onEdit={() => onJump('amount')} />
        {strength && <Line label="Strength on the box" value={strength} onEdit={() => onJump('amount')} />}
        {route && <Line label="How you take it" value={route} onEdit={() => onJump('amount')} />}
        <Line label="Times" onEdit={() => onJump('times')}
          value={normaliseTimes(form.times).map(prettyTime).join(', ') || (form.frequency === 'as_needed' ? 'No set times' : 'None chosen')} />
        <Line label="How often" value={FREQUENCIES.find((f) => f.id === form.frequency)?.label || 'Every day'}
          onEdit={() => onJump('often')} />
        <Line label="Starts" value={form.start_date ? prettyDate(form.start_date) : 'Straight away'} onEdit={() => onJump('often')} />
        <Line label="Stops" value={form.end_date ? `After ${prettyDate(form.end_date)}` : 'No end date'} onEdit={() => onJump('often')} />
        {days && <Line label="Length" value={`${days} day${days === 1 ? '' : 's'}`} onEdit={() => onJump('often')} />}
        {form.with_food && <Line label="With food" value="Yes" onEdit={() => onJump('extras')} />}
        {form.instructions?.trim() && <Line label="Directions" value={form.instructions.trim()} onEdit={() => onJump('extras')} />}
        {form.note.trim() && <Line label="Note" value={form.note.trim()} onEdit={() => onJump('extras')} />}
        {String(form.stock_quantity ?? '') !== '' && <Line label="Supply" value={`${form.stock_quantity} left`} onEdit={() => onJump('extras')} />}
      </ul>

      {form.frequency === 'as_needed' && (
        <p className="wiz__hint">
          You will not be reminded about this one, and it will never show as missed. Log it from Today when you take one.
        </p>
      )}

      {onRemove && (
        <div className="wiz__danger">
          <Button variant="danger" icon="trash" onClick={onRemove}>Remove {medName}</Button>
          <p className="wiz__hint">Your past doses are kept. You can undo straight after.</p>
        </div>
      )}
    </div>
  );
}
function Line({ label, value, onEdit }) {
  return (
    <li className="wiz__line">
      <span className="wiz__linelabel">{label}</span>
      <span className="wiz__linevalue">{value}</span>
      <button type="button" className="wiz__lineedit" onClick={onEdit} aria-label={`Change ${label.toLowerCase()}`}>Change</button>
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
    if (!el) return undefined;
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
