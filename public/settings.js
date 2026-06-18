// Family & Settings: the patient's display name, the detected timezone, and the
// family member's "turn on missed-dose alerts" flow (web push registration).
import { h, mount, banner } from './ui.js';
import { go } from './nav.js';
import {
  supabase, loadSettings, saveSettings, deviceTimezone,
  saveFamilyDevice, listFamilyDevices,
} from './db.js';
import { pushSupported, enablePush } from './push.js';

export async function renderSettings() {
  mount(h('p', { class: 'lead' }, 'Loading...'));
  let settings = null, devices = [];
  try {
    [settings, devices] = await Promise.all([loadSettings(), listFamilyDevices()]);
  } catch (e) {
    return mount(h('div', { class: 'card center' }, h('p', { class: 'lead' }, 'Could not load settings.'),
      h('button', { class: 'btn', onclick: renderSettings }, 'Try again')));
  }

  const nameInput = h('input', { type: 'text', value: settings?.patient_name || 'Dad',
    placeholder: 'e.g. Dad', maxlength: '40' });

  const nodes = [
    h('h2', { class: 'section' }, 'Family & Settings'),

    // ----- patient name -----
    h('div', { class: 'card' },
      h('div', { class: 'card__title' }, 'Name on alerts'),
      h('p', { class: 'card__meta' }, 'Used in the message family members receive, e.g. "Dad has not taken his 9 AM medicine."'),
      h('div', { class: 'field', style: 'margin-top:10px' }, nameInput),
      h('button', { class: 'btn btn--sm', onclick: async (e) => {
        const v = nameInput.value.trim() || 'Dad';
        e.target.disabled = true;
        try { await saveSettings({ patient_name: v }); banner('Saved.'); }
        catch { banner('Could not save.', 'bad'); }
        e.target.disabled = false;
      } }, 'Save name')),

    // ----- timezone -----
    h('div', { class: 'card' },
      h('div', { class: 'card__title' }, 'Time zone'),
      h('p', { class: 'card__meta' }, `Reminders use: ${settings?.timezone || deviceTimezone()}`),
      h('p', { class: 'card__meta muted' }, 'This is set automatically from this phone.')),

    // ----- family alerts -----
    h('div', { class: 'card' },
      h('div', { class: 'card__title' }, 'Missed-dose alerts'),
      h('p', { class: 'card__meta' }, 'If you are a family member, turn on alerts on YOUR phone. You will be notified if a medicine is not taken within an hour of being due.'),
      pushSupported()
        ? h('button', { class: 'btn', style: 'margin-top:12px', onclick: onEnableAlerts }, 'Turn on alerts on this phone')
        : h('p', { class: 'card__meta muted' }, 'This phone or browser does not support alerts. On iPhone, add MyDay to the Home Screen first, then open it from there.'),
      devices.length
        ? h('div', { style: 'margin-top:14px' },
            h('div', { class: 'card__meta', style: 'font-weight:700' }, 'Phones receiving alerts:'),
            ...devices.map(d => h('div', { class: 'card__meta' },
              `- ${d.label || 'A phone'}${d.last_notified_at ? ' (last alerted ' + new Date(d.last_notified_at).toLocaleDateString() + ')' : ''}`)),
            h('button', { class: 'btn btn--ghost btn--sm', style: 'margin-top:10px', onclick: onTestAlert }, 'Send a test alert'))
        : null),

    h('button', { class: 'btn btn--ghost', style: 'margin-top:8px', onclick: () => go('#/home') }, 'Back to home'),
  ];

  mount(...nodes);

  async function onEnableAlerts(e) {
    e.target.disabled = true;
    try {
      const sub = await enablePush();
      const label = (window.prompt('Whose phone is this? (e.g. "Mary\'s iPhone")', '') || 'Family phone').slice(0, 40);
      await saveFamilyDevice(label, sub);
      banner('Alerts are on for this phone.');
      renderSettings();
    } catch (err) {
      banner(err.message || 'Could not turn on alerts.', 'bad');
      e.target.disabled = false;
    }
  }

  async function onTestAlert(e) {
    e.target.disabled = true;
    try {
      const { error } = await supabase.functions.invoke('missed-dose-check', { body: { test: true } });
      if (error) throw error;
      banner('Test alert sent. Check the family phones.', 'info');
    } catch (err) {
      banner('Could not send a test (the alert service may not be set up yet).', 'bad');
    }
    e.target.disabled = false;
  }
}
