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
