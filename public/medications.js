// Medications: today's doses (with the big Done tap) + manage the medicine list.
import { h, mount, banner, confirmAction } from './ui.js';
import {
  listMedications, saveMedication, deleteMedication,
  refreshDoses, todaysDoses, markDoseTaken,
  prettyTime, prettyClock, deviceTimezone,
} from './db.js';

const MAX_MEDS = 3;

export async function renderMedications() {
  mount(h('p', { class: 'lead' }, 'Loading your medicines...'));
  let meds = [], doses = [];
  try {
    await refreshDoses(deviceTimezone());
    [meds, doses] = await Promise.all([listMedications(), todaysDoses()]);
  } catch (e) {
    return mount(h('div', { class: 'card center' },
      h('p', { class: 'lead' }, 'We could not load your medicines.'),
      h('button', { class: 'btn', onclick: renderMedications }, 'Try again')));
  }

  const nodes = [];

  // ----- Today's doses -----
  nodes.push(h('h2', { class: 'section' }, "Today's medicines"));
  if (!doses.length) {
    nodes.push(h('p', { class: 'empty' }, 'No doses scheduled for today.'));
  } else {
    for (const d of doses) nodes.push(doseCard(d));
  }

  // ----- Manage list -----
  nodes.push(h('hr', { class: 'hr' }));
  nodes.push(h('h3', {}, 'My medicines'));
  if (!meds.length) {
    nodes.push(h('p', { class: 'empty' }, 'No medicines added yet.'));
  } else {
    for (const m of meds) nodes.push(medRow(m));
  }

  if (meds.length < MAX_MEDS) {
    nodes.push(h('button', { class: 'btn', style: 'margin-top:6px',
      onclick: () => renderMedForm(null) }, 'Add a medicine'));
  } else {
    nodes.push(h('p', { class: 'muted center', style: 'margin-top:10px' },
      'You can track up to 3 medicines.'));
  }

  mount(...nodes);
}

function doseCard(d) {
  const m = d.medication || {};
  const title = `${m.name || 'Medicine'}${m.dose ? ' - ' + m.dose : ''}`;
  const meta = [h('div', { class: 'card__meta' }, `Scheduled for ${prettyTime(d.scheduled_time)}`)];
  if (m.note) meta.push(h('div', { class: 'card__meta' }, m.note));

  if (d.status === 'taken') {
    const t = d.taken_at ? prettyClock(new Date(d.taken_at)) : '';
    return h('div', { class: 'card card--taken' },
      h('div', { class: 'card__title' }, title), ...meta,
      h('div', { style: 'margin-top:10px' },
        h('span', { class: 'pill pill--taken' }, t ? `Taken at ${t}` : 'Taken')));
  }
  if (d.status === 'missed') {
    return h('div', { class: 'card card--missed' },
      h('div', { class: 'card__title' }, title), ...meta,
      h('div', { style: 'margin-top:10px' },
        h('span', { class: 'pill pill--missed' }, 'Missed')),
      // Still allow marking it taken late.
      h('button', { class: 'btn btn--ghost btn--sm', style: 'margin-top:12px',
        onclick: (e) => doDone(d.id, e.target) }, 'I took it'));
  }
  // pending
  return h('div', { class: 'card card--due' },
    h('div', { class: 'card__title' }, title), ...meta,
    h('button', { class: 'btn btn--good btn--lg', style: 'margin-top:12px',
      onclick: (e) => doDone(d.id, e.target) }, 'Done - I took it'));
}

async function doDone(id, btn) {
  btn.disabled = true;
  try {
    await markDoseTaken(id);
    banner('Great - marked as taken.');
    renderMedications();
  } catch { banner('Could not save. Please try again.', 'bad'); btn.disabled = false; }
}

function medRow(m) {
  const times = (m.times || []).map(prettyTime).join(', ');
  return h('div', { class: 'card' },
    h('div', { class: 'card__title' }, `${m.name}${m.dose ? ' - ' + m.dose : ''}`),
    h('div', { class: 'card__meta' }, times || 'No times set'),
    m.note ? h('div', { class: 'card__meta' }, m.note) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ghost btn--sm', onclick: () => renderMedForm(m) }, 'Edit'),
      h('button', { class: 'btn btn--danger btn--sm',
        onclick: async () => {
          if (!confirmAction(`Remove ${m.name}?`)) return;
          try { await deleteMedication(m.id); banner('Medicine removed.', 'info'); renderMedications(); }
          catch { banner('Could not remove. Please try again.', 'bad'); }
        } }, 'Remove')));
}

// ----- Add / edit form -----
function renderMedForm(med) {
  const editing = !!med;
  const state = {
    id: med?.id,
    name: med?.name || '',
    dose: med?.dose || '',
    times: (med?.times && med.times.length ? [...med.times] : ['09:00']),
    note: med?.note || '',
  };

  const timesWrap = h('div', {});
  function drawTimes() {
    timesWrap.innerHTML = '';
    state.times.forEach((t, i) => {
      timesWrap.appendChild(h('div', { class: 'times-row' },
        h('input', { type: 'time', value: t, 'aria-label': `Time ${i + 1}`,
          onchange: (e) => { state.times[i] = e.target.value; } }),
        state.times.length > 1
          ? h('button', { class: 'btn btn--danger btn--sm', type: 'button',
              onclick: () => { state.times.splice(i, 1); drawTimes(); } }, 'Remove')
          : null));
    });
    if (state.times.length < 3) {
      timesWrap.appendChild(h('button', { class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: () => { state.times.push('12:00'); drawTimes(); } }, 'Add another time'));
    }
  }
  drawTimes();

  const nameInput = h('input', { type: 'text', value: state.name, placeholder: 'e.g. Metformin', maxlength: '60' });
  const doseInput = h('input', { type: 'text', value: state.dose, placeholder: 'e.g. 500 mg or 1 tablet', maxlength: '40' });
  const noteInput = h('input', { type: 'text', value: state.note, placeholder: 'e.g. take with food', maxlength: '80' });

  mount(
    h('h2', { class: 'section' }, editing ? 'Edit medicine' : 'Add a medicine'),
    h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput),
    h('div', { class: 'field' }, h('label', {}, 'Dose'), doseInput),
    h('div', { class: 'field' }, h('label', {}, 'Time(s) each day'), timesWrap),
    h('div', { class: 'field' }, h('label', {}, 'Note (optional)'), noteInput),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ghost', onclick: renderMedications }, 'Cancel'),
      h('button', { class: 'btn', onclick: async (e) => {
        const name = nameInput.value.trim();
        if (!name) { banner('Please enter a name.', 'bad'); nameInput.focus(); return; }
        const times = [...new Set(state.times.filter(Boolean))].sort();
        if (!times.length) { banner('Please set at least one time.', 'bad'); return; }
        e.target.disabled = true;
        try {
          await saveMedication({ id: state.id, name, dose: doseInput.value.trim(),
            times, note: noteInput.value.trim() });
          banner(editing ? 'Medicine updated.' : 'Medicine added.');
          renderMedications();
        } catch { banner('Could not save. Please try again.', 'bad'); e.target.disabled = false; }
      } }, editing ? 'Save changes' : 'Add medicine')),
  );
}
