// Appointments: upcoming list (soonest first) + add/edit/delete.
import { h, mount, banner, confirmAction } from './ui.js';
import {
  upcomingAppointments, saveAppointment, deleteAppointment,
  prettyDate, prettyTime, localDateStr,
} from './db.js';

export async function renderAppointments() {
  mount(h('p', { class: 'lead' }, 'Loading your appointments...'));
  let appts = [];
  try {
    appts = await upcomingAppointments();
  } catch (e) {
    return mount(h('div', { class: 'card center' },
      h('p', { class: 'lead' }, 'We could not load your appointments.'),
      h('button', { class: 'btn', onclick: renderAppointments }, 'Try again')));
  }

  const nodes = [h('h2', { class: 'section' }, 'Upcoming appointments')];
  if (!appts.length) {
    nodes.push(h('p', { class: 'empty' }, 'No appointments coming up.'));
  } else {
    for (const a of appts) nodes.push(apptCard(a));
  }
  nodes.push(h('button', { class: 'btn', style: 'margin-top:6px',
    onclick: () => renderApptForm(null) }, 'Add an appointment'));

  mount(...nodes);
}

function apptCard(a) {
  const when = a.appt_time ? `${prettyDate(a.appt_date)} at ${prettyTime(a.appt_time)}` : prettyDate(a.appt_date);
  return h('div', { class: 'card' },
    h('div', { class: 'card__title' }, when),
    a.doctor_name ? h('div', { class: 'card__meta' }, `Doctor: ${a.doctor_name}`) : null,
    a.location ? h('div', { class: 'card__meta' }, `Where: ${a.location}`) : null,
    a.reason ? h('div', { class: 'card__meta' }, `Reason: ${a.reason}`) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ghost btn--sm', onclick: () => renderApptForm(a) }, 'Edit'),
      h('button', { class: 'btn btn--danger btn--sm', onclick: async () => {
        if (!confirmAction('Remove this appointment?')) return;
        try { await deleteAppointment(a.id); banner('Appointment removed.', 'info'); renderAppointments(); }
        catch { banner('Could not remove. Please try again.', 'bad'); }
      } }, 'Remove')));
}

function renderApptForm(appt) {
  const editing = !!appt;
  const dateInput = h('input', { type: 'date', value: appt?.appt_date || localDateStr(), min: '2000-01-01' });
  const timeInput = h('input', { type: 'time', value: appt?.appt_time || '' });
  const docInput = h('input', { type: 'text', value: appt?.doctor_name || '', placeholder: 'e.g. Dr. Patel', maxlength: '60' });
  const locInput = h('input', { type: 'text', value: appt?.location || '', placeholder: 'e.g. Riverside Clinic', maxlength: '80' });
  const reasonInput = h('input', { type: 'text', value: appt?.reason || '', placeholder: 'e.g. Check-up', maxlength: '80' });

  mount(
    h('h2', { class: 'section' }, editing ? 'Edit appointment' : 'Add an appointment'),
    h('div', { class: 'field' }, h('label', {}, 'Date'), dateInput),
    h('div', { class: 'field' }, h('label', {}, 'Time (optional)'), timeInput),
    h('div', { class: 'field' }, h('label', {}, 'Doctor'), docInput),
    h('div', { class: 'field' }, h('label', {}, 'Location'), locInput),
    h('div', { class: 'field' }, h('label', {}, 'Reason'), reasonInput),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ghost', onclick: renderAppointments }, 'Cancel'),
      h('button', { class: 'btn', onclick: async (e) => {
        if (!dateInput.value) { banner('Please choose a date.', 'bad'); dateInput.focus(); return; }
        e.target.disabled = true;
        try {
          await saveAppointment({ id: appt?.id, appt_date: dateInput.value, appt_time: timeInput.value,
            doctor_name: docInput.value.trim(), location: locInput.value.trim(), reason: reasonInput.value.trim() });
          banner(editing ? 'Appointment updated.' : 'Appointment added.');
          renderAppointments();
        } catch { banner('Could not save. Please try again.', 'bad'); e.target.disabled = false; }
      } }, editing ? 'Save changes' : 'Add appointment')),
  );
}
