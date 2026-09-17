import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { InstallCard, detectDevice } from '../components/InstallCard.jsx';
import { Card, Button, Toggle, SegmentedControl, SkeletonCard } from '../components/ui.jsx';
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
import { prettyClock, prettyTime } from '../lib/format.js';

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
      <button className="ns-back" onClick={() => navigate('/profile')}>
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

      {/* ---- master switch ---- */}
      <Card>
        <Row title="All notifications" desc="One switch for everything below.">
          <Toggle checked={!!prefs.master} onChange={(v) => update({ master: v })} label="All notifications" />
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
      <Card>
        <h3 className="ns-h">What to tell me about</h3>
        {NOTIFICATION_TYPES.map((t) => (
          <Row key={t.id} title={t.label} desc={t.desc} dim={off}>
            <Toggle checked={!!prefs[t.id]} onChange={(v) => update({ [t.id]: v })} label={t.label} />
          </Row>
        ))}
      </Card>

      {/* ---- missed dose ---- */}
      <Card>
        <h3 className="ns-h">Missed doses</h3>
        <p className="muted" style={{ margin: '0 0 10px' }}>
          How long after a dose is due before it counts as missed.
        </p>
        <SegmentedControl
          value={profile?.alert_window_minutes ?? 60}
          onChange={async (v) => {
            try { await updateProfile({ alert_window_minutes: Number(v) }); }
            catch { ui.toast('Could not save.', 'bad'); }
          }}
          options={ALERT_WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />

        <div className="divider" style={{ margin: '16px 0' }} />

        <Row title="Remind me again" desc="Keep reminding me until I mark it as taken.">
          <select className="input input--select" value={prefs.repeat_every_minutes}
            onChange={(e) => update({ repeat_every_minutes: Number(e.target.value) })}>
            {REPEAT_EVERY_CHOICES.map((n) => (
              <option key={n} value={n}>{n === 0 ? 'Just once' : `Every ${n} min`}</option>
            ))}
          </select>
        </Row>
        {prefs.repeat_every_minutes > 0 && (
          <Row title="How many times" desc="Then it stops, so it can never nag all day.">
            <select className="input input--select" value={prefs.repeat_max_times}
              onChange={(e) => update({ repeat_max_times: Number(e.target.value) })}>
              {REPEAT_TIMES_CHOICES.map((n) => (
                <option key={n} value={n}>{n} time{n === 1 ? '' : 's'}</option>
              ))}
            </select>
          </Row>
        )}
        <Row title="Snooze length" desc='What "Snooze" on a notification does.'>
          <select className="input input--select" value={prefs.snooze_minutes}
            onChange={(e) => update({ snooze_minutes: Number(e.target.value) })}>
            {SNOOZE_CHOICES.map((n) => <option key={n} value={n}>{n} minutes</option>)}
          </select>
        </Row>
      </Card>

      {/* ---- appointments + summary ---- */}
      <Card>
        <h3 className="ns-h">Appointments and summaries</h3>
        <Row title="Remind me before a visit" desc="How far ahead.">
          <select className="input input--select" value={prefs.appointment_lead_minutes}
            onChange={(e) => update({ appointment_lead_minutes: Number(e.target.value) })}>
            {APPOINTMENT_LEADS.map((l) => <option key={l.id} value={l.minutes}>{l.label}</option>)}
          </select>
        </Row>
        <Row title="Daily summary time" desc="One message about your whole day.">
          <select className="input input--select" value={prefs.daily_summary_at}
            onChange={(e) => update({ daily_summary_at: e.target.value })}>
            {TIME_CHOICES.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
          </select>
        </Row>
      </Card>

      {/* ---- quiet hours ---- */}
      <Card>
        <h3 className="ns-h">Quiet hours</h3>
        <Row title="Stay quiet at night" desc="No reminders between these times.">
          <Toggle checked={!!prefs.quiet_hours_enabled}
            onChange={(v) => update({ quiet_hours_enabled: v })} label="Quiet hours" />
        </Row>
        {prefs.quiet_hours_enabled && (
          <>
            <div className="ns-two">
              <label className="ns-field">
                <span>From</span>
                <select className="input input--select" value={prefs.quiet_from}
                  onChange={(e) => update({ quiet_from: e.target.value })}>
                  {TIME_CHOICES.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
                </select>
              </label>
              <label className="ns-field">
                <span>Until</span>
                <select className="input input--select" value={prefs.quiet_to}
                  onChange={(e) => update({ quiet_to: e.target.value })}>
                  {TIME_CHOICES.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
                </select>
              </label>
            </div>
            {/* The one exception, stated plainly rather than buried. */}
            <p className="ns-note">
              <Icon name="shield" size={20} />
              Missed-dose alerts still come through during quiet hours. Those are the ones worth
              waking you for.
            </p>
          </>
        )}
      </Card>

      {/* ---- sound and feel ---- */}
      <Card>
        <h3 className="ns-h">Sound and vibration</h3>
        <Row title="Sound" desc="Where your device allows it.">
          <Toggle checked={!!prefs.sound} onChange={(v) => update({ sound: v })} label="Sound" />
        </Row>
        <Row title="Vibration" desc="A long-short-long buzz for a missed dose.">
          <Toggle checked={!!prefs.vibrate} onChange={(v) => update({ vibrate: v })} label="Vibration" />
        </Row>
      </Card>

      {/* ---- per medicine ---- */}
      <Card>
        <h3 className="ns-h">Individual medicines</h3>
        <p className="muted" style={{ margin: '0 0 10px' }}>
          Turn reminders off for one medicine without changing the rest.
        </p>
        {meds.loading ? <SkeletonCard lines={2} /> : !meds.data?.length ? (
          <p className="muted" style={{ margin: 0 }}>You have not added any medicines yet.</p>
        ) : (
          <div className="ns-meds">
            {meds.data.map((m) => (
              <div key={m.id} className="ns-med">
                <span className="dose__chip" style={{ background: m.color || 'var(--primary)' }} aria-hidden="true">
                  <Icon name="pill" size={18} />
                </span>
                <div className="ns-med__main">
                  <div className="ns-med__name">{m.name}</div>
                  <div className="ns-med__meta">
                    {m.frequency === 'as_needed'
                      ? 'Only when needed — never reminded'
                      : (m.times || []).map(prettyTime).join(', ')}
                  </div>
                </div>
                <Toggle checked={m.reminders_enabled !== false}
                  label={`Reminders for ${m.name}`}
                  onChange={async (v) => {
                    try { await setMedicationReminders(m.id, { enabled: v }); meds.reload(); }
                    catch { ui.toast('Could not save.', 'bad'); }
                  }} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---- devices ---- */}
      <Card>
        <h3 className="ns-h">Devices getting your alerts</h3>
        {devices.loading ? <SkeletonCard lines={2} /> : !devices.data?.length ? (
          <p className="muted" style={{ margin: 0 }}>
            No device is set up yet. Turn on alerts above to add this one.
          </p>
        ) : (
          <div className="ns-meds">
            {devices.data.map((d) => (
              <div key={d.id} className="ns-med">
                <span className="gdev__ic"><Icon name={d.push_enabled ? 'bell' : 'close'} size={18} /></span>
                <div className="ns-med__main">
                  <div className="ns-med__name">{d.label || 'A device'}</div>
                  {/* Last-delivered and last-error are shown so a silent
                      failure is visible instead of being a mystery. */}
                  <div className="ns-med__meta">
                    {d.last_error
                      ? <span style={{ color: 'var(--bad-ink)', fontWeight: 700 }}>{d.last_error}</span>
                      : d.last_delivered_at || d.last_notified_at
                        ? `Last alert ${prettyClock(new Date(d.last_delivered_at || d.last_notified_at))}`
                        : 'No alert sent yet'}
                  </div>
                </div>
                <button className="gdev__revoke" onClick={async () => {
                  const ok = await ui.confirm({
                    title: 'Stop alerts on this device?',
                    message: `${d.label || 'This device'} will stop receiving alerts.`,
                    confirmLabel: 'Stop alerts', danger: true,
                  });
                  if (!ok) return;
                  try { await forgetNotificationDevice(d.id); devices.reload(); ui.toast('Removed.', 'info'); }
                  catch { ui.toast('Could not remove it.', 'bad'); }
                }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 15 }}>
          Guardian devices are listed separately under <b>Guardians</b> in Profile.
        </p>
      </Card>

      {saving && <span className="sr-only" role="status">Saving…</span>}
    </div>
  );
}

function Row({ title, desc, children, dim }) {
  return (
    <div className={`ns-row${dim ? ' is-dim' : ''}`}>
      <div className="ns-row__main">
        <div className="ns-row__t">{title}</div>
        {desc && <div className="ns-row__d">{desc}</div>}
      </div>
      <div className="ns-row__ctl">{children}</div>
    </div>
  );
}
