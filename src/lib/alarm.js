// A loud alarm for a missed dose. A web app cannot raise the phone's
// notification volume or choose its ringtone, so while MyDay is open it plays
// its own sound: about 15 seconds of sharp two-tone beeps, made with Web Audio
// so there is no sound file to download or fail to load. Any tap stops it.
//
// Only the SECOND notification (the missed dose) beeps like this. The first
// one ("Time for your medicine") is an ordinary notification with the phone's
// normal sound.
//
// Each missed dose sounds once. The ids already played are remembered on this
// device so reopening the app does not set it off again for the same dose.

const PLAYED_KEY = 'myday_alarm_played';
const SOUND_KEY = 'myday_alarm_sound';
const KEEP = 50;

let ctx = null;
let out = null;
const SECONDS = 15;
const BEAT = 0.25; // one beep every quarter second

// Mirrors the "Sound" switch in Alerts (and the master switch), saved on the
// device so the alarm can check it without a network request.
export function setAlarmEnabled(on) {
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch {}
}
export function alarmEnabled() {
  try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; }
}

function played() {
  try { return JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]') || []; } catch { return []; }
}

/** True the first time it is called for a dose id, then false for that id. */
export function claimAlarm(doseId, store = { get: played, set: savePlayed }) {
  const list = store.get();
  const id = String(doseId);
  if (list.includes(id)) return false;
  store.set([...list, id].slice(-KEEP));
  return true;
}
function savePlayed(list) {
  try { localStorage.setItem(PLAYED_KEY, JSON.stringify(list)); } catch {}
}

/** About 15 seconds of loud alternating beeps. Returns false if it could not play. */
export function playAlarm() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return false;
  try {
    ctx = ctx || new AC();
    // Browsers keep sound off until the person has touched the page. If it is
    // still locked, the alarm goes off on their very next tap instead.
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => { if (ctx.state === 'running') beep(); }).catch(() => {});
      const later = () => { ctx.resume().then(beep).catch(() => {}); };
      document.addEventListener('pointerdown', later, { once: true, capture: true });
      return true;
    }
    beep();
    return true;
  } catch { return false; }
}

function beep() {
  if (ctx.__beeping && ctx.currentTime < ctx.__beeping) return;
  try {
    const start = ctx.currentTime + 0.05;
    out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);
    // Pairs of beeps, 880 Hz then 660 Hz, a sound that cuts through a room.
    // A short pause every 2 seconds keeps it from blurring into one tone.
    const count = Math.round(SECONDS / BEAT);
    for (let i = 0; i < count; i++) {
      if (i % 8 === 7) continue;
      const t = start + i * BEAT;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
      g.gain.setValueAtTime(0.9, t + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.23);
    }
    ctx.__beeping = start + SECONDS;
    // The first tap anywhere silences it: the person has noticed.
    setTimeout(() => {
      document.addEventListener('pointerdown', stopAlarm, { once: true, capture: true });
    }, 300);
  } catch {}
}

/** Silences an alarm that is still beeping. */
export function stopAlarm() {
  if (!ctx || !out) return;
  try {
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.disconnect();
  } catch {}
  out = null;
  ctx.__beeping = 0;
}

/** Plays the alarm for this dose unless it already played or sound is off. */
export function playAlarmOnce(doseId) {
  if (!doseId || !alarmEnabled()) return false;
  if (!claimAlarm(doseId)) return false;
  return playAlarm();
}
