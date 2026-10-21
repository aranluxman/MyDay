export const CHAT_BOUNDARY = 'I can help you keep a health diary, but I cannot diagnose, prescribe, or advise on medicine doses. Please ask your doctor or pharmacist about symptoms or treatment.';

// Conservative runtime backstop in addition to the system prompt. Input and
// generated reply/suggestions are checked on the server and again in the UI.
const CLINICAL_REQUEST = /\b(diagnos\w*|prescrib\w*|what (?:illness|disease|condition) (?:do I|have I)|(?:should|can|may|could) I (?:take|skip|stop|start|double|increase|decrease|change|reduce)|(?:change|adjust|increase|decrease|double|reduce|recommend|calculate) (?:my |the |a )?(?:dose|dosage|medication|medicine)|what (?:dose|dosage|medicine|medication)|how (?:much|many) .{0,40}(?:take|tablets|pills))\b/i;
const CLINICAL_OUTPUT = /\b(?:(?:you (?:have|likely have|probably have|may have|might have|need)|this (?:is|sounds like|suggests)|(?:likely|probable) (?:cause|reason))\b|(?:take|skip|stop|start|double|increase|decrease|reduce|adjust|change|try|recommend|prescribe)\b.{0,60}\b(?:dose|dosage|mg|mcg|ml|tablet|capsule|pill|medicine|medication|insulin|aspirin|ibuprofen|acetaminophen|antibiotic)|(?:medicines?|medications?) (?:are|is) safe|clinical advice)/i;

export function clinicalRequest(text) {
  return CLINICAL_REQUEST.test(String(text || ''));
}

// Preserve the existing emergency escalation ahead of any clinical refusal.
export function urgentChatResult(text) {
  if (!/\b(chest (?:pain|pressure)|trouble breathing|cannot breathe|can't breathe|face drooping|slurred speech|sudden severe headache|vomiting blood|coughing blood|severe allergic reaction|(?:hurt|kill) myself)\b/i.test(String(text || ''))) return null;
  return { reply: 'Please call 911 now, or ask someone near you to call.', suggestions: [], urgent: true };
}

export function safeChatResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const suggestions = Array.isArray(r.suggestions) ? r.suggestions.map(String) : [];
  if (clinicalRequest(r.reply) || CLINICAL_OUTPUT.test(String(r.reply || '')) || suggestions.some((s) => clinicalRequest(s) || CLINICAL_OUTPUT.test(s))) {
    return { reply: CHAT_BOUNDARY, suggestions: [], urgent: r.urgent === true };
  }
  return r;
}

// ---------- "Ask about your medicines" ----------
// This chat is ABOUT medicines, so the diary chat's rule (refuse anything
// mentioning a medicine) would refuse everything. It may explain what the
// person's medicines are for and how they generally work together. It may
// never answer a personal dosing question or say a combination is safe.
export const MEDICINE_BOUNDARY = "I can share general information about how your medicines work, but I can't tell you how much to take, or whether to start, stop, skip or change a medicine. Please ask your pharmacist or doctor — they know your full health picture.";
export const MEDICINE_DISCLAIMER = 'This is general information, not medical advice. Always check with your pharmacist or doctor before changing how you take any medicine.';

const DOSING_REQUEST = /\b(?:(?:should|can|may|could|do) I (?:take|skip|stop|start|double|increase|decrease|change|reduce|cut|split|crush|quit|come off)|how (?:much|many)\b.{0,40}\b(?:take|tablets?|pills?|capsules?|mg|doses?)|(?:change|adjust|increase|decrease|double|reduce|calculate|lower|raise) (?:my |the |a )?(?:dose|dosage)|(?:missed|forgot|skipped) (?:a |my |to take )?(?:dose|pill|medicine|tablet)|(?:what|which) (?:dose|dosage|strength) (?:should|do)|diagnos\w*|prescrib\w*)/i;
const DOSING_OUTPUT = /\b(?:you (?:should|can|could|need to|must|may) (?:take|skip|stop|start|double|increase|decrease|reduce|change|cut|split|crush)|(?:safe|fine|okay|ok) to (?:take|combine|mix|use)\b|(?:there are |have )?no (?:known )?(?:drug )?interactions?|(?:are|is) safe (?:together|to take|to combine)|take (?:an? )?(?:extra|double|another|second) (?:dose|tablet|pill)|you (?:have|likely have|probably have|may have|might have) (?!questions?\b)\w+)/i;

export function dosingRequest(text) {
  return DOSING_REQUEST.test(String(text || ''));
}

/** Reply checked on the server, and again in the browser, before it shows. */
export function safeMedicineResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const reply = String(r.reply || '');
  const suggestions = (Array.isArray(r.suggestions) ? r.suggestions.map(String) : [])
    .filter((s) => !dosingRequest(s) && !DOSING_OUTPUT.test(s));
  if (DOSING_OUTPUT.test(reply)) {
    return { reply: MEDICINE_BOUNDARY, suggestions: [], urgent: r.urgent === true, disclaimer: MEDICINE_DISCLAIMER };
  }
  return { reply, suggestions, urgent: r.urgent === true, disclaimer: MEDICINE_DISCLAIMER };
}
