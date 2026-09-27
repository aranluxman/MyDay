// MyDay — the one door to OpenAI.
//
// The OpenAI key lives ONLY here, as a function secret (OPENAI_API_KEY). The
// browser never sees it: the app calls this function with the person's own
// session, and this function calls OpenAI. A key in the web bundle would be
// readable by anyone who opens DevTools.
//
// Three jobs, picked by `mode`:
//   * scan_medicine     — read a photo of a pill box / bottle into the fields
//                          the Add Medicine wizard asks for.
//   * analyze_medicines — plain-language "what each one is for" and "how they
//                          work together" for the person's whole list.
//   * assistant         — turn "make the text much bigger" into a small list of
//                          whitelisted actions the app applies itself.
//
// Every answer is forced into a JSON schema so the app never has to guess at
// free text, and the app re-validates it anyway (src/lib/aiParse.js): the
// model proposes, the app decides.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') || '';
// Vision + structured output. Override with the OPENAI_MODEL secret.
const MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// A compressed phone photo is ~200-400 KB; base64 adds a third. Anything far
// past that is not a photo from the app.
const MAX_IMAGE_CHARS = 4_000_000;
const MAX_MESSAGE_CHARS = 500;
const MAX_MEDS = 40;

/* ------------------------------- schemas ------------------------------- */

const UNIT_ENUM = ['tablet', 'capsule', 'ml', 'drop', 'puff', 'mg', 'IU', 'unit', 'patch', 'sachet', 'injection', 'other'];
const FREQ_ENUM = ['daily', 'days_of_week', 'alternate', 'as_needed'];

const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_medicine', 'name', 'strength', 'dose_amount', 'dose_unit', 'dose_other',
    'times', 'frequency', 'days_of_week', 'with_food', 'note', 'confidence', 'warnings'],
  properties: {
    is_medicine: { type: 'boolean' },
    name: { type: 'string' },
    strength: { type: 'string' },
    dose_amount: { type: 'number' },
    dose_unit: { type: 'string', enum: UNIT_ENUM },
    dose_other: { type: 'string' },
    times: { type: 'array', items: { type: 'string' } },
    frequency: { type: 'string', enum: FREQ_ENUM },
    days_of_week: { type: 'array', items: { type: 'integer' } },
    with_food: { type: 'boolean' },
    note: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'medicines', 'together', 'ask_pharmacist', 'disclaimer'],
  properties: {
    overview: { type: 'string' },
    medicines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'what_it_is', 'helps_with', 'benefits', 'tip'],
        properties: {
          name: { type: 'string' },
          what_it_is: { type: 'string' },
          helps_with: { type: 'array', items: { type: 'string' } },
          benefits: { type: 'array', items: { type: 'string' } },
          tip: { type: 'string' },
        },
      },
    },
    together: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'goals'],
      properties: {
        summary: { type: 'string' },
        goals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['goal', 'medicines', 'how'],
            properties: {
              goal: { type: 'string' },
              medicines: { type: 'array', items: { type: 'string' } },
              how: { type: 'string' },
            },
          },
        },
      },
    },
    ask_pharmacist: { type: 'array', items: { type: 'string' } },
    disclaimer: { type: 'string' },
  },
};

const ACTION_TYPES = ['set_text_size', 'set_theme', 'set_setting', 'update_profile', 'navigate'];
const ASSISTANT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions'],
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'key', 'value'],
        properties: {
          type: { type: 'string', enum: ACTION_TYPES },
          key: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
  },
};

/* ------------------------------- prompts ------------------------------- */

const SCAN_PROMPT = `You read photos of medicine packaging (pill bottles, boxes, blister packs, pharmacy labels) for MyDay, a medication app used mostly by older adults.

Extract what the label actually says. Never invent a dose or schedule the label does not show.
- name: the medicine's name as a person would say it, with the brand OR generic name (e.g. "Metformin", "Vitamin D3"). Do not include the strength here.
- strength: the strength printed on the pack, e.g. "500 mg", "1000 IU". Empty string if none.
- dose_amount + dose_unit: how much is taken AT ONE TIME. A pharmacy label saying "take 1 tablet twice daily" means 1 tablet. If only a strength is visible (e.g. a vitamin bottle "1000 IU", "take one softgel daily") prefer the countable unit: 1 capsule. Use "other" with dose_other (e.g. "softgel", "scoop", "gummy") only when no listed unit fits; otherwise dose_other is "".
- times: 24-hour "HH:MM" strings. Map directions to typical times: once daily/in the morning -> ["08:00"]; twice daily -> ["08:00","20:00"]; three times -> ["08:00","14:00","20:00"]; four times -> ["08:00","12:00","16:00","20:00"]; at bedtime -> ["21:00"]; with dinner/evening -> ["18:00"]. If the label gives no directions, use ["08:00"].
- frequency: "daily" unless the label says otherwise; "as_needed" for "as needed"/"PRN"; "alternate" for every other day; "days_of_week" with days_of_week (0=Sunday..6=Saturday) for specific weekdays, otherwise days_of_week is [].
- with_food: true only if the label says with food / with meals / after eating.
- note: a short (under 100 characters) helpful note from the label such as the strength and any key direction, e.g. "500 mg. Swallow whole." Empty string if nothing useful.
- confidence: how sure you are overall.
- warnings: short plain-language notes about anything you could not read or had to assume, e.g. "Could not read the dose — please check." Empty array if everything was clear.
- is_medicine: false if the photo is not a medicine or supplement; then fill the other fields with neutral defaults (empty strings, 1, "tablet", ["08:00"], "daily", [], false) and say why in warnings.`;

const ANALYSIS_PROMPT = `You explain a person's medicines and supplements for MyDay, a medication app used mostly by older adults and their families.

Write warmly and plainly, at about a grade 6 reading level. Short sentences. No jargon without a quick explanation. Never alarm.

For each medicine given (keep the person's own names, in the same order):
- what_it_is: one sentence on what kind of medicine it is (e.g. "A blood pressure medicine called an ACE inhibitor.").
- helps_with: 1-3 short phrases, the conditions or body systems it is commonly used for.
- benefits: 2-4 short, concrete benefits (e.g. "Lowers the strain on your heart").
- tip: one practical, general tip (e.g. taking it at the same time each day). Never tell the person to change, stop, skip or double a dose.
If you do not recognise a name, say so honestly in what_it_is, leave helps_with and benefits empty, and suggest asking a pharmacist in tip.

together.summary: 2-3 sentences on how the list works as a team.
together.goals: group the medicines by the shared health goal they serve (e.g. "Heart health", "Strong bones", "Blood sugar control"), naming which medicines serve each goal (use the exact names given) and "how" they work together in one or two sentences. Only include goals with a real link.
ask_pharmacist: 0-4 short, calm points worth checking with a pharmacist or doctor — well-known interactions, duplicates, or timing issues between THESE medicines (e.g. "Calcium can make levothyroxine work less well if taken at the same time — ask about spacing them apart."). Empty if nothing notable.
overview: one friendly sentence summing up the list.
disclaimer: exactly "This is general information, not medical advice. Always check with your doctor or pharmacist before changing how you take any medicine."`;

function assistantPrompt(state: unknown) {
  return `You are the MyDay helper, inside the Profile screen of MyDay — a calm medication and health app used mostly by older adults. You help the person change how the app looks and update their profile, and you answer questions about using the app.

Reply in one or two short, warm sentences, saying what you changed (or how to do the thing). Never give medical advice; for health questions, suggest asking their doctor or pharmacist.

You change things ONLY by returning actions. Available actions (type / key / value):
- set_text_size / "" / one of "normal" | "large" | "xlarge" | "huge" (smallest to largest). "Bigger" = one step up from the current size; "much bigger" = two steps up (stop at "huge"); "biggest" = "huge". "Smaller" = one step down.
- set_theme / "" / one of "light" | "dark" | "contrast" | "warm" | "fresh" | "ocean" | "rose" | "midnight". "contrast" is the black-on-white high-contrast theme.
- set_setting / key / "true" | "false" for keys: "highContrast" (stronger text and outlines in any theme), "bold" (thicker text), "bigButtons" (larger buttons), "calmMotion" (turns off animations — the "Calm screen"), "homeCalendar" (calendar on Home), "homeGames" (brain games on Home). For key "clock" the value is "12" or "24".
- update_profile / field / value for fields: "full_name", "birthday" (value as YYYY-MM-DD), "goal" (their health goal), "on_treatment" (their medications and conditions, as free text), "for_whom" ("self" or "other").
- navigate / "" / one of "/", "/medication", "/appointments", "/updates", "/games", "/cards", "/profile/notifications".

Guidance:
- "High contrast" / "easier to see" / "can't read it": set_setting highContrast true (keep their theme), and for strong wording also set_theme "contrast".
- "Calmer" / "less busy" / "too much moving": set_setting calmMotion true, and if they ask for calmer colours too, set_theme "warm" (or "dark" if they want it darker).
- Only change what they asked for. If the request is unclear, return no actions and ask one short question.
- A birthday must be a real past date; if they give no year, ask for it.
- To add medicines, appointments, notes or contacts, tell them where to tap (the Medicine tab's "Add from a photo" or "Add a medicine"; the Visits tab; the Updates tab; "My contacts" on this Profile page) — and you may navigate there.
- Alerts, reminders and quiet hours live under "Notification settings" at the top of Profile (/profile/notifications).

Today's date: ${new Date().toISOString().slice(0, 10)}.
The person's current settings and profile: ${JSON.stringify(state)}`;
}

/* -------------------------------- OpenAI -------------------------------- */

async function openai(messages: unknown[], schemaName: string, schema: unknown, maxTokens: number) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      // Newer reasoning models reject a custom temperature; gpt-4* take it.
      ...(MODEL.startsWith('gpt-4') ? { temperature: 0.2 } : {}),
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.log(JSON.stringify({ fn: 'ai-assist', openai_status: res.status, detail: detail.slice(0, 300) }));
    throw new Error(res.status === 429
      ? 'The helper is busy right now. Please try again in a minute.'
      : 'The helper could not answer just now. Please try again.');
  }
  const data = await res.json();
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal) throw new Error('The helper could not help with that one.');
  try { return JSON.parse(choice?.message?.content || ''); }
  catch { throw new Error('The helper gave an answer we could not read. Please try again.'); }
}

/* -------------------------------- server -------------------------------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  if (!OPENAI_KEY) return json({ error: 'The AI helper is not set up yet (missing OPENAI_API_KEY).' }, 503);

  // Signed-in MyDay users only: this spends real money per call.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: { user } } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }));
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const mode = String(body.mode || '');

  try {
    if (mode === 'scan_medicine') {
      const image = String(body.image || '');
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(image)) return json({ error: 'Please choose a photo.' }, 400);
      if (image.length > MAX_IMAGE_CHARS) return json({ error: 'That photo is too large.' }, 413);
      const result = await openai([
        { role: 'system', content: SCAN_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: 'Read this medicine label.' },
          { type: 'image_url', image_url: { url: image, detail: 'high' } },
        ] },
      ], 'medicine_scan', SCAN_SCHEMA, 600);
      console.log(JSON.stringify({ fn: 'ai-assist', mode, outcome: 'ok' }));
      return json({ result });
    }

    if (mode === 'analyze_medicines') {
      const meds = Array.isArray(body.meds) ? body.meds.slice(0, MAX_MEDS) : [];
      if (!meds.length) return json({ error: 'Add a medicine first.' }, 400);
      // Only what the explanation needs — never the person's name or notes.
      const list = meds.map((m: any) => ({
        name: String(m?.name || '').slice(0, 80),
        dose: String(m?.dose || '').slice(0, 40),
        how_often: String(m?.schedule || '').slice(0, 80),
      }));
      const goal = String(body.goal || '').slice(0, 300);
      const result = await openai([
        { role: 'system', content: ANALYSIS_PROMPT },
        { role: 'user', content: JSON.stringify({ medicines: list, persons_goal: goal || null }) },
      ], 'medicine_analysis', ANALYSIS_SCHEMA, 2200);
      console.log(JSON.stringify({ fn: 'ai-assist', mode, count: list.length, outcome: 'ok' }));
      return json({ result });
    }

    if (mode === 'assistant') {
      const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
      if (!message) return json({ error: 'Type what you would like to change.' }, 400);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
        .filter((h: any) => h && (h.role === 'user' || h.role === 'assistant'))
        .map((h: any) => ({ role: h.role, content: String(h.content || '').slice(0, MAX_MESSAGE_CHARS) }));
      const result = await openai([
        { role: 'system', content: assistantPrompt(body.state ?? {}) },
        ...history,
        { role: 'user', content: message },
      ], 'assistant_turn', ASSISTANT_SCHEMA, 400);
      console.log(JSON.stringify({ fn: 'ai-assist', mode, actions: result?.actions?.length ?? 0, outcome: 'ok' }));
      return json({ result });
    }

    return json({ error: 'Unknown request.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Something went wrong.' }, 502);
  }
});
