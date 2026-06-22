// Pure brain-game logic: 4 game types, each with 7 difficulty levels, plus
// adaptive difficulty. No React here.
import { lastDifficulty } from './db.js';

export const GAME_NAMES = {
  match_pairs: 'Match the Pairs',
  word_puzzle: 'Word Puzzle',
  number_pattern: 'Number Patterns',
  quick_math: 'Quick Math',
  odd_one_out: 'Odd One Out',
  orientation: 'Today',
};
export const GAME_SUB = {
  match_pairs: 'Find the matching pairs',
  word_puzzle: 'Fill in the missing word',
  number_pattern: 'Find the next number',
  quick_math: 'Solve simple sums',
  odd_one_out: 'Spot the word that does not belong',
  orientation: 'Gentle questions about today',
};
export const MAX_LEVEL = 10;
export const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const clampLevel = (n) => Math.max(1, Math.min(MAX_LEVEL, n));

// ---------- adaptive difficulty (device-local resume; history in DB) ----------
function storedLevel(type) {
  const v = parseInt(localStorage.getItem('myday_diff_' + type) || '', 10);
  return Number.isFinite(v) && v >= 1 ? clampLevel(v) : null;
}
export function setLevel(type, n) {
  const lvl = clampLevel(n);
  localStorage.setItem('myday_diff_' + type, String(lvl));
  return lvl;
}
export async function resolveLevel(type) {
  const local = storedLevel(type);
  if (local) return local;
  let db = 1;
  try { db = await lastDifficulty(type); } catch {}
  return setLevel(type, db);
}
export function adapt(type, level, ratio) {
  if (ratio >= 0.85) return setLevel(type, level + 1);
  if (ratio < 0.4) return setLevel(type, level - 1);
  return setLevel(type, level);
}

// ---------- word puzzle ----------
const WORD_BANK = {
  1: [
    ['An apple a day keeps the ___ away.', 'doctor', ['dentist', 'teacher', 'winter']],
    ['Better late than ___.', 'never', ['sorry', 'early', 'ever']],
    ['The early bird catches the ___.', 'worm', ['bus', 'fish', 'sun']],
    ['A penny saved is a penny ___.', 'earned', ['spent', 'lost', 'found']],
    ['Practice makes ___.', 'perfect', ['tired', 'money', 'noise']],
    ['Home sweet ___.', 'home', ['house', 'street', 'town']],
  ],
  2: [
    ['Actions speak louder than ___.', 'words', ['noise', 'people', 'money']],
    ['Every cloud has a silver ___.', 'lining', ['cloud', 'ring', 'edge']],
    ['When in Rome, do as the ___ do.', 'Romans', ['locals', 'tourists', 'rulers']],
    ["Don't count your chickens before they ___.", 'hatch', ['grow', 'lay', 'run']],
    ['The grass is always greener on the other ___.', 'side', ['hill', 'field', 'farm']],
  ],
  3: [
    ['A bird in the hand is worth two in the ___.', 'bush', ['sky', 'nest', 'tree']],
    ['Too many cooks spoil the ___.', 'broth', ['meal', 'soup', 'cake']],
    ['People in glass houses should not throw ___.', 'stones', ['parties', 'water', 'words']],
    ['A rolling stone gathers no ___.', 'moss', ['speed', 'dust', 'dirt']],
    ['You can lead a horse to water but cannot make it ___.', 'drink', ['run', 'stop', 'eat']],
  ],
  4: [
    ['Necessity is the mother of ___.', 'invention', ['science', 'change', 'caution']],
    ['The pen is mightier than the ___.', 'sword', ['pencil', 'word', 'fist']],
    ['Absence makes the heart grow ___.', 'fonder', ['colder', 'weaker', 'kinder']],
    ['A picture is worth a thousand ___.', 'words', ['pictures', 'dollars', 'colors']],
    ["Beggars can't be ___.", 'choosers', ['winners', 'buyers', 'takers']],
  ],
  5: [
    ['Fortune favors the ___.', 'bold', ['rich', 'wise', 'patient']],
    ['Familiarity breeds ___.', 'contempt', ['comfort', 'trust', 'respect']],
    ['A fool and his money are soon ___.', 'parted', ['spent', 'gone', 'lost']],
    ['Do not look a gift horse in the ___.', 'mouth', ['eye', 'field', 'stable']],
    ['The squeaky wheel gets the ___.', 'grease', ['oil', 'blame', 'turn']],
  ],
  6: [
    ['A leopard cannot change its ___.', 'spots', ['stripes', 'colors', 'habits']],
    ['Still waters run ___.', 'deep', ['dry', 'cold', 'clear']],
    ['The proof of the pudding is in the ___.', 'eating', ['making', 'recipe', 'taste']],
    ['Many hands make light ___.', 'work', ['load', 'day', 'lifting']],
    ['A watched pot never ___.', 'boils', ['cooks', 'warms', 'sings']],
  ],
  7: [
    ['All that glitters is not ___.', 'gold', ['silver', 'real', 'gone']],
    ['Brevity is the soul of ___.', 'wit', ['speech', 'truth', 'art']],
    ['Cleanliness is next to ___.', 'godliness', ['tidiness', 'health', 'kindness']],
    ['Uneasy lies the head that wears a ___.', 'crown', ['hat', 'mask', 'name']],
    ['Discretion is the better part of ___.', 'valour', ['wisdom', 'courage', 'honor']],
  ],
};
export function buildWordQuestions(level) {
  const pool = WORD_BANK[Math.min(clampLevel(level), 7)] || WORD_BANK[1];
  const picks = shuffle(pool).slice(0, 5);
  const nOptions = level >= 3 ? 4 : 3;
  return picks.map(([sentence, answer, distractors]) => ({
    prompt: sentence,
    options: shuffle([answer, ...distractors.slice(0, nOptions - 1)]),
    answer,
  }));
}

// ---------- number patterns ----------
export function buildNumberQuestions(level) {
  return Array.from({ length: 5 }, () => makeNumberQuestion(clampLevel(level)));
}
function makeNumberQuestion(level) {
  const r = (n) => Math.floor(Math.random() * n);
  let seq, answer;
  if (level <= 1) { const s = 1 + r(5), st = 1 + r(3); seq = [s, s + st, s + 2 * st, s + 3 * st]; answer = s + 4 * st; }
  else if (level === 2) { const s = 2 + r(8), st = 2 + r(4); seq = [s, s + st, s + 2 * st, s + 3 * st]; answer = s + 4 * st; }
  else if (level === 3) { const s = 1 + r(4); seq = [s, s * 2, s * 4, s * 8]; answer = s * 16; }
  else if (level === 4) { let c = 1 + r(6), d = 1; seq = [c]; for (let i = 0; i < 3; i++) { c += d; d++; seq.push(c); } answer = c + d; }
  else if (level === 5) { const st = 2 + r(5), s = 40 + r(20); seq = [s, s - st, s - 2 * st, s - 3 * st]; answer = s - 4 * st; }
  else if (level === 6) { let a = 1 + r(3), b = 1 + r(4); seq = [a, b]; for (let i = 0; i < 2; i++) { const n = a + b; seq.push(n); a = b; b = n; } answer = a + b; }
  else if (level === 7) { const s = 1 + r(3); seq = [s, s * 3, s * 9, s * 27]; answer = s * 81; }
  else if (level === 8) { const s = 1 + r(3); seq = [s * s, (s + 1) ** 2, (s + 2) ** 2, (s + 3) ** 2]; answer = (s + 4) ** 2; }
  else if (level === 9) { let a = 1 + r(4); seq = [a]; for (let i = 0; i < 3; i++) { a = a * 2 + 1; seq.push(a); } answer = a * 2 + 1; }
  else { let a = 2 + r(3); const k = 2 + r(3); seq = [a]; for (let i = 0; i < 3; i++) { a = a * 2 + k; seq.push(a); } answer = a * 2 + k; }
  const baseStep = Math.abs((seq[1] - seq[0]) || 5);
  const distractors = new Set();
  for (const d of shuffle([1, -1, 2, -2, 3, baseStep, -baseStep, Math.round(baseStep / 2) || 4])) {
    if (answer + d !== answer) distractors.add(answer + d);
    if (distractors.size >= 3) break;
  }
  return { lead: 'What number comes next?', big: seq.join('   ') + '   ?', prompt: '',
    options: shuffle([answer, ...[...distractors].slice(0, 3)]).map(String), answer: String(answer) };
}

// ---------- orientation prompts ----------
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SEASONS = ['Winter', 'Spring', 'Summer', 'Autumn'];
export function buildOrientationQuestions(level = 1) {
  const now = new Date();
  const weekday = WEEKDAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const year = now.getFullYear();
  const dom = now.getDate();
  const season = SEASONS[[11, 0, 1].includes(now.getMonth()) ? 0 : [2, 3, 4].includes(now.getMonth()) ? 1 : [5, 6, 7].includes(now.getMonth()) ? 2 : 3];
  const h = now.getHours();
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  const pick = (answer, pool, n) => shuffle([answer, ...shuffle(pool.filter((x) => x !== answer)).slice(0, n - 1)]);
  const all = [
    { prompt: 'What day of the week is it today?', answer: weekday, options: pick(weekday, WEEKDAYS, 4), confirmRight: `Yes, today is ${weekday}.`, confirmWrong: `Today is ${weekday}.` },
    { prompt: 'What month are we in?', answer: month, options: pick(month, MONTHS, 4), confirmRight: `That's right, it is ${month}.`, confirmWrong: `It is ${month}.` },
    { prompt: 'What season is it?', answer: season, options: pick(season, SEASONS, 4), confirmRight: `Yes, it is ${season}.`, confirmWrong: `It is ${season}.` },
    { prompt: 'What year is it?', answer: String(year), options: pick(String(year), [year - 1, year, year + 1, year + 2].map(String), 4), confirmRight: `Correct, it is ${year}.`, confirmWrong: `The year is ${year}.` },
    { prompt: 'Is it morning, afternoon, or evening?', answer: part, options: ['Morning', 'Afternoon', 'Evening'], confirmRight: `Yes, it is the ${part.toLowerCase()}.`, confirmWrong: `It is the ${part.toLowerCase()}.` },
    { prompt: 'What is the date today (day of the month)?', answer: String(dom), options: pick(String(dom), [dom - 2, dom - 1, dom, dom + 1, dom + 2].filter((x) => x >= 1 && x <= 31).map(String), 4), confirmRight: `Yes, today is the ${dom}.`, confirmWrong: `Today is the ${dom}.` },
  ];
  // Higher levels remove the easiest first item; always at least 4 questions.
  const drop = Math.min(level - 1, all.length - 4);
  return all.slice(drop);
}

// ---------- match the pairs ----------
const PAIR_WORDS = ['SUN', 'CAT', 'DOG', 'HAT', 'CUP', 'BUS', 'PEN', 'KEY', 'BOX', 'FAN', 'MAP', 'CAR', 'BED', 'EGG'];
export function buildMatchDeck(level) {
  const pairs = Math.min(3 + clampLevel(level), PAIR_WORDS.length); // L1 -> 4 pairs, L10 -> 13 pairs
  const words = shuffle(PAIR_WORDS).slice(0, pairs);
  return { pairs, deck: shuffle([...words, ...words]) };
}

// ---------- quick math ----------
export function buildMathQuestions(level) {
  return Array.from({ length: 5 }, () => makeMath(clampLevel(level)));
}
function makeMath(level) {
  const r = (n) => Math.floor(Math.random() * n);
  let a, b, sym, answer;
  if (level <= 2) { a = 2 + r(9); b = 1 + r(9); sym = '+'; answer = a + b; }
  else if (level <= 4) { a = 10 + r(30); b = 1 + r(9 + level * 2); sym = Math.random() < 0.5 ? '+' : '-'; if (sym === '-' && b > a) { [a, b] = [b, a]; } answer = sym === '+' ? a + b : a - b; }
  else if (level <= 6) { a = 20 + r(70); b = 5 + r(40); sym = '-'; if (b > a) [a, b] = [b, a]; answer = a - b; }
  else if (level <= 8) { a = 2 + r(8 + level); b = 2 + r(9); sym = '×'; answer = a * b; }
  else { a = 11 + r(40); b = 2 + r(11); sym = '×'; answer = a * b; }
  const distractors = new Set();
  for (const d of shuffle([1, -1, 2, -2, 3, -3, 5, 10, -10])) { if (answer + d >= 0 && answer + d !== answer) distractors.add(answer + d); if (distractors.size >= 3) break; }
  return { lead: 'What is the answer?', big: `${a}  ${sym}  ${b}`, prompt: '', options: shuffle([answer, ...[...distractors].slice(0, 3)]).map(String), answer: String(answer) };
}

// ---------- odd one out ----------
const ODD_GROUPS = [
  ['Apple', 'Banana', 'Orange', 'Grape', 'Pear', 'Peach'],
  ['Dog', 'Cat', 'Horse', 'Cow', 'Sheep', 'Rabbit'],
  ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink'],
  ['Car', 'Bus', 'Train', 'Truck', 'Bicycle', 'Boat'],
  ['Rose', 'Tulip', 'Daisy', 'Lily', 'Orchid', 'Violet'],
  ['Hammer', 'Saw', 'Drill', 'Wrench', 'Screwdriver', 'Pliers'],
  ['Chair', 'Table', 'Sofa', 'Bed', 'Desk', 'Shelf'],
  ['Eye', 'Nose', 'Ear', 'Hand', 'Foot', 'Knee'],
  ['Coffee', 'Tea', 'Juice', 'Water', 'Milk', 'Soda'],
  ['Piano', 'Guitar', 'Violin', 'Drums', 'Flute', 'Trumpet'],
];
export function buildOddOneOut(level) {
  const n = clampLevel(level) >= 6 ? 4 : 3; // more same-category words = trickier
  return Array.from({ length: 5 }, () => {
    const [g, other] = shuffle(ODD_GROUPS);
    const items = shuffle(g).slice(0, n);
    const odd = shuffle(other)[0];
    return { prompt: 'Which one does not belong?', options: shuffle([...items, odd]), answer: odd };
  });
}
