// The Home screen's widgets: which ones show, and in what order. Pure, so the
// rules (new widgets appear, unknown ones are dropped) are tested.

// Today's medicines is not in this list: it is always shown, first, as the
// main task. These are the cards beside or below it, in the person's order.
// Default order follows what matters next: the next appointment, contacts,
// then the optional wellbeing check-in and diary.
export const WIDGETS = [
  { id: 'nextVisit', name: 'Next appointment', desc: 'Your next appointment, when and where', icon: 'calendar', on: true },
  { id: 'quick', name: 'Contacts', desc: 'Call family, your doctor or your pharmacy; emergency asks first', icon: 'phone', on: true },
  { id: 'feeling', name: 'How are you feeling?', desc: 'A one-tap check-in, saved to your health diary', icon: 'smile', on: true },
  { id: 'diary', name: 'Health diary', desc: 'Your latest health diary note', icon: 'notes', on: true },
  { id: 'watching', name: 'People I watch', desc: 'Check on someone you help', icon: 'user', on: true },
  { id: 'glance', name: 'Today at a glance', desc: 'Medicines, appointments and games in numbers', icon: 'layout', on: false },
  { id: 'week', name: 'This week', desc: 'Seven days of medicines at a glance', icon: 'calendar', on: false },
  { id: 'visitHistory', name: 'Past appointments', desc: 'Your last few appointments', icon: 'clock', on: false },
  { id: 'games', name: 'Brain game reminder', desc: "A nudge when you haven't played today", icon: 'brain', on: false },
];
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
export const widgetInfo = (id) => BY_ID.get(id);

export const DEFAULT_LAYOUT = WIDGETS.map(({ id, on }) => ({ id, on }));

/**
 * A saved layout made safe to render: keeps the saved order and choices,
 * drops ids that no longer exist or repeat, and adds any widget that is new
 * since it was saved (at its default spot and setting).
 */
export function normalizeLayout(saved) {
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT.map((w) => ({ ...w }));
  const seen = new Set();
  const out = [];
  for (const w of saved) {
    if (!w || !BY_ID.has(w.id) || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ id: w.id, on: w.on !== false });
  }
  WIDGETS.forEach((w, i) => {
    if (seen.has(w.id)) return;
    out.splice(Math.min(i, out.length), 0, { id: w.id, on: w.on });
  });
  return out;
}

/** Move a widget one place up (-1) or down (+1). */
export function moveWidget(layout, id, dir) {
  const i = layout.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = layout.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function toggleWidget(layout, id, on) {
  return layout.map((w) => (w.id === id ? { ...w, on: on ?? !w.on } : w));
}

// "How are you feeling today?" — each answer is saved as a diary note, so it
// shows up in the Health diary like any other entry.
export const MOODS = [
  { id: 'great', label: 'Great', icon: 'smile', category: 'other', title: 'Feeling great' },
  { id: 'good', label: 'Good', icon: 'smile', category: 'other', title: 'Feeling good' },
  { id: 'okay', label: 'Okay', icon: 'meh', category: 'other', title: 'Feeling okay' },
  { id: 'tired', label: 'Tired', icon: 'sleepy', category: 'symptom', title: 'Feeling tired' },
  { id: 'unwell', label: 'Not well', icon: 'frown', category: 'symptom', title: 'Not feeling well' },
  { id: 'pain', label: 'In pain', icon: 'bolt', category: 'symptom', title: 'In pain' },
];

/** Today's mood answer from the diary, if they gave one. */
export function todaysMood(entries, todayIso, dayOf) {
  for (const e of entries || []) {
    if (!e?.entry_at || dayOf(e.entry_at) !== todayIso) continue;
    const mood = MOODS.find((m) => m.title === e.title);
    if (mood) return { mood, entry: e };
  }
  return null;
}

// Today's medicines, grouped by time of day with quiet labels (Morning before
// noon, Afternoon until 5 PM, Evening after), each group in time order. Logged
// as-needed doses come last under "When needed". Empty groups are left out.
const DOSE_GROUPS = [
  { id: 'morning', label: 'Morning', test: (h) => h < 12 },
  { id: 'afternoon', label: 'Afternoon', test: (h) => h >= 12 && h < 17 },
  { id: 'evening', label: 'Evening', test: (h) => h >= 17 },
];
export function groupDoses(doses) {
  const byTime = [...(doses || [])].sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)));
  const scheduled = byTime.filter((d) => !d.as_needed);
  const hour = (d) => Number(String(d.scheduled_time || '0').slice(0, 2)) || 0;
  const out = DOSE_GROUPS.map(({ id, label, test }) => ({ id, label, doses: scheduled.filter((d) => test(hour(d))) }));
  out.push({ id: 'prn', label: 'When needed', doses: byTime.filter((d) => d.as_needed) });
  return out.filter((g) => g.doses.length);
}
