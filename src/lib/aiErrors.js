export const CHAT_UNAVAILABLE = 'Chat is unavailable right now. You can still use your health diary.';
export const MEDICINE_CHAT_UNAVAILABLE = 'Questions are unavailable right now. Your pharmacist can answer them too — and the summary on the Medicine page is still there.';

// Never render an upstream exception or provider/configuration details. Retry
// only a known temporary failure; older servers may expose only an error string.
export function aiFailure({ status = 0, code = '', retryable, error = '', mode = 'note_chat' } = {}) {
  const configuration = code === 'ai_unavailable' || /OPENAI_API_KEY|not set up|configuration|api.?key|quota|billing/i.test(error);
  const permanent = configuration || [400, 401, 403, 404, 413, 422].includes(status);
  const temporary = [408, 429, 500, 502, 503, 504].includes(status);
  return {
    message: mode === 'note_chat' ? CHAT_UNAVAILABLE
      : mode === 'medicine_chat' ? MEDICINE_CHAT_UNAVAILABLE
        : 'This helper is unavailable right now. You can still use MyDay.',
    retryable: !permanent && retryable !== false && (retryable === true || temporary || status === 0),
  };
}
