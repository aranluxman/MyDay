// Pure game logic + adaptive difficulty (no React). Shared by the game screens.
import { lastDifficulty } from './db.js';

export const GAME_NAMES = {
  match_pairs: 'Match the Pairs',
  word_puzzle: 'Word Puzzle',
  number_pattern: 'Number Patterns',
  orientation: 'Today',
};
export const GAME_SUB = {
  match_pairs: 'Find the matching pairs of words',
  word_puzzle: 'Fill in the missing word',
  number_pattern: 'Find the next number',
  orientation: 'Simple questions about today',
};
export const MAX_LEVEL = { match_pairs: 5, word_puzzle: 3, number_pattern: 5, orientation: 1 };

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- difficulty: device-local resume level, history lives in the DB ----------
function storedLevel(type) {
  const v = parseInt(localStorage.getItem('myday_diff_' + type) || '', 10);
  return Number.isFinite(v) && v >= 1 ? v : null;
}
export function setLevel(type, n) {
  const lvl = Math.max(1, Math.min(MAX_LEVEL[type] || 1, n));
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
  if (ratio >= 0.8) return setLevel(type, level + 1);
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
    ['It is raining cats and ___.', 'dogs', ['birds', 'frogs', 'mice']],
  ],
  2: [
    ['Actions speak louder than ___.', 'words', ['noise', 'people', 'money']],
    ['Every cloud has a silver ___.', 'lining', ['cloud', 'ring', 'edge']],
    ['When in Rome, do as the ___ do.', 'Romans', ['locals', 'tourists', 'rulers']],
    ["Don't count your chickens before they ___.", 'hatch', ['grow', 'lay', 'run']],
    ['The grass is always greener on the other ___.', 'side', ['hill', 'field', 'farm']],
    ['Two wrongs do not make a ___.', 'right', ['left', 'turn', 'win']],
  ],
  3: [
    ['A bird in the hand is worth two in the ___.', 'bush', ['sky', 'nest', 'tree']],
    ['Too many cooks spoil the ___.', 'broth', ['meal', 'soup', 'cake']],
    ['People who live in glass houses should not throw ___.', 'stones', ['parties', 'water', 'words']],
    ['A rolling stone gathers no ___.', 'moss', ['speed', 'dust', 'dirt']],
    ['You can lead a horse to water but you cannot make it ___.', 'drink', ['run', 'stop', 'eat']],
  ],
};
export function buildWordQuestions(level) {
  const pool = WORD_BANK[Math.min(level, 3)] || WORD_BANK[1];
  const picks = shuffle(pool).slice(0, 5);
  const nOptions = level >= 2 ? 4 : 3;
  return picks.map(([sentence, answer, distractors]) => ({
    prompt: sentence,
    options: shuffle([answer, ...distractors.slice(0, nOptions - 1)]),
    answer,
  }));
}

// ---------- number patterns ----------
export function buildNumberQuestions(level) {
  return Array.from({ length: 5 }, () => makeNumberQuestion(level));
}
function makeNumberQuestion(level) {
  const r = (n) => Math.floor(Math.random() * n);
  let seq, answer;
  if (level <= 1) {
    const start = 1 + r(5), step = 1 + r(3);
    seq = [start, start + step, start + 2 * step, start + 3 * step]; answer = start + 4 * step;
  } else if (level === 2) {
    const start = 2 + r(8), step = 2 + r(4);
    seq = [start, start + step, start + 2 * step, start + 3 * step]; answer = start + 4 * step;
  } else if (level === 3) {
    const start = 1 + r(4);
    seq = [start, start * 2, start * 4, start * 8]; answer = start * 16;
  } else if (level === 4) {
    let cur = 1 + r(6), diff = 1; seq = [cur];
    for (let i = 0; i < 3; i++) { cur += diff; diff++; seq.push(cur); }
    answer = cur + diff;
  } else {
    const step = 2 + r(5), start = 40 + r(20);
    seq = [start, start - step, start - 2 * step, start - 3 * step]; answer = start - 4 * step;
  }
  const baseStep = Math.abs((seq[1] - seq[0]) || 5);
  const distractors = new Set();
  for (const d of shuffle([1, -1, 2, -2, 3, baseStep, -baseStep])) {
    if (answer + d !== answer) distractors.add(answer + d);
    if (distractors.size >= 3) break;
  }
  const options = shuffle([answer, ...[...distractors].slice(0, 3)]).map(String);
  return { lead: 'What number comes next?', big: seq.join('   ') + '   ?', prompt: '', options, answer: String(answer) };
}

// ---------- orientation prompts ----------
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SEASONS = ['Winter', 'Spring', 'Summer', 'Autumn'];
export function buildOrientationQuestions() {
  const now = new Date();
  const weekday = WEEKDAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const year = now.getFullYear();
  const season = SEASONS[[11, 0, 1].includes(now.getMonth()) ? 0
    : [2, 3, 4].includes(now.getMonth()) ? 1
    : [5, 6, 7].includes(now.getMonth()) ? 2 : 3];
  const h = now.getHours();
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  const pick = (answer, pool, n) => shuffle([answer, ...shuffle(pool.filter((x) => x !== answer)).slice(0, n - 1)]);
  return [
    { prompt: 'What day of the week is it today?', answer: weekday, options: pick(weekday, WEEKDAYS, 4),
      confirmRight: `Yes, today is ${weekday}.`, confirmWrong: `Today is ${weekday}.` },
    { prompt: 'What month are we in?', answer: month, options: pick(month, MONTHS, 4),
      confirmRight: `That's right, it is ${month}.`, confirmWrong: `It is ${month}.` },
    { prompt: 'What season is it?', answer: season, options: pick(season, SEASONS, 4),
      confirmRight: `Yes, it is ${season}.`, confirmWrong: `It is ${season}.` },
    { prompt: 'What year is it?', answer: String(year), options: pick(String(year), [year - 1, year, year + 1, year + 2].map(String), 4),
      confirmRight: `Correct, the year is ${year}.`, confirmWrong: `The year is ${year}.` },
    { prompt: 'Is it morning, afternoon, or evening right now?', answer: part, options: ['Morning', 'Afternoon', 'Evening'],
      confirmRight: `Yes, it is the ${part.toLowerCase()}.`, confirmWrong: `It is the ${part.toLowerCase()}.` },
  ];
}

// ---------- match the pairs ----------
const PAIR_WORDS = ['SUN', 'CAT', 'DOG', 'HAT', 'CUP', 'BUS', 'PEN', 'KEY', 'BOX', 'FAN'];
export function buildMatchDeck(level) {
  const pairs = 3 + level; // level 1 -> 4 pairs, up to 8
  const words = shuffle(PAIR_WORDS).slice(0, pairs);
  return { pairs, deck: shuffle([...words, ...words]) };
}
