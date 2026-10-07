// "Will my reminders actually reach me?" broken into the separate links of
// the chain, because each one fails differently and needs a different fix:
//
//   1. the preference is on in MyDay,
//   2. the individual medicines have reminders on,
//   3. this device has granted permission,
//   4. this device is registered (subscribed) to receive them,
//   5. something has been sent to it, and what happened.
//
// Nothing here claims an alert was DELIVERED: the server only knows it handed
// the alert to the push service. Pure functions, tested in test/readiness.test.js.

const PLATFORM_NAMES = {
  ios: 'iPhone', ipados: 'iPad', android: 'Android device', desktop: 'Computer',
};

/** @returns {{id, title, detail, state: 'ok'|'warn'|'info'}[]} */
export function readinessChecklist({ prefs, permission, supported, installed, meds = [], devices = [], myEndpoint }) {
  const out = [];

  const prefOn = !!prefs?.master && prefs?.dose_due !== false;
  out.push({
    id: 'pref',
    title: 'Reminders are on in MyDay',
    state: prefOn ? 'ok' : 'warn',
    detail: !prefs?.master ? 'All notifications are switched off below.'
      : prefs?.dose_due === false ? '“Dose reminders” is switched off below.' : 'Your settings allow dose reminders.',
  });

  const scheduled = meds.filter((m) => m.frequency !== 'as_needed' && m.active !== false);
  const withRem = scheduled.filter((m) => m.reminders_enabled !== false);
  out.push({
    id: 'meds',
    title: 'Medicines with reminders',
    state: !scheduled.length ? 'info' : withRem.length === scheduled.length ? 'ok' : 'warn',
    detail: !scheduled.length ? 'No scheduled medicines yet.'
      : `${withRem.length} of ${scheduled.length} scheduled medicine${scheduled.length === 1 ? '' : 's'} will remind you.`,
  });

  out.push({
    id: 'permission',
    title: 'This device allows notifications',
    state: !supported ? 'warn' : permission === 'granted' ? 'ok' : permission === 'denied' ? 'warn' : 'info',
    detail: !supported ? 'This browser cannot show notifications. Add MyDay to your home screen and open it from there.'
      : permission === 'granted' ? 'Permission is granted.'
        : permission === 'denied' ? 'Notifications are blocked for MyDay. Allow them in your device settings.'
          : 'Not asked yet. Tap “Turn on alerts on this device”.',
  });

  const mine = myEndpoint ? devices.find((d) => d.endpoint === myEndpoint) : null;
  out.push({
    id: 'subscribed',
    title: 'This device is signed up for alerts',
    state: mine ? (mine.push_enabled === false ? 'warn' : 'ok') : 'info',
    detail: mine
      ? (mine.push_enabled === false ? 'Alerts were turned off for this device after a delivery problem. Turn them on again above.'
        : `Registered${installed === false ? ' in the browser' : ''}.`)
      : devices.length ? `Not this device — ${devices.length} other device${devices.length === 1 ? ' is' : 's are'} set up.`
        : 'No device is set up yet.',
  });

  const sentAt = mine?.last_delivered_at || mine?.last_notified_at;
  out.push({
    id: 'delivery',
    title: 'Last alert sent to this device',
    state: mine?.last_error ? 'warn' : sentAt ? 'ok' : 'info',
    detail: mine?.last_error ? `The last attempt failed: ${mine.last_error}`
      : sentAt ? 'Sent to your device’s notification service. Send a test to check it shows up.'
        : 'Nothing sent yet. Send a test alert to check.',
    sentAt: sentAt || null,
  });

  return out;
}

/**
 * How to show one saved device so two of them can never look identical:
 * its own name (or its platform), "This device" for the current one, a
 * number when names repeat, and when it was added.
 */
export function describeDevice(d, { myEndpoint, index = 0, all = [], shortDate = (x) => x, prettyClock = (x) => String(x) } = {}) {
  const base = (d.label && d.label !== 'This phone' ? d.label : PLATFORM_NAMES[d.platform] || d.label || 'Device').trim();
  const same = all.filter((x) => ((x.label && x.label !== 'This phone' ? x.label : PLATFORM_NAMES[x.platform] || x.label || 'Device').trim()) === base);
  const nth = same.length > 1 ? ` ${same.indexOf(d) + 1}` : '';
  const added = d.created_at ? `added ${shortDate(String(d.created_at).slice(0, 10))}` : `device ${index + 1}`;
  const kind = d.installed === true ? 'installed app' : d.installed === false ? 'browser' : null;
  const sent = d.last_delivered_at || d.last_notified_at;
  return {
    current: !!myEndpoint && d.endpoint === myEndpoint,
    name: `${base}${nth}`,
    meta: [added, kind].filter(Boolean).join(' · '),
    lastSent: sent ? `Last alert sent ${prettyClock(new Date(sent))}` : 'No alert sent yet',
  };
}
