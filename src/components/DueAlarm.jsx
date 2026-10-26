import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { todaysDoses } from '../lib/db.js';
import { prettyTime } from '../lib/format.js';
import { playAlarm, stopAlarm, alarmEnabled } from '../lib/alarm.js';
import { useDoseActions } from '../hooks/useDoseActions.js';

// The full-screen "Time for your medicine" alarm.
//
// A web app cannot draw over other apps, so this is the next best thing: the
// moment MyDay is in front — opened from the reminder, or already open when
// the push lands — the whole screen becomes one message with one big button,
// and the alarm sounds until it is dealt with.
//
// Opens from two places:
//   * /?due=<doseId>       — the service worker's target for a tapped reminder
//   * a 'myday-due' message — a reminder arriving while MyDay is open
export function DueAlarm() {
  const location = useLocation();
  const navigate = useNavigate();
  const [doseId, setDoseId] = useState(null);
  const [dose, setDose] = useState(null);

  const close = useCallback(() => {
    stopAlarm();
    setDose(null);
    setDoseId(null);
    if (new URLSearchParams(location.search).has('due')) navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate]);
  const { take, pending } = useDoseActions(close);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('due');
    if (id) setDoseId(id);
  }, [location.search]);

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return undefined;
    const onMsg = (e) => { if (e.data?.type === 'myday-due' && e.data.doseId) setDoseId(e.data.doseId); };
    sw.addEventListener('message', onMsg);
    return () => sw.removeEventListener('message', onMsg);
  }, []);

  // Only a dose that is still waiting is worth an alarm: one already taken
  // (on another phone, or from the notification's own button) closes quietly.
  useEffect(() => {
    if (!doseId) return undefined;
    let active = true;
    todaysDoses().then((list) => {
      if (!active) return;
      const d = (list || []).find((x) => String(x.id) === String(doseId));
      if (!d || d.status !== 'pending') { close(); return; }
      setDose(d);
      if (alarmEnabled()) playAlarm();
    }).catch(() => {});
    return () => { active = false; };
  }, [doseId, close]);

  if (!dose) return null;
  const m = dose.medication || {};

  return (
    <div className="due-alarm" role="alertdialog" aria-modal="true" aria-labelledby="due-alarm-t" aria-describedby="due-alarm-d">
      <div className="due-alarm__ring" aria-hidden="true"><Icon name="bell" size={64} /></div>
      <h1 id="due-alarm-t" className="due-alarm__t">Time for your medicine</h1>
      <p id="due-alarm-d" className="due-alarm__med">
        <strong>{m.name || 'Your medicine'}</strong>
        {m.dose ? <span>{m.dose}</span> : null}
        <span className="due-alarm__time">{prettyTime(dose.scheduled_time)} dose</span>
      </p>
      {m.note ? <p className="due-alarm__note">{m.note}</p> : null}
      <div className="due-alarm__actions">
        <Button size="lg" icon="check" disabled={pending.has(dose.id)} onClick={() => { stopAlarm(); take(dose); }}>
          I took it
        </Button>
        <Button size="lg" variant="ghost" onClick={close}>Not yet</Button>
      </div>
    </div>
  );
}
