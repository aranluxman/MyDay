const keyFor = (userId) => `myday_med_batch:${userId}`;

export function readMedicineBatch(userId) {
  if (!userId) return { items: [], working: null };
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(userId)) || 'null');
    if (saved && Array.isArray(saved.items)) {
      return { items: saved.items, working: saved.working || null };
    }
  } catch {}
  return { items: [], working: null };
}

export function writeMedicineBatch(userId, batch) {
  if (!userId) return;
  try {
    if (!batch.items.length && !batch.working) localStorage.removeItem(keyFor(userId));
    else localStorage.setItem(keyFor(userId), JSON.stringify(batch));
  } catch {}
}

export function clearMedicineBatch(userId) {
  if (!userId) return;
  try { localStorage.removeItem(keyFor(userId)); } catch {}
}
