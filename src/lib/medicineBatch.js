import { meaningfulMedicineDraft } from './medicineDraft.js';

const keyFor = (userId) => `myday_med_batch:${userId}`;
const meaningfulWorking = (working) => working && (working.index != null || meaningfulMedicineDraft(working.form)) ? working : null;

export function readMedicineBatch(userId) {
  if (!userId) return { items: [], working: null };
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(userId)) || 'null');
    if (saved && Array.isArray(saved.items)) {
      return { items: saved.items, working: meaningfulWorking(saved.working) };
    }
  } catch {}
  return { items: [], working: null };
}

export function writeMedicineBatch(userId, batch) {
  if (!userId) return;
  try {
    batch = { ...batch, working: meaningfulWorking(batch.working) };
    if (!batch.items.length && !batch.working) localStorage.removeItem(keyFor(userId));
    else localStorage.setItem(keyFor(userId), JSON.stringify(batch));
  } catch {}
}

export function clearMedicineBatch(userId) {
  if (!userId) return;
  try { localStorage.removeItem(keyFor(userId)); } catch {}
}
