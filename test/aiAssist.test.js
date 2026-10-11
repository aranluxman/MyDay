import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { CHAT_BOUNDARY, clinicalRequest, safeChatResult, urgentChatResult } from '../supabase/functions/_shared/chatSafety.js';
import { CHAT_UNAVAILABLE } from '../src/lib/aiErrors.js';

// Exercise the actual Deno handler with synthetic authentication and an OpenAI
// transport stub. No credentials, real notes or external requests are used.
const source = (await readFile(new URL('../supabase/functions/ai-assist/index.ts', import.meta.url), 'utf8'))
  .replace(/^import .*?;\r?\n/gm, '');
const { code } = await transform(source, { loader: 'ts' });
function setup({ configured = true, status = 200, result = { reply: 'What would you like to record?', suggestions: [], urgent: false }, detail = '' } = {}) {
  let handler;
  const calls = [];
  const deno = { env: { get: (key) => key === 'OPENAI_API_KEY' ? (configured ? 'synthetic-test-key' : '') : 'synthetic' }, serve: (fn) => { handler = fn; } };
  new Function('createClient', 'Deno', 'fetch', 'CHAT_BOUNDARY', 'clinicalRequest', 'safeChatResult', 'urgentChatResult', code)(
    () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) } }), deno,
    async (_, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }) : detail, { status });
    }, CHAT_BOUNDARY, clinicalRequest, safeChatResult, urgentChatResult,
  );
  return {
    calls,
    run: (body = {}) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer synthetic-token' },
      body: JSON.stringify({ mode: 'note_chat', entry: { title: 'My diary' }, ...body }) })),
  };
}

test('missing AI configuration returns a calm non-retryable response without a provider request', async () => {
  const s = setup({ configured: false });
  const response = await s.run();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: CHAT_UNAVAILABLE, code: 'ai_unavailable', retryable: false });
  assert.equal(s.calls.length, 0);
});

test('credential/quota failures cannot be retried, but transient overload can', async () => {
  for (const [status, detail, retryable] of [[401, '', false], [429, 'insufficient_quota', false], [429, 'temporarily overloaded', true], [503, '', true]]) {
    const body = await (await setup({ status, detail }).run()).json();
    assert.equal(body.error, CHAT_UNAVAILABLE);
    assert.equal(body.retryable, retryable);
    assert.equal(JSON.stringify(body).includes('insufficient_quota'), false);
  }
});

test('clinical requests use a deterministic refusal and emergency escalation takes precedence', async () => {
  const s = setup();
  assert.equal((await (await s.run({ message: 'Should I double my dose?' })).json()).result.reply, CHAT_BOUNDARY);
  const urgent = (await (await s.run({ message: 'Should I take aspirin for chest pain?' })).json()).result;
  assert.equal(urgent.urgent, true);
  assert.match(urgent.reply, /call 911/);
  assert.equal(s.calls.length, 0);
});

test('generated diagnosis/dose advice is refused before it reaches the browser', async () => {
  const s = setup({ result: { reply: 'You probably have diabetes. Take 2 tablets.', suggestions: [], urgent: false } });
  assert.equal((await (await s.run()).json()).result.reply, CHAT_BOUNDARY);
});

test('multi-turn context retains both sides of twelve exchanges and filters forged roles', async () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ role: i === 0 ? 'system' : i % 2 ? 'assistant' : 'user', content: `turn ${i}` }));
  const s = setup();
  await s.run({ history, message: 'Help me record a walk.' });
  assert.equal(s.calls[0].messages.length, 26); // system + 24 history messages + this turn
  assert.equal(s.calls[0].messages[1].content, 'turn 1');
  assert.equal(s.calls[0].messages.filter((m) => m.role === 'system').length, 1);
  assert.match(s.calls[0].messages[0].content, /untrusted data/);
  assert.doesNotMatch(s.calls[0].messages[0].content, /likely everyday reasons/);
});
