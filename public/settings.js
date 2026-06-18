// Family & Settings: patient display name, detected timezone, and the family
// member's "turn on missed-dose alerts" flow (web-push registration).
import { html, useState } from './react.js';
import { Button, Card, Field, Spinner, useUI, useAsync, navigate } from './ui.js';
import {
  supabase, loadSettings, saveSettings, deviceTimezone, saveFamilyDevice, listFamilyDevices,
} from './db.js';
import { pushSupported, enablePush } from './push.js';

export function Settings() {
  const ui = useUI();
  const { data, loading, error, reload } = useAsync(async () => {
    const [settings, devices] = await Promise.all([loadSettings(), listFamilyDevices()]);
    return { settings, devices };
  });
  const [name, setName] = useState(null);
  const [savingName, setSavingName] = useState(false);

  if (loading) return html`<${Spinner} label="Loading..." />`;
  if (error) return html`<${Card} className="center"><p class="lead">Could not load settings.</p><${Button} onClick=${reload}>Try again<//><//>`;

  const settings = data.settings || {};
  const devices = data.devices || [];
  const nameValue = name !== null ? name : (settings.patient_name || 'Dad');

  async function saveName() {
    setSavingName(true);
    try { await saveSettings({ patient_name: (nameValue || 'Dad').trim() }); ui.toast('Saved.'); }
    catch { ui.toast('Could not save.', 'bad'); }
    setSavingName(false);
  }
  async function turnOnAlerts() {
    try {
      const sub = await enablePush();
      const label = await ui.prompt({ title: 'Turn on alerts', message: 'Whose phone is this?', placeholder: "e.g. Mary's iPhone", defaultValue: '' });
      if (label === null) return; // cancelled
      await saveFamilyDevice(label.trim() || 'Family phone', sub);
      ui.toast('Alerts are on for this phone.');
      reload();
    } catch (e) { ui.toast(e.message || 'Could not turn on alerts.', 'bad'); }
  }
  async function testAlert() {
    try {
      const { error: e } = await supabase.functions.invoke('missed-dose-check', { body: { test: true } });
      if (e) throw e;
      ui.toast('Test alert sent. Check the family phones.', 'info');
    } catch { ui.toast('Could not send a test (alert service may not be set up yet).', 'bad'); }
  }

  return html`<div class="stack">
    <h2 class="section">Family & Settings</h2>

    <${Card}>
      <div class="card__title">Name on alerts</div>
      <p class="card__meta">Used in the message family members receive, e.g. "Dad has not taken his 9 AM medicine."</p>
      <${Field} label="">
        <input class="input" value=${nameValue} maxlength="40" placeholder="e.g. Dad" onInput=${(e) => setName(e.target.value)} />
      <//>
      <${Button} size="sm" full=${false} disabled=${savingName} onClick=${saveName}>Save name<//>
    <//>

    <${Card}>
      <div class="card__title">Time zone</div>
      <p class="card__meta">Reminders use: ${settings.timezone || deviceTimezone()}</p>
      <p class="card__meta muted">This is set automatically from this phone.</p>
    <//>

    <${Card}>
      <div class="card__title">Missed-dose alerts</div>
      <p class="card__meta">If you are a family member, turn on alerts on YOUR phone. You will be notified if a medicine is not taken within an hour of being due.</p>
      ${pushSupported()
        ? html`<${Button} icon="bell" onClick=${turnOnAlerts}>Turn on alerts on this phone<//>`
        : html`<p class="card__meta muted">This phone or browser does not support alerts. On iPhone, add MyDay to the Home Screen first, then open it from there.</p>`}
      ${devices.length ? html`<div style="margin-top:14px">
        <div class="card__meta" style="font-weight:700">Phones receiving alerts:</div>
        ${devices.map((d) => html`<div key=${d.id} class="card__meta">- ${d.label || 'A phone'}${d.last_notified_at ? ' (last alerted ' + new Date(d.last_notified_at).toLocaleDateString() + ')' : ''}</div>`)}
        <${Button} variant="ghost" size="sm" full=${false} onClick=${testAlert} style="margin-top:10px">Send a test alert<//>
      </div>` : null}
    <//>

    <${Button} variant="ghost" onClick=${() => navigate('#/home')}>Back to home<//>
  </div>`;
}
