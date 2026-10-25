import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchSession } from '../src/lib/sessionLifecycle.js';

const session = { user: { id: 'person' } };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(getSession) {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const timers = new Map();
  let timerId = 0;
  win.setTimeout = (fn) => { timers.set(++timerId, fn); return timerId; };
  win.clearTimeout = (id) => timers.delete(id);
  let emit;
  const sessions = [];
  const errors = [];
  const recovery = [];
  const watcher = watchSession({
    getSession,
    onAuthStateChange(callback) {
      emit = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  }, {
    onSession: (s) => sessions.push(s),
    onError: (e) => errors.push(e),
    onRecovery: (r) => recovery.push(r),
  }, { window: win, document: doc });
  return { watcher, win, doc, timers, sessions, errors, recovery, emit: (...args) => emit(...args) };
}

test('offline startup keeps login unresolved, then reconnects without credentials', async () => {
  let offline = true;
  const h = setup(async () => offline
    ? { data: { session: null }, error: { name: 'AuthRetryableFetchError' } }
    : { data: { session }, error: null });
  h.emit('INITIAL_SESSION', null);
  await tick();
  assert.deepEqual(h.sessions, []);
  assert.match(h.errors.at(-1), /reconnect/);
  assert.equal(h.timers.size, 1);
  offline = false;
  h.win.dispatchEvent(new Event('online'));
  await tick();
  assert.deepEqual(h.sessions, [session]);
  assert.equal(h.errors.at(-1), null);
  assert.equal(h.timers.size, 0);
  h.watcher.unsubscribe();
});

test('failed wake check preserves an existing session and retries on foreground', async () => {
  let offline = false;
  const h = setup(async () => {
    if (offline) throw new TypeError('Failed to fetch');
    return { data: { session }, error: null };
  });
  await tick();
  offline = true;
  await h.watcher.retry();
  assert.deepEqual(h.sessions, [session]);
  offline = false;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  await tick();
  assert.equal(h.errors.at(-1), null);
  h.watcher.unsubscribe();
});

test('sign-out wins over an in-flight lookup and cannot restore an old session', async () => {
  let resolve;
  const h = setup(() => new Promise((r) => { resolve = r; }));
  h.emit('SIGNED_OUT', null);
  resolve({ data: { session }, error: null });
  await tick();
  assert.deepEqual(h.sessions, [null]);
  assert.deepEqual(h.recovery, [false]);
  assert.equal(h.timers.size, 0);
  h.watcher.unsubscribe();
});

test('token refresh wins over an older failed lookup', async () => {
  let resolve;
  const h = setup(() => new Promise((r) => { resolve = r; }));
  h.emit('TOKEN_REFRESHED', session);
  resolve({ data: { session: null }, error: new Error('network') });
  await tick();
  assert.deepEqual(h.sessions, [session]);
  assert.deepEqual(h.errors, [null]);
  assert.equal(h.timers.size, 0);
  h.watcher.unsubscribe();
});

test('a genuinely empty session shows the signed-out app', async () => {
  const h = setup(async () => ({ data: { session: null }, error: null }));
  await tick();
  assert.deepEqual(h.sessions, [null]);
  assert.equal(h.errors.at(-1), null);
  h.watcher.unsubscribe();
});

test('scheduled retry recovers without a manual click or online event', async () => {
  let calls = 0;
  const h = setup(async () => ++calls === 1
    ? { data: { session: null }, error: new Error('network') }
    : { data: { session }, error: null });
  await tick();
  await [...h.timers.values()][0]();
  assert.equal(calls, 2);
  assert.deepEqual(h.sessions, [session]);
  assert.equal(h.timers.size, 0);
  h.watcher.unsubscribe();
});

test('repeated wake and retry requests share an in-flight lookup', async () => {
  let calls = 0;
  let resolve;
  const h = setup(() => { calls++; return new Promise((r) => { resolve = r; }); });
  h.win.dispatchEvent(new Event('online'));
  h.doc.dispatchEvent(new Event('visibilitychange'));
  await h.watcher.retry();
  assert.equal(calls, 1);
  resolve({ data: { session }, error: null });
  await tick();
  h.watcher.unsubscribe();
});

test('recovery events are preserved and cleanup ignores pending results and wakes', async () => {
  let resolve;
  let calls = 0;
  const h = setup(() => { calls++; return new Promise((r) => { resolve = r; }); });
  h.emit('PASSWORD_RECOVERY', session);
  assert.deepEqual(h.recovery, [true]);
  h.watcher.unsubscribe();
  resolve({ data: { session: null }, error: new Error('network') });
  h.win.dispatchEvent(new Event('online'));
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(h.sessions, [session]);
  assert.equal(h.timers.size, 0);
});
