import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { medIcon } from '../lib/medIcon.js';
import { InstallCard, detectDevice } from '../components/InstallCard.jsx';
import { Card, Button, Toggle, SegmentedControl, SkeletonCard, Collapsible } from '../components/ui.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { pushSupported, enablePush } from '../lib/push.js';
import { supabase } from '../lib/supabase.js';
import {
  getNotificationPrefs, saveNotificationPrefs, listNotificationDevices,
  forgetNotificationDevice, registerThisDevice, listMedications, setMedicationReminders,
} from '../lib/db.js';
import {
  NOTIFICATION_TYPES, APPOINTMENT_LEADS, SNOOZE_CHOICES, REPEAT_EVERY_CHOICES,
  REPEAT_TIMES_CHOICES, deliveryStatus,
} from '../lib/notifications.js';
import { deviceLabel, platformTag } from '../lib/guardian.js';
import { prettyClock, prettyTime, shortDate } from '../lib/format.js';
import { readinessChecklist, describeDevice } from '../lib/readiness.js';

// Everything about notifications, in one place the person can actually reach.
//
// The rule throughout: never fail silently. If alerts cannot be delivered on
// this device, this screen says so in plain words and gives the steps for
// THAT device, rather than leaving someone to wonder why nothing arrives.

const ALERT_WINDOWS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
];

const TIME_CHOICES = ['07:00', '08:00', '09:00', '12:00', '18:00', '20:00', '21:00'];

export default function NotificationSettings() {
  const ui = useUI();
  const navigate = useNavigate();
  const { profile, updateProfile } = useApp();
  const { installed } = useInstallPrompt();

  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState(
    () => (typeof Notification !== 'undefined' ? Notification.permission : 'default')
  );

  const devices = useAsync(() => listNotificationDevices(), []);
  const meds = useAsync(() => listMedications(), []);
  // Which saved device is THIS one: matched by its push endpoint, which is
  // unique per browser install. Two rows that both said "This phone" were
  // impossible to tell apart.
  const [myEndpoint, setMyEndpoint] = useState(null);
  useEffect(() => {
    if (!pushSupported()) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setMyEndpoint(sub?.endpoint || null))
      .catch(() => {});
  }, [devices.data]);

  useEffect(() => {
    getNotificationPrefs().then(setPrefs).catch(() => ui.toast('Could not load your settings.', 'bad'));
  }, [ui]);

  // Re-check on return: someone may have installed the app or changed the
  // permission in device settings while this screen was open.
  useEffect(() => {
    const recheck = () => {
      if (typeof Notification !== 'undefined') setPermission(Notification.permission);
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, []);

  const status = deliveryStatus({
    supported: pushSupported(),
    permission,
    installed,
    platform: platformTag(),
  });

  const update = useCallback(async (patch) => {
    // Optimistic: a switch that lags behind the finger feels broken.
    setPrefs((p) => ({ ...p, ...patch }));
    setSaving(true);
    try { await saveNotificationPrefs(patch); }
    catch {
      ui.toast('Could not save that setting.', 'bad');
      getNotificationPrefs().then(setPrefs).catch(() => {});
    } finally { setSaving(false); }
  }, [ui]);

  async function turnOn() {
    try {
      const sub = await enablePush();
      await registerThisDevice(deviceLabel(), sub, { platform: platformTag(), installed });
      setPermission('granted');
      devices.reload();
      if (!prefs?.master) await update({ master: true });
      ui.toast('Alerts are on for this device.');
    } catch (e) {
      setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'default');
      ui.toast(e.message || 'Could not turn on alerts.', 'bad');
    }
  }

  async function sendTest() {
    try {
      const { data, error } = await supabase.functions.invoke('missed-dose-check', { body: { test: true } });
      if (error) throw error;
      if (!data?.delivered) {
        // A test that goes nowhere is the most useful thing to be honest about.
        ui.toast('No device received it. Check the list below.', 'bad');
        return;
      }
      ui.toast(`Test alert sent to ${data.delivered} device${data.delivered === 1 ? '' : 's'}.`, 'info');
      devices.reload();
    } catch { ui.toast('Could not send a test alert.', 'bad'); }
  }

  if (!prefs) {
    return <div className="stack"><SkeletonCard lines={3} /><SkeletonCard lines={4} /></div>;
  }

  const off = !prefs.master;

  return (
    <div className="stack">
      <button type="button" className="ns-back" onClick={() => navigate('/profile')}>
        <Icon name="back" size={22} /> Profile
      </button>

      {/* ---- can this device actually deliver? ---- */}
      <Card>
        <div className={`ns-status ns-status--${status.ok ? 'ok' : 'warn'}`}>
          <span className="ns-status__ic">
            <Icon name={status.ok ? 'check' : 'bell'} size={24} />
          </span>
          <div>
            <div className="ns-status__t">{status.message}</div>
            {status.fix && <p className="ns-status__d">{status.fix}</p>}
          </div>
        </div>

        {status.code === 'needs_install' && (
          <>
            <div style={{ height: 12 }} />
            {/* On iOS and iPadOS this is not advice, it is the requirement. */}
            <InstallCard why="On an iPhone or iPad, alerts cannot be delivered at all until MyDay is on the home screen. This is an Apple rule, not a MyDay setting." />
          </>
        )}

        {(status.code === 'not_asked' || status.code === 'needs_install') && (
          <>
            <div style={{ height: 12 }} />
            <p className="muted" style={{ margin: '0 0 10px' }}>
              We will ask your device for permission. You can change it later at any time.
            </p>
            <Button icon="bell" onClick={turnOn} disabled={status.code === 'needs_install' && !installed}>
              Turn on alerts on this device
            </Button>
          </>
        )}

        {status.code === 'unsupported' && (
          <p className="muted" style={{ margin: '10px 0 0' }}>
            You can still use the reminders inside the app, and a family member can receive your
            missed-dose alerts on their own phone — set that up under <b>Guardians</b> in Profile.
          </p>
        )}

        {status.ok && (
          <>
            <div style={{ height: 12 }} />
            <Button variant="ghost" icon="bell" onClick={sendTest}>Send a test alert</Button>
          </>
        )}
      </Card>

      {/* ---- readiness: every link in the chain, separately ---- */}
      <Card>
        <h2 className="ns-h">Will reminders reach me?</h2>
        <ul className="ready-list">
          {readinessChecklist({
            prefs, permission, supported: pushSupported(), installed,
            meds: meds.data || [], devices: devices.data || [], myEndpoint,
          }).map((r) => (
            <li key={r.id} className={`ready ready--${r.state}`}>
              <span className="ready__ic" aria-hidden="true"><Icon name={r.state === 'ok' ? 'check' : r.state === 'warn' ? 'alert' : 'info'} size={18} /></span>
              <span className="ready__main">
                <span className="ready__t">{r.title}<span className="sr-only">: {r.state === 'ok' ? 'yes' : r.state === 'warn' ? 'needs attention' : 'not yet known'}</span></span>
                <span className="ready__d">{r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 15 }}>
          “Sent” means MyDay handed the alert to your device's notification service. Only a test you
          actually see on your screen proves it arrived.
        </p>
      </Card>

      {/* ---- master switch ---- */}
      <Card>
        <Row id="ns-master" title="All notifications" desc="One switch for everything below.">
          <Toggle checked={!!prefs.master} onChange={(v) => update({ master: v })} labelledBy="ns-master-t" describedBy="ns-master-d" />
        </Row>
        {off && (
          <p className="ns-warn" role="status">
            <Icon name="bell" size={20} />
            All notifications are off, including missed-dose alerts. You will only see reminders
            inside the app.
          </p>
        )}
      </Card>

      {/* ---- per type ---- */}
      <Collapsible id="ns-types" icon="bell" title="What to tell me about"
        summary={`${NOTIFICATION_TYPES.filter((t) => prefs[t.id]).length} of ${NOTIFICATION_TYPES.length} on`}>
        {NOTIFICATION_TYPES.map((t) => (
          <Row key={t.id} id={`ns-${t.id}`} title={t.label} desc={t.desc} dim={off}>
            <Toggle checked={!!prefs[t.id]} onChange={(v) => update({ [t.id]: v })} labelledBy={`ns-${t.id}-t`} describedBy={`ns-${t.id}-d`} />
          </Row>
        ))}
      </Collapsible>

      {/* ---- missed dose ---- */}
      <Collapsible id="ns-missed" icon="clock" title="Missed doses"
        summary={`Missed after ${ALERT_WINDOWS.find((w) => w.value === (profile?.alert_window_minutes ?? 60))?.label || ''} · ${prefs.repeat_every_minutes ? `repeat every ${prefs.repeat_every_minutes} min` : 'no repeats'}`}>
        <p className="muted" id="ns-window-label" style={{ margin: '0 0 10px' }}>
          How long after a dose is due before it counts as missed.
        </p>
        <SegmentedControl label="How long after a dose is due before it counts as missed"
          value={profile?.alert_window_minutes ?? 60}
          onChange={async (v) => {
            try { await updateProfile({ alert_window_minutes: Number(v) }); }
            catch { ui.toast('Could not save.', 'bad'); }
          }}
          options={ALERT_WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />

        <div className="divider" style={{ margin: '16px 0' }} />

        <Row id="ns-repeat" title="Remind me again" desc="Keep reminding me until I mark it as taken." control="select">
          <select id="ns-repeat-c" className="input input--select" value={prefs.repeat_every_minutes} aria-describedby="ns-repeat-d"
            onChange={(e) => update({ repeat_every_minutes: Number(e.target.value) })}>
            {REPEAT_EVERY_CHOICES.map((n) => (
              <option key={n} value={n}>{n === 0 ? 'Just once' : `Every ${n} min`}</option>
            ))}
          </select>
        </Row>
        {prefs.repeat_every_minutes > 0 && (
          <Row id="ns-times" title="How many times" desc="Then it stops, so it can never nag all day." control="select">
            <select id="ns-times-c" className="input input--select" value={prefs.repeat_max_times} aria-describedby="ns-times-d"
              onChange={(e) => update({ repeat_max_times: Number(e.target.value) })}>
              {REPEAT_TIMES_CHOICES.map((n) => (
                <option key={n} value={n}>{n} time{n === 1 ? '' : 's'}</option>
              ))}
            </select>
          </Row>
        )}
        <Row id="ns-snooze" title="Snooze length" desc='What "Snooze" on a notification does.' control="select">
          <select id="ns-snooze-c" className="input input--select" value={prefs.snooze_minutes} aria-describedby="ns-snooze-d"
            onChange={(e) => update({ snooze_minutes: Number(e.target.value) })}>
            {SNOOZE_CHOICES.map((n) => <option key={n} value={n}>{n} minutes</option>)}
          </select>
        </Row>
      </Collapsible>

      {/* ---- appointments + summary ---- */}
      <Collapsible id="ns-appts" icon="calendar" title="Appointments and summaries"
        summary={`${APPOINTMENT_LEADS.find((l) => l.minutes === prefs.appointment_lead_minutes)?.label || ''} · summary at ${prettyTime(prefs.daily_summary_at)}`}>
        <Row id="ns-lead" title="Remind me before a visit" desc="How far ahead." control="select">
          <select id="ns-lead-c" className="input input--select" value={prefs.appointment_lead_minutes} aria-describedby="ns-lead-d"
            onChange={(e) => update({ appointment_lead_minutes: Number(e.target.value) })}>
            {APPOINTMENT_LEADS.map((l) => <option key={l.id} value={l.minutes}>{l.label}</option>)}
          </select>
        </Row>
        <Row id="ns-summary" title="Daily summary time" desc="One message about your whole day." control="select">
          <select id="ns-summary-c" className="input input--select" value={prefs.daily_summary_at} aria-describedby="ns-summary-d"
            onChange={(e) => update({ daily_summary_at: e.target.value })}>
            {TIME_CHOICES.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
          </select>
        </Row>
      </Collapsible>

      {/* ---- quiet hours ---- */}
      <Collapsible id="ns-quiet" icon="moon" title="Quiet hours"
        summary={prefs.quiet_hours_enabled ? `${prettyTime(prefs.quiet_from)} to ${prettyTime(prefs.quiet_to)}` : 'Off'}>
        <Row id="ns-quiet-on" title="Stay quiet at night" desc="No reminders between these times.">
          <Toggle checked={!!prefs.quiet_hours_enabled} labelledBy="ns-quiet-on-t" describedBy="ns-quiet-on-d"
            onChange={(v) => update({ quiet_hours_enabled: v })} />
        </Row>
        {prefs.quiet_hours_enabled && (
          <>
            <div className="ns-two">
              <div className="ns-field">
                <label htmlFor="ns-quiet-from">From</label>
                <select id="ns-quiet-from" className="input input--select" value={prefs.quiet_from}
                  onChange={(e) => update({ quiet_from: e.target.value })}>
                  {TIME_CHOICES.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
                </select>
              </div>
              <div className="ns-field">
                <label htmlFor="ns-quiet-to">Until</label>
                <select id="ns-quiet-to" className="input input--select" value={prefs.quiet_to}
                  onChange={(e) => update({ quiet_to: e.target.value })}>
                  {TIME_CHOICES.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
                </select>
              </div>
            </div>
            {/* The one exception, stated plainly rather than buried. */}
            <p className="ns-note">
              <Icon name="shield" size={20} />
              Missed-dose alerts still come through during quiet hours. Those are the ones worth
              waking you for.
            </p>
          </>
        )}
      </Collapsible>

      {/* ---- sound and feel ---- */}
      <Collapsible id="ns-sound" icon="bell" title="Sound and vibration"
        summary={[prefs.sound ? 'Sound on' : 'Sound off', prefs.vibrate ? 'vibration on' : 'vibration off'].join(' · ')}>
        <Row id="ns-sound-on" title="Sound" desc="Where your device allows it.">
          <Toggle checked={!!prefs.sound} onChange={(v) => update({ sound: v })} labelledBy="ns-sound-on-t" describedBy="ns-sound-on-d" />
        </Row>
        <Row id="ns-vibrate" title="Vibration" desc="A long-short-long buzz for a missed dose.">
          <Toggle checked={!!prefs.vibrate} onChange={(v) => update({ vibrate: v })} labelledBy="ns-vibrate-t" describedBy="ns-vibrate-d" />
        </Row>
      </Collapsible>

      {/* ---- per medicine ---- */}
      <Collapsible id="ns-meds" icon="pill" title="Individual medicines"
        summary={meds.data ? `${meds.data.filter((m) => m.reminders_enabled !== false && m.frequency !== 'as_needed').length} of ${meds.data.filter((m) => m.frequency !== 'as_needed').length} with reminders` : ''}>
        <p className="muted" style={{ margin: '0 0 10px' }}>
          Turn reminders off for one medicine without changing the rest.
        </p>
        {meds.loading ? <SkeletonCard lines={2} /> : !meds.data?.length ? (
          <p className="muted" style={{ margin: 0 }}>You have not added any medicines yet.</p>
        ) : (
          <ul className="ns-meds">
            {meds.data.map((m) => (
              <li key={m.id} className="ns-med">
                <span className="dose__chip" style={{ background: m.color || 'var(--primary)' }} aria-hidden="true">
                  <Icon name={medIcon(m)} size={18} />
                </span>
                <div className="ns-med__main">
                  <div className="ns-med__name" translate="no">{m.name}</div>
                  <div className="ns-med__meta">
                    {m.frequency === 'as_needed'
                      ? 'Only when needed — never reminded'
                      : (m.times || []).map(prettyTime).join(', ')}
                  </div>
                </div>
                {m.frequency !== 'as_needed' && (
                  <Toggle checked={m.reminders_enabled !== false}
                    label={`Reminders for ${m.name}`}
                    onChange={async (v) => {
                      try { await setMedicationReminders(m.id, { enabled: v }); meds.reload(); }
                      catch { ui.toast('Could not save.', 'bad'); }
                    }} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      {/* ---- devices ---- */}
      <Collapsible id="ns-devices" icon="phone" title="Devices getting your alerts"
        summary={devices.data ? `${devices.data.length} device${devices.data.length === 1 ? '' : 's'}${devices.data.some((d) => d.endpoint === myEndpoint) ? ', including this one' : ''}` : ''}>
        {devices.loading ? <SkeletonCard lines={2} /> : !devices.data?.length ? (
          <p className="muted" style={{ margin: 0 }}>
            No device is set up yet. Turn on alerts above to add this one.
          </p>
        ) : (
          <ul className="ns-meds">
            {devices.data.map((d, i) => {
              const info = describeDevice(d, { myEndpoint, index: i, all: devices.data, shortDate, prettyClock });
              return (
                <li key={d.id} className={`ns-med${info.current ? ' is-current' : ''}`}>
                  <span className="gdev__ic" aria-hidden="true"><Icon name={d.push_enabled ? 'bell' : 'close'} size={18} /></span>
                  <div className="ns-med__main">
                    <div className="ns-med__name">
                      {info.name}
                      {info.current && <span className="contact__type">This device</span>}
                    </div>
                    <div className="ns-med__meta">{info.meta}</div>
                    {/* Last-sent and last-error are shown so a silent failure
                        is visible instead of being a mystery. */}
                    <div className="ns-med__meta">
                      {d.last_error
                        ? <span className="ns-err">{d.last_error}</span>
                        : info.lastSent}
                    </div>
                  </div>
                  <button type="button" className="gdev__revoke" aria-label={`Remove ${info.name}${info.current ? ' (this device)' : ''}, ${info.meta}`}
                    onClick={async () => {
                      const last = devices.data.length === 1;
                      const ok = await ui.confirm({
                        title: `Stop alerts on ${info.current ? 'this device' : info.name}?`,
                        message: `${info.name} (${info.meta}) will stop receiving alerts.${last ? ' It is the only device set up, so no device will get your reminders or missed-dose alerts.' : ''}`,
                        confirmLabel: 'Stop alerts', danger: true,
                      });
                      if (!ok) return;
                      try { await forgetNotificationDevice(d.id); devices.reload(); ui.toast(`${info.name} removed.`, 'info'); }
                      catch { ui.toast('Could not remove it.', 'bad'); }
                    }}>Remove</button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 15 }}>
          Guardian devices are listed separately under <b>Guardians</b> in Profile.
        </p>
      </Collapsible>

      {saving && <span className="sr-only" role="status">Saving…</span>}
    </div>
  );
}

// One setting. The title and description carry ids so the control can be
// labelled by them (a <label for> for a select; aria-labelledby for a switch).
// Several dropdowns here had visible text but no programmatic name at all.
function Row({ id, title, desc, children, dim, control }) {
  return (
    <div className={`ns-row${dim ? ' is-dim' : ''}${control === 'select' ? ' ns-row--select' : ''}`}>
      <div className="ns-row__main">
        {control === 'select'
          ? <label className="ns-row__t" id={`${id}-t`} htmlFor={`${id}-c`}>{title}</label>
          : <div className="ns-row__t" id={`${id}-t`}>{title}</div>}
        {desc && <div className="ns-row__d" id={`${id}-d`}>{desc}</div>}
      </div>
      <div className="ns-row__ctl">{children}</div>
    </div>
  );
}
