// Brain Games: match-the-pairs, word puzzles, number/pattern, and orientation
// prompts. Unlimited play, adaptive difficulty, gentle encouragement, and every
// result is saved to Supabase so trends can be reviewed later.
import { h, mount, banner, cheer } from './ui.js';
import { go } from './nav.js';
import {
  saveGameResult, lastDifficulty, recentResults, playedTodayCount,
} from './db.js';

const MAX_LEVEL = { match_pairs: 5, word_puzzle: 3, number_pattern: 5, orientation: 1 };
const GAME_NAMES = {
  match_pairs: 'Match the Pairs',
  word_puzzle: 'Word Puzzle',
  number_pattern: 'Number Patterns',
  orientation: 'Today',
};

// ---------- difficulty (device-local resume level; history lives in DB) ----------
function storedLevel(type) {
  const v = parseInt(localStorage.getItem('myday_diff_' + type) || '', 10);
  return Number.isFinite(v) && v >= 1 ? v : null;
}
function setLevel(type, n) {
  const lvl = Math.max(1, Math.min(MAX_LEVEL[type] || 1, n));
  localStorage.setItem('myday_diff_' + type, String(lvl));
  return lvl;
}
async function resolveLevel(type) {
  const local = storedLevel(type);
  if (local) return local;
  let db = 1;
  try { db = await lastDifficulty(type); } catch {}
  return setLevel(type, db);
}
function adapt(type, level, ratio) {
  if (ratio >= 0.8) return setLevel(type, level + 1);
  if (ratio < 0.4) return setLevel(type, level - 1);
  return setLevel(type, level);
}

// ---------- games menu ----------
export async function renderGamesMenu() {
  let played = 1;
  try { played = await playedTodayCount(); } catch {}

  mount(
    h('h2', { class: 'section' }, 'Brain Games'),
    h('p', { class: 'lead' }, 'Pick a game. You can play as much as you like.'),
    h('div', { class: 'menu' },
      gameBtn('match_pairs', 'Find the matching pairs of words'),
      gameBtn('word_puzzle', 'Fill in the missing word'),
      gameBtn('number_pattern', 'Find the next number'),
      gameBtn('orientation', 'Simple questions about today'),
    ),
    h('div', { class: 'center', style: 'margin-top:20px' },
      h('button', { class: 'btn btn--ghost', onclick: () => go('#/games/progress') }, 'See your progress')),
    played === 0
      ? h('p', { class: 'center muted', style: 'margin-top:16px' }, 'You have not played yet today.')
      : null,
  );
}
function gameBtn(type, subtitle) {
  return h('button', { class: 'menu__btn', onclick: () => go('#/games/' + type) },
    GAME_NAMES[type], h('small', {}, subtitle));
}

// ---------- dispatch ----------
export function renderGame(type, setChrome) {
  if (type === 'progress') { setChrome?.('Your Progress', { back: true, home: true }); return renderProgress(); }
  setChrome?.(GAME_NAMES[type] || 'Brain Games', { back: true, home: true });
  switch (type) {
    case 'match_pairs':    return startMatch();
    case 'word_puzzle':    return startQuizGame('word_puzzle', buildWordQuestions);
    case 'number_pattern': return startQuizGame('number_pattern', buildNumberQuestions);
    case 'orientation':    return startQuizGame('orientation', buildOrientationQuestions);
    default:               return renderGamesMenu();
  }
}

// =====================================================================
// Shared quiz runner (word / number / orientation)
// =====================================================================
async function startQuizGame(type, builder) {
  const level = await resolveLevel(type);
  const questions = builder(level);
  runQuiz(type, level, questions);
}

function runQuiz(type, level, questions) {
  let idx = 0, correct = 0;

  function show() {
    const q = questions[idx];
    const choices = h('div', { class: 'choice-grid' });
    const next = h('button', { class: 'btn', hidden: true,
      onclick: () => { idx++; idx < questions.length ? show() : finish(); } }, 'Next');

    q.options.forEach((opt) => {
      const btn = h('button', { class: 'choice', onclick: () => {
        if (next.hidden === false) return;       // already answered
        [...choices.children].forEach(c => c.disabled = true);
        const right = opt === q.answer;
        if (right) {
          btn.classList.add('choice--right'); correct++;
          banner(cheer());
        } else {
          btn.classList.add('choice--wrong');
          [...choices.children].forEach(c => { if (c.textContent === q.answer) c.classList.add('choice--right'); });
        }
        feedback.textContent = right
          ? (q.confirmRight || "That's right.")
          : (q.confirmWrong || `The answer is ${q.answer}.`);
        feedback.hidden = false;
        next.hidden = false;
        next.textContent = idx < questions.length - 1 ? 'Next question' : 'See result';
      } }, opt);
      choices.appendChild(btn);
    });

    const feedback = h('p', { class: 'center', style: 'font-size:21px;font-weight:700;margin-top:14px', hidden: true });

    mount(
      h('p', { class: 'game-progress' }, `Question ${idx + 1} of ${questions.length}`),
      q.lead ? h('p', { class: 'lead center' }, q.lead) : null,
      q.big ? h('div', { class: 'big-number' }, q.big) : null,
      h('p', { class: 'prompt-q' }, q.prompt),
      choices, feedback, next,
    );
  }
  show();

  async function finish() {
    const ratio = correct / questions.length;
    const newLevel = adapt(type, level, ratio);
    try {
      await saveGameResult({ game_type: type, score: correct, max_score: questions.length,
        difficulty: level, details: { ratio } });
    } catch { /* non-fatal: keep play uninterrupted */ }
    resultScreen(type, correct, questions.length, ratio, newLevel, level,
      () => startQuizGame(type, type === 'word_puzzle' ? buildWordQuestions
        : type === 'number_pattern' ? buildNumberQuestions : buildOrientationQuestions));
  }
}

function resultScreen(type, score, max, ratio, newLevel, oldLevel, again) {
  const good = ratio >= 0.6;
  const headline = good ? cheer() : 'Nice effort.';
  let levelNote = null;
  if (type !== 'orientation') {
    if (newLevel > oldLevel) levelNote = 'You did well - the next round will be a little harder.';
    else if (newLevel < oldLevel) levelNote = 'The next round will be a little easier.';
  }
  mount(
    h('h2', { class: 'section center' }, headline),
    h('p', { class: 'prompt-q' }, `You got ${score} out of ${max}.`),
    levelNote ? h('p', { class: 'center muted' }, levelNote) : null,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn btn--lg', onclick: again }, 'Play again'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn btn--ghost', onclick: () => go('#/games') }, 'Back to games'),
  );
}

// =====================================================================
// Word puzzle - fill in the missing word
// =====================================================================
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
    ['Don\'t count your chickens before they ___.', 'hatch', ['grow', 'lay', 'run']],
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
function buildWordQuestions(level) {
  const pool = WORD_BANK[Math.min(level, 3)] || WORD_BANK[1];
  const picks = shuffle(pool).slice(0, 5);
  const nOptions = level >= 2 ? 4 : 3;
  return picks.map(([sentence, answer, distractors]) => ({
    prompt: sentence,
    options: shuffle([answer, ...distractors.slice(0, nOptions - 1)]),
    answer,
  }));
}

// =====================================================================
// Number patterns - find the next number
// =====================================================================
function buildNumberQuestions(level) {
  return Array.from({ length: 5 }, () => makeNumberQuestion(level));
}
function makeNumberQuestion(level) {
  let seq, answer;
  const r = (n) => Math.floor(Math.random() * n);
  if (level <= 1) {
    const start = 1 + r(5), step = 1 + r(3);
    seq = [start, start + step, start + 2 * step, start + 3 * step];
    answer = start + 4 * step;
  } else if (level === 2) {
    const start = 2 + r(8), step = 2 + r(4);
    seq = [start, start + step, start + 2 * step, start + 3 * step];
    answer = start + 4 * step;
  } else if (level === 3) {
    const start = 1 + r(4);
    seq = [start, start * 2, start * 4, start * 8];
    answer = start * 16;
  } else if (level === 4) {
    // growing differences: +1, +2, +3, +4
    const start = 1 + r(6); let cur = start, diff = 1; seq = [cur];
    for (let i = 0; i < 3; i++) { cur += diff; diff++; seq.push(cur); }
    answer = cur + diff;
  } else {
    // descending by a step
    const step = 2 + r(5), start = 40 + r(20);
    seq = [start, start - step, start - 2 * step, start - 3 * step];
    answer = start - 4 * step;
  }
  const distractors = new Set();
  const deltas = [1, -1, 2, -2, 3, step2(seq)];
  for (const d of shuffle(deltas)) { distractors.add(answer + d); if (distractors.size >= 3) break; }
  const opts = shuffle([answer, ...[...distractors].filter(x => x !== answer).slice(0, 3)]);
  return { lead: 'What number comes next?', big: seq.join('   ') + '   ?',
    prompt: '', options: opts.map(String), answer: String(answer) };
}
function step2(seq) { return Math.abs((seq[1] - seq[0]) || 5); }

// =====================================================================
// Orientation prompts - gentle grounding questions about today
// =====================================================================
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SEASONS = ['Winter', 'Spring', 'Summer', 'Autumn'];
function buildOrientationQuestions() {
  const now = new Date();
  const weekday = WEEKDAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const year = now.getFullYear();
  const season = SEASONS[[11, 0, 1].includes(now.getMonth()) ? 0
    : [2, 3, 4].includes(now.getMonth()) ? 1
    : [5, 6, 7].includes(now.getMonth()) ? 2 : 3];
  const h24 = now.getHours();
  const partOfDay = h24 < 12 ? 'Morning' : h24 < 17 ? 'Afternoon' : 'Evening';

  const qs = [
    { prompt: 'What day of the week is it today?', answer: weekday,
      options: pickOptions(weekday, WEEKDAYS, 4),
      confirmRight: `Yes, today is ${weekday}.`, confirmWrong: `Today is ${weekday}.` },
    { prompt: 'What month are we in?', answer: month,
      options: pickOptions(month, MONTHS, 4),
      confirmRight: `That's right, it is ${month}.`, confirmWrong: `It is ${month}.` },
    { prompt: 'What season is it?', answer: season,
      options: pickOptions(season, SEASONS, 4),
      confirmRight: `Yes, it is ${season}.`, confirmWrong: `It is ${season}.` },
    { prompt: 'What year is it?', answer: String(year),
      options: pickOptions(String(year), [year - 1, year, year + 1, year + 2].map(String), 4),
      confirmRight: `Correct, the year is ${year}.`, confirmWrong: `The year is ${year}.` },
    { prompt: 'Is it morning, afternoon, or evening right now?', answer: partOfDay,
      options: ['Morning', 'Afternoon', 'Evening'],
      confirmRight: `Yes, it is the ${partOfDay.toLowerCase()}.`, confirmWrong: `It is the ${partOfDay.toLowerCase()}.` },
  ];
  return qs;
}
function pickOptions(answer, pool, n) {
  const others = shuffle(pool.filter(x => x !== answer)).slice(0, n - 1);
  return shuffle([answer, ...others]);
}

// =====================================================================
// Match the pairs (flip cards)
// =====================================================================
const PAIR_WORDS = ['SUN', 'CAT', 'DOG', 'HAT', 'CUP', 'BUS', 'PEN', 'KEY', 'BOX', 'FAN'];
async function startMatch() {
  const level = await resolveLevel('match_pairs');
  const pairs = 3 + level;                       // level 1 -> 4 pairs, up to 8
  const words = shuffle(PAIR_WORDS).slice(0, pairs);
  const deck = shuffle([...words, ...words]);
  const start = Date.now();
  let first = null, lock = false, matched = 0, mistakes = 0;

  const grid = h('div', { class: 'cards-grid' });
  const progress = h('p', { class: 'game-progress' }, `Find all ${pairs} matching pairs`);

  deck.forEach((word) => {
    const card = h('button', { class: 'flip', 'data-face': 'down',
      'aria-label': 'Hidden card', onclick: () => flip(card, word) }, '?');
    grid.appendChild(card);
  });

  function flip(card, word) {
    if (lock || card.dataset.face !== 'down') return;
    card.dataset.face = 'up'; card.textContent = word;
    if (!first) { first = { card, word }; return; }
    if (first.word === word && first.card !== card) {
      first.card.dataset.face = card.dataset.face = 'matched';
      first.card.disabled = card.disabled = true;
      first = null; matched++;
      if (matched === pairs) finishMatch();
    } else {
      mistakes++; lock = true;
      const a = first; first = null;
      setTimeout(() => {
        a.card.dataset.face = card.dataset.face = 'down';
        a.card.textContent = card.textContent = '?';
        lock = false;
      }, 850);
    }
  }

  async function finishMatch() {
    const secs = Math.round((Date.now() - start) / 1000);
    const ratio = pairs / (pairs + mistakes);     // 1.0 = flawless
    const newLevel = adapt('match_pairs', level, ratio >= 0.7 ? 0.9 : ratio < 0.5 ? 0.3 : 0.6);
    try {
      await saveGameResult({ game_type: 'match_pairs', score: pairs, max_score: pairs,
        difficulty: level, duration_seconds: secs, details: { mistakes } });
    } catch {}
    banner(cheer());
    resultScreen('match_pairs', pairs, pairs, ratio, newLevel, level, startMatch);
  }

  mount(progress, grid,
    h('p', { class: 'center muted', style: 'margin-top:12px' },
      'Tap two cards to see if they match.'));
}

// =====================================================================
// Progress / trends
// =====================================================================
async function renderProgress() {
  mount(h('p', { class: 'lead' }, 'Loading your progress...'));
  let results = [];
  try { results = await recentResults(40); } catch {
    return mount(h('div', { class: 'card center' }, h('p', { class: 'lead' }, 'Could not load progress.'),
      h('button', { class: 'btn', onclick: renderProgress }, 'Try again')));
  }

  if (!results.length) {
    return mount(h('h2', { class: 'section' }, 'Your Progress'),
      h('p', { class: 'empty' }, 'No games played yet. Play a game to start tracking.'),
      h('button', { class: 'btn btn--ghost', onclick: () => go('#/games') }, 'Back to games'));
  }

  // Per-game summary.
  const byType = {};
  for (const r of results) {
    (byType[r.game_type] ||= []).push(r);
  }
  const summaryCards = Object.entries(byType).map(([type, rows]) => {
    const plays = rows.length;
    const avg = Math.round(100 * rows.reduce((s, r) => s + (r.max_score ? r.score / r.max_score : 0), 0) / plays);
    return h('div', { class: 'card' },
      h('div', { class: 'card__title' }, GAME_NAMES[type] || type),
      h('div', { class: 'card__meta' }, `${plays} game${plays > 1 ? 's' : ''} - about ${avg}% correct`));
  });

  // Simple bar chart of the last ~14 games (oldest left).
  const recent = results.slice(0, 14).reverse();
  const bars = h('div', { class: 'trend-bar' },
    ...recent.map(r => {
      const pct = r.max_score ? Math.round(100 * r.score / r.max_score) : 50;
      return h('div', { class: 'trend-bar__col', style: `height:${Math.max(8, pct)}%`,
        title: `${GAME_NAMES[r.game_type] || r.game_type}: ${r.score}/${r.max_score ?? '?'}` });
    }));

  mount(
    h('h2', { class: 'section' }, 'Your Progress'),
    h('p', { class: 'lead' }, 'Recent games (left is older):'),
    bars,
    h('hr', { class: 'hr' }),
    ...summaryCards,
    h('button', { class: 'btn btn--ghost', style: 'margin-top:8px', onclick: () => go('#/games') }, 'Back to games'),
  );
}

// ---------- util ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
