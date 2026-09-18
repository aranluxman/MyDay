// Builders for the five new brain games. Pure: no React, no Supabase, no
// timers — every one takes a level (1-7) and returns a finished puzzle, so the
// screens stay thin and the difficulty curve is testable.
//
// The difficulty rule throughout is "more to hold in mind", never "less time".
// There is no clock in any of these by default: hurrying an older adult is how
// a brain game stops being enjoyable and starts feeling like a test.
import { shuffle } from './games.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pick = (arr, n) => shuffle(arr).slice(0, n);

/* ========================= 1. Word Search ========================= */

const WORD_THEMES = [
  { theme: 'In the kitchen', words: ['CUP', 'PAN', 'FORK', 'PLATE', 'SPOON', 'KETTLE', 'TEAPOT', 'SAUCER'] },
  { theme: 'In the garden', words: ['ROSE', 'LEAF', 'SEED', 'GRASS', 'TULIP', 'DAISY', 'HEDGE', 'BASKET'] },
  { theme: 'Weather', words: ['SUN', 'RAIN', 'SNOW', 'CLOUD', 'WINDY', 'FROST', 'SUNNY', 'THUNDER'] },
  { theme: 'Family', words: ['SON', 'AUNT', 'NIECE', 'UNCLE', 'COUSIN', 'SISTER', 'NEPHEW', 'GRANNY'] },
  { theme: 'Breakfast', words: ['EGG', 'TOAST', 'JAM', 'TEA', 'BEANS', 'CEREAL', 'BUTTER', 'COFFEE'] },
  { theme: 'Birds', words: ['OWL', 'CROW', 'ROBIN', 'SWAN', 'GOOSE', 'FINCH', 'MAGPIE', 'SPARROW'] },
];

// Directions grow with the level: across and down first, then backwards, then
// diagonals. Reversed and diagonal words are the hard part, so they arrive
// last rather than being in the mix from level 1.
function directionsFor(level) {
  const base = [[0, 1], [1, 0]];                       // across, down
  if (level >= 3) base.push([0, -1], [-1, 0]);         // backwards
  if (level >= 5) base.push([1, 1], [-1, -1]);         // diagonals
  if (level >= 7) base.push([1, -1], [-1, 1]);
  return base;
}

/**
 * @returns {{ size, theme, grid: string[][], words: {word, cells: [r,c][]}[] }}
 */
export function buildWordSearch(level = 1) {
  const lv = clamp(level, 1, 7);
  const size = [7, 8, 9, 10, 11, 12, 13][lv - 1];
  const wordCount = [3, 4, 4, 5, 5, 6, 6][lv - 1];
  const { theme, words: pool } = shuffle(WORD_THEMES)[0];

  // Only words that fit, shortest first so the big ones still find room.
  const candidates = pick(pool.filter((w) => w.length <= size), wordCount)
    .sort((a, b) => b.length - a.length);

  const grid = Array.from({ length: size }, () => Array(size).fill(''));
  const dirs = directionsFor(lv);
  const placed = [];

  for (const word of candidates) {
    const spot = findSpot(grid, word, dirs, size);
    if (!spot) continue; // no room: quietly use fewer words rather than fail
    const cells = [];
    for (let i = 0; i < word.length; i++) {
      const r = spot.r + spot.dr * i;
      const c = spot.c + spot.dc * i;
      grid[r][c] = word[i];
      cells.push([r, c]);
    }
    placed.push({ word, cells });
  }

  // Fill the gaps. Letters are drawn from the words themselves so the filler
  // does not stand out as obviously random.
  const letterPool = (placed.map((p) => p.word).join('') || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').split('');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) grid[r][c] = letterPool[Math.floor(Math.random() * letterPool.length)];
    }
  }

  return { size, theme, grid, words: placed };
}

function findSpot(grid, word, dirs, size) {
  // Try random placements; give up rather than loop forever on a full grid.
  for (let attempt = 0; attempt < 220; attempt++) {
    const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)];
    const r = Math.floor(Math.random() * size);
    const c = Math.floor(Math.random() * size);
    const endR = r + dr * (word.length - 1);
    const endC = c + dc * (word.length - 1);
    if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue;

    let ok = true;
    for (let i = 0; i < word.length; i++) {
      const cell = grid[r + dr * i][c + dc * i];
      // An existing letter is fine only if it matches — that makes crossings.
      if (cell && cell !== word[i]) { ok = false; break; }
    }
    if (ok) return { r, c, dr, dc };
  }
  return null;
}

/** Are these two cell lists the same run of cells, in either direction? */
export function sameCells(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const fwd = a.every(([r, c], i) => r === b[i][0] && c === b[i][1]);
  const rev = a.every(([r, c], i) => r === b[b.length - 1 - i][0] && c === b[b.length - 1 - i][1]);
  return fwd || rev;
}

/** The straight line of cells between two points, or null if not a line. */
export function lineBetween(from, to) {
  const [r1, c1] = from;
  const [r2, c2] = to;
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  const len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1;
  // Must be horizontal, vertical or a true 45-degree diagonal.
  const straight = r1 === r2 || c1 === c2 || Math.abs(r2 - r1) === Math.abs(c2 - c1);
  if (!straight) return null;
  return Array.from({ length: len }, (_, i) => [r1 + dr * i, c1 + dc * i]);
}

/* ======================= 2. Unscramble the Word ======================= */

const SCRAMBLE_BANK = [
  { word: 'GARDEN', hint: 'Where flowers grow' },
  { word: 'KETTLE', hint: 'It boils the water' },
  { word: 'WINDOW', hint: 'You look through it' },
  { word: 'BLANKET', hint: 'Keeps you warm in bed' },
  { word: 'SLIPPER', hint: 'A soft shoe for indoors' },
  { word: 'TEAPOT', hint: 'Holds the tea' },
  { word: 'CUSHION', hint: 'Soft, on a chair' },
  { word: 'UMBRELLA', hint: 'For a rainy day' },
  { word: 'CALENDAR', hint: 'Shows the days and months' },
  { word: 'ARMCHAIR', hint: 'A comfortable seat' },
  { word: 'NEWSPAPER', hint: 'You read it in the morning' },
  { word: 'SANDWICH', hint: 'Bread with a filling' },
  { word: 'BUTTON', hint: 'Fastens a shirt' },
  { word: 'CURTAIN', hint: 'Covers a window' },
  { word: 'PILLOW', hint: 'Your head rests on it' },
  { word: 'TELEPHONE', hint: 'You ring someone on it' },
  { word: 'BISCUIT', hint: 'Goes with a cup of tea' },
  { word: 'SLIPPERS', hint: 'A pair, worn indoors' },
];

/** Longer words and fewer hints as the level rises. */
export function buildUnscramble(level = 1) {
  const lv = clamp(level, 1, 7);
  const maxLen = [6, 6, 7, 7, 8, 9, 9][lv - 1];
  const rounds = [3, 3, 4, 4, 5, 5, 6][lv - 1];

  const pool = SCRAMBLE_BANK.filter((w) => w.word.length <= maxLen);
  const chosen = pick(pool.length >= rounds ? pool : SCRAMBLE_BANK, rounds);

  return chosen.map((entry) => ({
    word: entry.word,
    hint: entry.hint,
    // A hint is always available on request; from level 5 it is hidden until
    // asked for, rather than removed.
    hintHidden: lv >= 5,
    tiles: scrambleWord(entry.word),
  }));
}

/** Letters shuffled, guaranteed not to come back as the original word. */
export function scrambleWord(word) {
  const letters = word.split('');
  if (letters.length < 2) return letters;
  for (let attempt = 0; attempt < 30; attempt++) {
    const out = shuffle(letters);
    if (out.join('') !== word) return out;
  }
  // Degenerate case (every letter identical): swap the ends and accept it.
  return [...letters.slice(1), letters[0]];
}

/* ======================== 3. Memory Sequence ======================== */

// Shape and label as well as colour, so the game never depends on telling
// colours apart — which is exactly what a lot of older eyes cannot do.
export const SEQUENCE_PADS = [
  { id: 'circle', label: 'Circle', shape: 'circle', tone: 'good' },
  { id: 'square', label: 'Square', shape: 'square', tone: 'primary' },
  { id: 'triangle', label: 'Triangle', shape: 'triangle', tone: 'warn' },
  { id: 'diamond', label: 'Diamond', shape: 'diamond', tone: 'violet' },
  { id: 'star', label: 'Star', shape: 'star', tone: 'bad' },
  { id: 'heart', label: 'Heart', shape: 'heart', tone: 'teal' },
];

export function buildSequence(level = 1) {
  const lv = clamp(level, 1, 7);
  return {
    // How many pads are on screen, and how long the sequence grows to.
    padCount: [3, 3, 4, 4, 5, 5, 6][lv - 1],
    target: [3, 4, 5, 6, 7, 8, 9][lv - 1],
    // Milliseconds each pad lights for. Slower at low levels, never fast.
    flashMs: [900, 850, 800, 750, 700, 650, 600][lv - 1],
    pads: SEQUENCE_PADS.slice(0, [3, 3, 4, 4, 5, 5, 6][lv - 1]),
  };
}

/** The next step of a growing sequence. */
export function extendSequence(sequence, padCount) {
  const next = Math.floor(Math.random() * padCount);
  return [...sequence, next];
}

/* ========================== 4. Mini Sudoku ========================== */

// 4x4 (2x2 boxes) rising to 6x6 (2x3) and 9x9 (3x3) at the top levels.
const SUDOKU_SHAPES = [
  { size: 4, boxH: 2, boxW: 2, blanks: 4 },
  { size: 4, boxH: 2, boxW: 2, blanks: 6 },
  { size: 4, boxH: 2, boxW: 2, blanks: 8 },
  { size: 6, boxH: 2, boxW: 3, blanks: 10 },
  { size: 6, boxH: 2, boxW: 3, blanks: 14 },
  { size: 9, boxH: 3, boxW: 3, blanks: 28 },
  { size: 9, boxH: 3, boxW: 3, blanks: 38 },
];

export function buildSudoku(level = 1) {
  const lv = clamp(level, 1, 7);
  const shape = SUDOKU_SHAPES[lv - 1];
  const solution = generateSolved(shape);
  const puzzle = solution.map((row) => [...row]);

  // Remove cells at random. No uniqueness proof: for a 4x4 warm-up puzzle the
  // cost of guaranteeing one solution is not worth it, and the game accepts
  // any arrangement that satisfies the rules (see isSolved).
  const cells = shuffle(
    Array.from({ length: shape.size * shape.size }, (_, i) => [Math.floor(i / shape.size), i % shape.size])
  ).slice(0, shape.blanks);
  for (const [r, c] of cells) puzzle[r][c] = 0;

  return { ...shape, puzzle, solution, given: puzzle.map((row) => row.map((v) => v !== 0)) };
}

function generateSolved({ size, boxH, boxW }) {
  const grid = Array.from({ length: size }, () => Array(size).fill(0));
  const values = shuffle(Array.from({ length: size }, (_, i) => i + 1));
  fill(grid, 0, size, boxH, boxW, values);
  return grid;
}

function fill(grid, index, size, boxH, boxW, values) {
  if (index === size * size) return true;
  const r = Math.floor(index / size);
  const c = index % size;
  for (const v of shuffle(values)) {
    if (canPlace(grid, r, c, v, size, boxH, boxW)) {
      grid[r][c] = v;
      if (fill(grid, index + 1, size, boxH, boxW, values)) return true;
      grid[r][c] = 0;
    }
  }
  return false;
}

/** Rule check used by both the generator and the live conflict hints. */
export function canPlace(grid, row, col, value, size, boxH, boxW) {
  for (let i = 0; i < size; i++) {
    if (i !== col && grid[row][i] === value) return false;
    if (i !== row && grid[i][col] === value) return false;
  }
  const r0 = Math.floor(row / boxH) * boxH;
  const c0 = Math.floor(col / boxW) * boxW;
  for (let r = r0; r < r0 + boxH; r++) {
    for (let c = c0; c < c0 + boxW; c++) {
      if ((r !== row || c !== col) && grid[r][c] === value) return false;
    }
  }
  return true;
}

/** Cells that clash with another cell — the gentle conflict hint. */
export function conflicts(grid, { size, boxH, boxW }) {
  const bad = new Set();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = grid[r][c];
      if (!v) continue;
      if (!canPlace(grid, r, c, v, size, boxH, boxW)) bad.add(`${r},${c}`);
    }
  }
  return bad;
}

/** Complete and legal — not necessarily the generated solution. */
export function isSolved(grid, shape) {
  for (const row of grid) if (row.some((v) => !v)) return false;
  return conflicts(grid, shape).size === 0;
}

/* ===================== 5. Shopping List Recall ===================== */

const SHOP_ITEMS = [
  'Milk', 'Bread', 'Eggs', 'Butter', 'Cheese', 'Apples', 'Bananas', 'Carrots',
  'Potatoes', 'Onions', 'Tomatoes', 'Chicken', 'Rice', 'Pasta', 'Tea', 'Coffee',
  'Sugar', 'Flour', 'Soap', 'Shampoo', 'Yoghurt', 'Honey', 'Biscuits', 'Oranges',
  'Lemons', 'Cereal', 'Jam', 'Salt', 'Pepper', 'Fish',
];

export function buildShoppingRecall(level = 1) {
  const lv = clamp(level, 1, 7);
  const listSize = [3, 4, 5, 5, 6, 7, 8][lv - 1];
  const extra = [3, 4, 5, 7, 8, 9, 10][lv - 1];

  const all = shuffle(SHOP_ITEMS);
  const list = all.slice(0, listSize);
  const distractors = all.slice(listSize, listSize + extra);

  return {
    list,
    // The choices the person picks from, list and distractors mixed together.
    choices: shuffle([...list, ...distractors]),
    // How long the list is shown. Generous, and the person can move on early;
    // it never cuts them off mid-read.
    showSeconds: [12, 12, 14, 14, 16, 16, 18][lv - 1],
  };
}

/** Scores a recall attempt: right picks minus wrong ones, never below zero. */
export function scoreRecall(list, picked) {
  const wanted = new Set(list);
  const chosen = new Set(picked || []);
  let correct = 0;
  let wrong = 0;
  for (const item of chosen) (wanted.has(item) ? correct++ : wrong++);
  return {
    correct,
    wrong,
    missed: list.length - correct,
    // A wrong pick cancels a right one, so guessing everything scores zero
    // rather than full marks.
    score: Math.max(0, correct - wrong),
    max: list.length,
  };
}
