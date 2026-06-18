// Medications: today's doses (with the big Done tap) + manage the medicine list.
import { html, useState, Fragment } from './react.js';
import { Button, Card, Pill, Icon, Spinner, Modal, Field, EmptyState, useUI, useAsync } from './ui.js';
import {
  listMedications, saveMedication, deleteMedication,
  refreshDoses, todaysDoses, markDoseTaken, deviceTimezone, prettyTime, prettyClock,
} from './db.js';

const MAX_MEDS = 3;

export function Medications() {
  const ui = useUI();
  const [editing, setEditing] = useState(null); // null | {} (new) | med (edit)
  const { data, loading, error, reload } = useAsync(async () => {
    await refreshDoses(deviceTimezone());
    const [meds, doses] = await Promise.all([listMedications(), todaysDoses()]);
    return { meds, doses };
  });

  if (loading) return html`<${Spinner} label="Loading your medicines..." />`;
  if (error) return html`<${Card} className="center"><p class="lead">We could not load your medicines.</p>
    <${Button} onClick=${reload}>Try again<//><//>`;

  const { meds, doses } = data;

  async function done(id) {
    try { await markDoseTaken(id); ui.toast('Great - marked as taken.'); reload(); }
    catch { ui.toast('Could not save. Please try again.', 'bad'); }
  }
  async function remove(med) {
    const ok = await ui.confirm({ title: 'Remove medicine', message: `Remove ${med.name}?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { await deleteMedication(med.id); ui.toast('Medicine removed.', 'info'); reload(); }
    catch { ui.toast('Could not remove. Please try again.', 'bad'); }
  }

  return html`<div class="stack">
    <h2 class="section">Today's medicines</h2>
    ${doses.length === 0
      ? html`<${EmptyState}>No doses scheduled for today.<//>`
      : doses.map((d) => html`<${DoseCard} key=${d.id} dose=${d} onDone=${() => done(d.id)} />`)}

    <div class="divider"></div>
    <h3 class="subsection">My medicines</h3>
    ${meds.length === 0
      ? html`<${EmptyState}>No medicines added yet.<//>`
      : meds.map((m) => html`<${MedRow} key=${m.id} med=${m} onEdit=${() => setEditing(m)} onRemove=${() => remove(m)} />`)}

    ${meds.length < MAX_MEDS
      ? html`<${Button} icon="plus" onClick=${() => setEditing({})}>Add a medicine<//>`
      : html`<p class="muted center">You can track up to 3 medicines.</p>`}

    ${editing ? html`<${MedForm} med=${editing.id ? editing : null}
      onClose=${() => setEditing(null)}
      onSaved=${() => { setEditing(null); reload(); }} />` : null}
  </div>`;
}

function DoseCard({ dose, onDone }) {
  const [busy, setBusy] = useState(false);
  const m = dose.medication || {};
  const title = `${m.name || 'Medicine'}${m.dose ? ' - ' + m.dose : ''}`;
  const meta = html`<${Fragment}>
    <div class="card__meta">Scheduled for ${prettyTime(dose.scheduled_time)}</div>
    ${m.note ? html`<div class="card__meta">${m.note}</div>` : null}
  <//>`;

  if (dose.status === 'taken') {
    const t = dose.taken_at ? prettyClock(new Date(dose.taken_at)) : '';
    return html`<${Card} accent="taken">
      <div class="card__title">${title}</div>${meta}
      <div style="margin-top:10px"><${Pill} kind="taken">${t ? `Taken at ${t}` : 'Taken'}<//></div>
    <//>`;
  }
  if (dose.status === 'missed') {
    return html`<${Card} accent="missed">
      <div class="card__title">${title}</div>${meta}
      <div style="margin-top:10px"><${Pill} kind="missed">Missed<//></div>
      <${Button} variant="ghost" size="sm" disabled=${busy}
        onClick=${async () => { setBusy(true); await onDone(); }}>I took it<//>
    <//>`;
  }
  return html`<${Card} accent="due">
    <div class="card__title">${title}</div>${meta}
    <${Button} variant="good" size="lg" icon="check" disabled=${busy}
      onClick=${async () => { setBusy(true); await onDone(); }}>Done - I took it<//>
  <//>`;
}

function MedRow({ med, onEdit, onRemove }) {
  const times = (med.times || []).map(prettyTime).join(', ');
  return html`<${Card}>
    <div class="card__title">${med.name}${med.dose ? ' - ' + med.dose : ''}</div>
    <div class="card__meta">${times || 'No times set'}</div>
    ${med.note ? html`<div class="card__meta">${med.note}</div>` : null}
    <div class="btn-row">
      <${Button} variant="ghost" size="sm" icon="edit" onClick=${onEdit}>Edit<//>
      <${Button} variant="danger" size="sm" icon="trash" onClick=${onRemove}>Remove<//>
    </div>
  <//>`;
}

function MedForm({ med, onClose, onSaved }) {
  const ui = useUI();
  const [name, setName] = useState(med?.name || '');
  const [dose, setDose] = useState(med?.dose || '');
  const [note, setNote] = useState(med?.note || '');
  const [times, setTimes] = useState(med?.times?.length ? [...med.times] : ['09:00']);
  const [busy, setBusy] = useState(false);
  const editing = !!med;

  const setTime = (i, v) => setTimes((t) => t.map((x, j) => (j === i ? v : x)));
  const addTime = () => setTimes((t) => [...t, '12:00']);
  const removeTime = (i) => setTimes((t) => t.filter((_, j) => j !== i));

  async function save() {
    if (!name.trim()) { ui.toast('Please enter a name.', 'bad'); return; }
    const clean = [...new Set(times.filter(Boolean))].sort();
    if (!clean.length) { ui.toast('Please set at least one time.', 'bad'); return; }
    setBusy(true);
    try {
      await saveMedication({ id: med?.id, name: name.trim(), dose: dose.trim(), times: clean, note: note.trim() });
      ui.toast(editing ? 'Medicine updated.' : 'Medicine added.');
      onSaved();
    } catch { ui.toast('Could not save. Please try again.', 'bad'); setBusy(false); }
  }

  return html`<${Modal} title=${editing ? 'Edit medicine' : 'Add a medicine'} onClose=${onClose}>
    <${Field} label="Name">
      <input class="input" value=${name} placeholder="e.g. Metformin" maxlength="60"
        onInput=${(e) => setName(e.target.value)} />
    <//>
    <${Field} label="Dose">
      <input class="input" value=${dose} placeholder="e.g. 500 mg or 1 tablet" maxlength="40"
        onInput=${(e) => setDose(e.target.value)} />
    <//>
    <${Field} label="Time(s) each day">
      ${times.map((t, i) => html`<div key=${i} class="time-row">
        <input class="input" type="time" value=${t} onInput=${(e) => setTime(i, e.target.value)} />
        ${times.length > 1 ? html`<${Button} variant="danger" size="sm" full=${false}
          onClick=${() => removeTime(i)}>Remove<//>` : null}
      </div>`)}
      ${times.length < 3 ? html`<${Button} variant="ghost" size="sm" full=${false} icon="plus"
        onClick=${addTime}>Add another time<//>` : null}
    <//>
    <${Field} label="Note (optional)">
      <input class="input" value=${note} placeholder="e.g. take with food" maxlength="80"
        onInput=${(e) => setNote(e.target.value)} />
    <//>
    <div class="btn-row" style="margin-top:8px">
      <${Button} variant="ghost" onClick=${onClose}>Cancel<//>
      <${Button} disabled=${busy} onClick=${save}>${editing ? 'Save changes' : 'Add medicine'}<//>
    </div>
  <//>`;
}
