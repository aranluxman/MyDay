// An in-memory stand-in for the Supabase project, used only by the browser
// tests. EVERY request to the real project URL is answered here (and any
// other external request is aborted), so tests can never read or change a
// real record, send a notification, or call the AI service.
//
// It implements just enough of PostgREST and the RPCs MyDay uses:
//   GET/POST/PATCH/DELETE /rest/v1/<table> with eq/neq/gte/lte/in/is filters,
//   embedded selects (alias:table(cols)), single/maybeSingle, upsert, count,
//   and the dose RPCs from migration 0017 with the same idempotent semantics
//   (verified separately against real Postgres in test/sql/0017_test.sql).

export const PROJECT = 'https://cthpunnnkdgukuogyvxm.supabase.co';
export const USER_ID = '00000000-0000-4000-8000-00000000aaaa';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function fakeSession() {
  const exp = Math.floor(Date.parse('2030-01-01T00:00:00Z') / 1000);
  const user = {
    id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.test',
    user_metadata: { full_name: 'Sam Synthetic' }, app_metadata: { provider: 'email' }, created_at: '2026-01-01T00:00:00Z',
  };
  const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, exp, role: 'authenticated', aud: 'authenticated', email: user.email })}.c2lnbmF0dXJl`;
  return { access_token: access, refresh_token: 'synthetic-refresh', expires_in: 3600 * 24 * 365, expires_at: exp, token_type: 'bearer', user };
}

const uid = () => crypto.randomUUID();

/** Synthetic fixtures. `now` is the frozen clock time (ms). */
export function makeFixtures(now) {
  const day = (offset) => new Date(now + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const due = (iso, hhmm) => new Date(`${iso}T${hhmm}:00-04:00`).toISOString();
  const meds = [
    { id: 'm-met', name: 'Synthetic Metformin', dose: '1 tablet', dose_amount: 1, dose_unit: 'tablet', times: ['08:00', '20:00'], frequency: 'daily', color: '#2563a8', strength: '500 mg', stock_quantity: 30, refill_threshold: 10 },
    { id: 'm-vitd', name: 'Synthetic Vitamin D', dose: '1000 IU', dose_amount: 1000, dose_unit: 'IU', times: ['09:00'], frequency: 'daily', color: '#1e7a3d' },
    { id: 'm-long', name: 'Synthetic Hydrochlorothiazide Extended Release', dose: '2.75 mg', dose_amount: 2.75, dose_unit: 'mg', times: ['21:00'], frequency: 'daily', color: '#6d28d9', instructions: 'Swallow whole.' },
    { id: 'm-prn', name: 'Synthetic Acetaminophen', dose: '1 tablet', dose_amount: 1, dose_unit: 'tablet', times: [], frequency: 'as_needed', color: '#b3261e' },
  ].map((m) => ({
    user_id: USER_ID, active: true, note: null, days_of_week: null, start_date: null, end_date: null, with_food: false,
    photo_path: null, reminders_enabled: true, alert_window_override: null, dose_other: null, created_at: '2026-09-01T12:00:00Z',
    strength: null, route: null, instructions: null, stock_quantity: null, refill_threshold: null, pharmacy_contact_id: 'c-pharm', prescriber_contact_id: null,
    ...m,
  }));

  const doses = [];
  const add = (med, d, t, status, extra = {}) => doses.push({
    id: `d-${med}-${d}-${t}`, user_id: USER_ID, medication_id: med, dose_date: d, scheduled_time: t, due_at: due(d, t),
    status, taken_at: status === 'taken' ? due(d, t) : null, notified: false, skip_reason: null, skipped_at: null,
    name_snapshot: null, dose_snapshot: null, stock_used: null, as_needed: false, logged_via: null, created_at: due(d, '00:00'), ...extra,
  });
  // Past week. Oct 2–4 keep server status 'pending' although their time is
  // long gone (the sweep did not run) — the audit's "To take vs Missed" case.
  for (let i = 6; i >= 1; i--) {
    const d = day(-i);
    const stale = i >= 3 && i <= 5;
    add('m-met', d, '08:00', stale ? 'pending' : 'taken');
    add('m-met', d, '20:00', i === 1 ? 'missed' : stale ? 'pending' : 'taken');
    add('m-vitd', d, '09:00', i === 2 ? 'skipped' : 'taken', i === 2 ? { skip_reason: 'I felt unwell' } : {});
    add('m-long', d, '21:00', 'taken');
  }
  // Today: 8:00 pending but past its window (missed by the shared rule),
  // 9:00 due/overdue, evening ones upcoming.
  const t = day(0);
  add('m-met', t, '08:00', 'pending');
  add('m-vitd', t, '09:00', 'pending');
  add('m-met', t, '20:00', 'pending');
  add('m-long', t, '21:00', 'pending');

  return {
    myday_profiles: [{
      user_id: USER_ID, full_name: 'Sam Synthetic', birthday: '1950-05-05', age: null, for_whom: 'self',
      on_treatment: 'Synthetic list', goal: 'Stay well', timezone: 'America/Toronto', theme: 'light', text_size: 'normal',
      avatar_color: '#2563a8', avatar_url: 'https://example.test/avatar.png', alert_window_minutes: 60,
    }],
    myday_medications: meds,
    myday_doses: doses,
    myday_appointments: [{ id: 'a1', user_id: USER_ID, appt_date: day(3), appt_time: '10:30', doctor_name: 'Dr. Synthetic', location: 'Test Clinic', reason: 'Check-up' }],
    myday_contacts: [
      { id: 'c-pharm', user_id: USER_ID, type: 'pharmacy', name: 'Synthetic Pharmacy', phone: '(555) 010-2000', email: null, address: null, notes: null, relationship: null, is_emergency: false },
    ],
    myday_notification_prefs: [{
      user_id: USER_ID, master: true, dose_due: true, dose_missed: true, appointment: true, daily_summary: false,
      game_nudge: false, guardian_alert: true, appointment_lead_minutes: 120, daily_summary_at: '09:00',
      repeat_every_minutes: 15, repeat_max_times: 2, snooze_minutes: 15, quiet_hours_enabled: false,
      quiet_from: '21:00', quiet_to: '07:00', sound: true, vibrate: true,
    }],
    // The audit's two indistinguishable rows.
    myday_family_devices: [
      { id: 'fd1', user_id: USER_ID, label: 'This phone', platform: 'ios', installed: true, endpoint: 'https://push.example.test/1', push_enabled: true, last_delivered_at: null, last_notified_at: '2026-10-06T13:00:00Z', last_error: null, created_at: '2026-09-02T12:00:00Z' },
      { id: 'fd2', user_id: USER_ID, label: 'This phone', platform: 'android', installed: false, endpoint: 'https://push.example.test/2', push_enabled: true, last_delivered_at: null, last_notified_at: '2026-10-06T13:00:00Z', last_error: null, created_at: '2026-09-20T12:00:00Z' },
    ],
    myday_guardians: [],
    myday_guardian_devices: [],
    myday_game_results: [],
    myday_diary: [],
    myday_cards: [],
    myday_refills: [],
    myday_account_guardians: [],
  };
}

const SINGULAR = { myday_medications: 'medication', myday_guardians: 'guardian', myday_doses: 'dose', myday_contacts: 'contact' };

function parseFilters(params) {
  const out = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gte|lte|gt|lt|in|is|like|ilike)\.(.*)$/s.exec(v);
    if (!m) continue;
    out.push({ col: k, neg: !!m[1], op: m[2], val: m[3] });
  }
  return out;
}
function test(row, f) {
  const v = row[f.col];
  let r;
  const val = f.val;
  switch (f.op) {
    case 'eq': r = String(v) === val; break;
    case 'neq': r = String(v) !== val; break;
    case 'gte': r = v != null && String(v) >= val; break;
    case 'lte': r = v != null && String(v) <= val; break;
    case 'gt': r = v != null && String(v) > val; break;
    case 'lt': r = v != null && String(v) < val; break;
    case 'in': r = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v)); break;
    case 'is': r = val === 'null' ? v == null : String(v) === val; break;
    default: r = true;
  }
  return f.neg ? !r : r;
}

function project(db, table, row, select) {
  if (!select || select === '*') return { ...row };
  const out = {};
  // split top-level commas
  const parts = []; let depth = 0; let cur = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  for (const p of parts) {
    const emb = /^(?:(\w+):)?(\w+)\((.*)\)$/s.exec(p);
    if (emb) {
      const alias = emb[1] || emb[2];
      const t2 = emb[2];
      const rows = db[t2] || [];
      const fk = `${SINGULAR[t2] || t2}_id`;
      if (fk in row) {
        const hit = rows.find((r) => r.id === row[fk]);
        out[alias] = hit ? project(db, t2, hit, emb[3]) : null;
      } else {
        const back = `${SINGULAR[table] || table}_id`;
        out[alias] = rows.filter((r) => r[back] === row.id).map((r) => project(db, t2, r, emb[3]));
      }
    } else if (p === '*') Object.assign(out, row);
    else out[p] = row[p];
  }
  return out;
}

/**
 * Installs the mock on a Playwright page. Returns { db, calls } so tests can
 * inspect what the app sent. `options.offline` makes every write fail like a
 * dropped connection.
 */
export async function installMock(page, { now, fixtures, onCall } = {}) {
  const db = fixtures || makeFixtures(now);
  const calls = [];
  const session = fakeSession();
  // Server time follows the page's frozen clock (plus real time elapsed), so
  // a taken_at written "now" matches what the page considers now.
  const started = Date.now();
  const state = { offline: false };

  await page.addInitScript(([key, s]) => {
    try { localStorage.setItem(key, JSON.stringify(s)); } catch {}
  }, ['sb-cthpunnnkdgukuogyvxm-auth-token', session]);

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (!req.url().startsWith(PROJECT)) return route.abort();
    const json = (body, status = 200, headers = {}) => route.fulfill({
      status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers },
      body: body === undefined ? '' : JSON.stringify(body),
    });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

    const path = url.pathname;
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const call = { method: req.method(), path, search: url.search, body };
    calls.push(call);
    onCall?.(call);

    if (path.startsWith('/auth/v1/settings')) return json({ external: { google: false, email: true } });
    if (path.startsWith('/auth/v1/user')) return json(session.user);
    if (path.startsWith('/auth/v1/token')) return json(session);
    if (path.startsWith('/auth/v1/logout')) return json({});
    if (path.startsWith('/functions/v1/')) return json({ ok: true, delivered: 0 });
    if (path.startsWith('/storage/v1/')) return json({ error: 'not in tests' }, 400);

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length);
      if (state.offline) return route.abort('internetdisconnected');
      return json(rpc(db, fn, body || {}, now + (Date.now() - started)));
    }

    if (state.offline) return route.abort('internetdisconnected');
    const table = path.slice('/rest/v1/'.length);
    db[table] ||= [];
    const rows = db[table];
    const filters = parseFilters(url.searchParams);
    const select = url.searchParams.get('select');
    const accept = req.headers().accept || '';
    const prefer = req.headers().prefer || '';
    const single = accept.includes('vnd.pgrst.object');
    const respond = (list, status = 200) => {
      const out = list.map((r) => project(db, table, r, select || '*'));
      if (single) {
        if (out.length !== 1) return json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${out.length} rows` }, 406);
        return json(out[0], status);
      }
      return json(out, status, { 'content-range': `0-${Math.max(0, out.length - 1)}/${out.length}` });
    };

    if (req.method() === 'GET' || req.method() === 'HEAD') {
      let list = rows.filter((r) => filters.every((f) => test(r, f)));
      const order = url.searchParams.get('order');
      if (order) {
        const keys = order.split(',').map((o) => o.split('.'));
        list = [...list].sort((a, b) => {
          for (const [k, dir] of keys) {
            const x = a[k]; const y = b[k];
            if (x === y) continue;
            const c = String(x ?? '') < String(y ?? '') ? -1 : 1;
            return dir === 'desc' ? -c : c;
          }
          return 0;
        });
      }
      const limit = Number(url.searchParams.get('limit'));
      if (limit) list = list.slice(0, limit);
      if (req.method() === 'HEAD' || prefer.includes('count=exact')) {
        return route.fulfill({ status: 200, headers: { 'content-range': `0-0/${list.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: req.method() === 'HEAD' ? '' : JSON.stringify(list) });
      }
      return respond(list);
    }
    if (req.method() === 'POST') {
      const items = Array.isArray(body) ? body : [body];
      const conflict = url.searchParams.get('on_conflict');
      const out = [];
      for (const item of items) {
        const key = conflict || 'id';
        const existing = item[key] != null ? rows.find((r) => String(r[key]) === String(item[key])) : null;
        if (existing) {
          if (prefer.includes('ignore-duplicates')) continue;
          Object.assign(existing, item);
          out.push(existing);
        } else {
          const row = { id: uid(), user_id: USER_ID, created_at: new Date().toISOString(), active: true, ...item };
          rows.push(row);
          out.push(row);
        }
      }
      return prefer.includes('return=representation') ? respond(out, 201) : json(undefined, 201);
    }
    if (req.method() === 'PATCH') {
      const hit = rows.filter((r) => filters.every((f) => test(r, f)));
      for (const r of hit) Object.assign(r, body);
      return prefer.includes('return=representation') ? respond(hit) : json(undefined, 204);
    }
    if (req.method() === 'DELETE') {
      const keep = rows.filter((r) => !filters.every((f) => test(r, f)));
      const gone = rows.filter((r) => filters.every((f) => test(r, f)));
      db[table] = keep;
      return prefer.includes('return=representation') ? respond(gone) : json(undefined, 204);
    }
    return json({ message: 'unsupported' }, 400);
  });

  return { db, calls, setOffline: (v) => { state.offline = v; } };
}

// The RPCs, with the semantics of migrations 0009/0017.
function rpc(db, fn, a, now) {
  const doses = db.myday_doses;
  const meds = db.myday_medications;
  if (fn === 'myday_refresh_doses' || fn === 'myday_sync_medication_doses') return null;
  if (fn === 'myday_take_dose') {
    const d = doses.find((x) => x.id === a.p_dose_id);
    if (!d) return { outcome: 'not_found' };
    if (d.status === 'taken') return { outcome: 'already_taken', taken_at: d.taken_at };
    if (d.status === 'skipped') return { outcome: 'skipped' };
    if (Date.parse(d.due_at) > now + 30 * 60000) return { outcome: 'not_due' };
    const m = meds.find((x) => x.id === d.medication_id);
    let used = null;
    if (m?.stock_quantity != null && m.dose_amount != null) { used = Math.min(m.dose_amount, m.stock_quantity); m.stock_quantity -= used; }
    Object.assign(d, { status: 'taken', taken_at: a.p_taken_at || new Date(now).toISOString(), stock_used: used, name_snapshot: m?.name, dose_snapshot: m?.dose });
    return { outcome: 'taken', taken_at: d.taken_at, stock_quantity: m?.stock_quantity ?? null };
  }
  if (fn === 'myday_untake_dose') {
    const d = doses.find((x) => x.id === a.p_dose_id);
    if (!d) return { outcome: 'not_found' };
    if (!['taken', 'skipped'].includes(d.status)) return { outcome: 'unchanged' };
    const m = meds.find((x) => x.id === d.medication_id);
    if (d.stock_used != null && m?.stock_quantity != null) m.stock_quantity += d.stock_used;
    if (d.as_needed) { db.myday_doses = doses.filter((x) => x !== d); return { outcome: 'removed' }; }
    Object.assign(d, { status: 'pending', taken_at: null, stock_used: null, skip_reason: null, skipped_at: null });
    return { outcome: 'pending' };
  }
  if (fn === 'myday_log_prn_dose') {
    if (doses.some((x) => x.id === a.p_client_id)) return { outcome: 'already_taken', id: a.p_client_id };
    const m = meds.find((x) => x.id === a.p_medication_id);
    if (!m) return { outcome: 'not_found' };
    const at = a.p_taken_at || new Date(now).toISOString();
    const local = new Date(at).toLocaleString('sv-SE', { timeZone: 'America/Toronto' });
    const row = { id: a.p_client_id, user_id: USER_ID, medication_id: m.id, dose_date: local.slice(0, 10), scheduled_time: local.slice(11, 16), due_at: at, status: 'taken', taken_at: at, as_needed: true, notified: false };
    if (doses.some((x) => x.medication_id === m.id && x.dose_date === row.dose_date && x.scheduled_time === row.scheduled_time)) return { outcome: 'already_taken' };
    doses.push(row);
    return { outcome: 'taken', id: row.id, taken_at: at };
  }
  if (fn === 'myday_record_refill') {
    const m = meds.find((x) => x.id === a.p_medication_id);
    if (m) m.stock_quantity = (m.stock_quantity || 0) + Number(a.p_quantity);
    return { stock_quantity: m?.stock_quantity ?? null };
  }
  return null;
}
