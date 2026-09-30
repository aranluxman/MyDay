// Showing MyDay in another language, using Google's free page translator.
//
// Why this and not hand-written translations: every screen, every toast and
// every AI answer is translated with no upkeep, in 100+ languages. The price
// is the odd awkward phrase, which a senior reading in their first language
// will take over perfect English they struggle with.
//
// How it works: the translator reads a `googtrans` cookie ("/en/ta") on load
// and translates the page. Choosing a language writes that cookie and reloads,
// which is the one path that works the same on every phone and browser.

// Top of the picker, in each language's own script so people can find theirs.
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français', en: 'French' },
  { code: 'zh-CN', name: '简体中文', en: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: '繁體中文', en: 'Chinese (Traditional)' },
  { code: 'ta', name: 'தமிழ்', en: 'Tamil' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', en: 'Punjabi' },
  { code: 'hi', name: 'हिन्दी', en: 'Hindi' },
  { code: 'ur', name: 'اردو', en: 'Urdu' },
  { code: 'es', name: 'Español', en: 'Spanish' },
  { code: 'pt', name: 'Português', en: 'Portuguese' },
  { code: 'it', name: 'Italiano', en: 'Italian' },
];
export const MORE_LANGUAGES = [
  { code: 'ar', name: 'العربية', en: 'Arabic' },
  { code: 'bn', name: 'বাংলা', en: 'Bengali' },
  { code: 'de', name: 'Deutsch', en: 'German' },
  { code: 'el', name: 'Ελληνικά', en: 'Greek' },
  { code: 'gu', name: 'ગુજરાતી', en: 'Gujarati' },
  { code: 'ja', name: '日本語', en: 'Japanese' },
  { code: 'ko', name: '한국어', en: 'Korean' },
  { code: 'fa', name: 'فارسی', en: 'Persian (Farsi)' },
  { code: 'pl', name: 'Polski', en: 'Polish' },
  { code: 'ru', name: 'Русский', en: 'Russian' },
  { code: 'so', name: 'Soomaali', en: 'Somali' },
  { code: 'tl', name: 'Tagalog', en: 'Tagalog (Filipino)' },
  { code: 'uk', name: 'Українська', en: 'Ukrainian' },
  { code: 'vi', name: 'Tiếng Việt', en: 'Vietnamese' },
];
const ALL = [...LANGUAGES, ...MORE_LANGUAGES];
const KEY = 'myday_language';

export function currentLanguage() {
  const m = /(?:^|;\s*)googtrans=\/[^/]*\/([^;]+)/.exec(document.cookie);
  const fromCookie = m ? decodeURIComponent(m[1]) : null;
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch {}
  const code = fromCookie || stored || 'en';
  return ALL.some((l) => l.code === code) ? code : 'en';
}

function writeCookie(value) {
  const host = window.location.hostname;
  const expiry = value ? 'max-age=31536000' : 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
  const v = value ? `googtrans=${value}` : 'googtrans=';
  // The translator may have set it on the bare host or on ".host"; cover both.
  document.cookie = `${v}; path=/; ${expiry}`;
  if (host.includes('.')) document.cookie = `${v}; path=/; domain=.${host}; ${expiry}`;
}

/** Switches language and reloads so every screen comes back translated. */
export function setLanguage(code) {
  const lang = ALL.some((l) => l.code === code) ? code : 'en';
  try { localStorage.setItem(KEY, lang); } catch {}
  writeCookie(lang === 'en' ? null : `/en/${lang}`);
  window.location.reload();
}

// The translator swaps text nodes for its own <font> elements behind React's
// back; React then crashes trying to remove a node that has moved. Making
// these two calls forgiving is the standard fix (facebook/react#11538).
function makeDomForgiving() {
  if (typeof Node !== 'function' || Node.prototype.__mydayPatched) return;
  Node.prototype.__mydayPatched = true;
  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child.parentNode !== this) return child;
    return removeChild.call(this, child);
  };
  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (node, ref) {
    if (ref && ref.parentNode !== this) return insertBefore.call(this, node, null);
    return insertBefore.call(this, node, ref);
  };
}

/** Call once at start-up. Does nothing at all for English. */
export function initLanguage() {
  const lang = currentLanguage();
  // Keep the cookie in step with the saved choice (e.g. cookies were cleared).
  if (lang !== 'en' && !document.cookie.includes('googtrans=')) writeCookie(`/en/${lang}`);
  if (lang === 'en') return;
  makeDomForgiving();
  document.documentElement.lang = lang;
  const holder = document.createElement('div');
  holder.id = 'google_translate_element';
  holder.hidden = true;
  document.body.appendChild(holder);
  window.googleTranslateElementInit = () => {
    try {
      // eslint-disable-next-line no-new
      new window.google.translate.TranslateElement({ pageLanguage: 'en', autoDisplay: false }, 'google_translate_element');
    } catch { /* translator unavailable (offline) — the app stays in English */ }
  };
  const s = document.createElement('script');
  s.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
  s.async = true;
  document.body.appendChild(s);
}
