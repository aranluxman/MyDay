// The Home screen's widgets: which ones show, and in what order. Pure, so the
// rules (new widgets appear, unknown ones are dropped) are tested.

export const WIDGETS = [
  { id: 'quick', name: 'Quick calls', desc: 'Call family, your doctor, your pharmacy or 911', icon: 'phone', on: true },
  { id: 'feeling', name: 'How are you feeling?', desc: 'A one-tap check-in, saved to Updates', icon: 'smile', on: true },
  { id: 'today', name: "Today's medicines", desc: "What's due now and how today is going", icon: 'pill', on: true },
  { id: 'nextVisit', name: 'Next visit', desc: 'Your next appointment and how soon it is', icon: 'calendar', on: true },
  { id: 'diary', name: 'Health diary', desc: 'Your latest note from Updates', icon: 'notes', on: true },
  { id: 'watching', name: 'People I watch', desc: 'Check on someone you help', icon: 'user', on: true },
  { id: 'glance', name: 'Today at a glance', desc: 'Medicines, visits and games in numbers', icon: 'layout', on: false },
  { id: 'week', name: 'This week', desc: 'Seven days of medicines at a glance', icon: 'calendar', on: false },
  { id: 'visitHistory', name: 'Visit history', desc: 'Your last few appointments', icon: 'clock', on: false },
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
// shows up in Updates like any other entry.
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
