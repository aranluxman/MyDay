// The five new games. These tests care that every level produces a SOLVABLE
// puzzle — a brain game that cannot be finished is worse than no game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWordSearch, lineBetween, sameCells,
  buildUnscramble, scrambleWord,
  buildSequence, extendSequence, SEQUENCE_PADS,
  buildSudoku, canPlace, conflicts, isSolved,
  buildShoppingRecall, scoreRecall,
} from '../src/lib/gamesExtra.js';

const LEVELS = [1, 2, 3, 4, 5, 6, 7];

/* ---------------------------- word search ---------------------------- */

test('every word search level places words that are really in the grid', () => {
  for (const lv of LEVELS) {
    const g = buildWordSearch(lv);
    assert.ok(g.words.length >= 2, `level ${lv} placed too few words`);
    assert.equal(g.grid.length, g.size);
    for (const row of g.grid) {
      assert.equal(row.length, g.size);
      assert.ok(row.every((ch) => /^[A-Z]$/.test(ch)), `level ${lv} has an empty or odd cell`);
    }
    // The letters on the recorded path must spell the word.
    for (const { word, cells } of g.words) {
      assert.equal(cells.length, word.length);
      assert.equal(cells.map(([r, c]) => g.grid[r][c]).join(''), word,
        `level ${lv}: ${word} is not actually on its path`);
    }
  }
});

test('word search difficulty grows and stays inside the grid', () => {
  const small = buildWordSearch(1);
  const big = buildWordSearch(7);
  assert.ok(big.size > small.size);
  for (const lv of LEVELS) {
    const g = buildWordSearch(lv);
    for (const { cells } of g.words) {
      for (const [r, c] of cells) {
        assert.ok(r >= 0 && r < g.size && c >= 0 && c < g.size, `level ${lv} ran off the grid`);
      }
    }
  }
});

test('a selection is a straight line or nothing', () => {
  assert.deepEqual(lineBetween([0, 0], [0, 2]), [[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual(lineBetween([2, 0], [0, 0]), [[2, 0], [1, 0], [0, 0]]);
  assert.deepEqual(lineBetween([0, 0], [2, 2]), [[0, 0], [1, 1], [2, 2]]);
  assert.equal(lineBetween([0, 0], [1, 3]), null, 'a knight move is not a line');
  assert.deepEqual(lineBetween([1, 1], [1, 1]), [[1, 1]], 'a single cell');
});

test('a word counts whether it is traced forwards or backwards', () => {
  const cells = [[0, 0], [0, 1], [0, 2]];
  assert.equal(sameCells(cells, [[0, 0], [0, 1], [0, 2]]), true);
  assert.equal(sameCells(cells, [[0, 2], [0, 1], [0, 0]]), true, 'traced the other way');
  assert.equal(sameCells(cells, [[1, 0], [1, 1], [1, 2]]), false);
  assert.equal(sameCells(cells, [[0, 0], [0, 1]]), false);
  assert.equal(sameCells(null, cells), false);
});

/* ----------------------------- unscramble ----------------------------- */

test('unscramble gives the same letters, never the answer', () => {
  for (const lv of LEVELS) {
    const rounds = buildUnscramble(lv);
    assert.ok(rounds.length >= 3, `level ${lv} too short`);
    for (const r of rounds) {
      assert.notEqual(r.tiles.join(''), r.word, 'the puzzle is already solved');
      assert.deepEqual([...r.tiles].sort(), [...r.word].sort(), 'letters changed');
      assert.ok(r.hint.length > 0, 'every round has a hint available');
    }
  }
});

test('a hint always exists, it is just hidden at higher levels', () => {
  assert.equal(buildUnscramble(1)[0].hintHidden, false);
  assert.equal(buildUnscramble(7)[0].hintHidden, true);
});

test('scrambling a one-letter or repeated word does not hang', () => {
  assert.deepEqual(scrambleWord('A'), ['A']);
  assert.equal(scrambleWord('AAAA').length, 4);
  assert.deepEqual([...scrambleWord('AAAA')].sort(), ['A', 'A', 'A', 'A']);
});

/* ------------------------------ sequence ------------------------------ */

test('sequence pads never rely on colour alone', () => {
  for (const pad of SEQUENCE_PADS) {
    assert.ok(pad.label.length > 0, 'every pad has a word');
    assert.ok(pad.shape.length > 0, 'every pad has a shape');
  }
});

test('sequence grows with the level and is never rushed', () => {
  let lastTarget = 0;
  let lastFlash = Infinity;
  for (const lv of LEVELS) {
    const s = buildSequence(lv);
    assert.ok(s.target > lastTarget, `level ${lv} is not longer`);
    assert.ok(s.flashMs <= lastFlash, 'flashes should not get slower');
    assert.ok(s.flashMs >= 600, 'never faster than 600ms — this is not a reaction test');
    assert.equal(s.pads.length, s.padCount);
    lastTarget = s.target; lastFlash = s.flashMs;
  }
});

test('extending a sequence keeps it in range', () => {
  let seq = [];
  for (let i = 0; i < 40; i++) seq = extendSequence(seq, 4);
  assert.equal(seq.length, 40);
  assert.ok(seq.every((n) => n >= 0 && n < 4));
});

/* ------------------------------- sudoku ------------------------------- */

test('every sudoku level generates a legal, solvable puzzle', () => {
  for (const lv of LEVELS) {
    const p = buildSudoku(lv);
    assert.equal(p.solution.length, p.size);
    // The generated solution must itself be a valid completed grid.
    assert.equal(isSolved(p.solution, p), true, `level ${lv} solution is not legal`);
    // The puzzle must be the solution with holes, nothing else.
    for (let r = 0; r < p.size; r++) {
      for (let c = 0; c < p.size; c++) {
        if (p.puzzle[r][c] !== 0) {
          assert.equal(p.puzzle[r][c], p.solution[r][c], `level ${lv} clue contradicts the solution`);
        }
      }
    }
    const blanks = p.puzzle.flat().filter((v) => v === 0).length;
    assert.equal(blanks, p.blanks, `level ${lv} wrong number of blanks`);
    assert.equal(conflicts(p.puzzle, p).size, 0, `level ${lv} starts with a conflict`);
  }
});

test('sudoku grows from 4x4 to 9x9', () => {
  assert.equal(buildSudoku(1).size, 4);
  assert.equal(buildSudoku(4).size, 6);
  assert.equal(buildSudoku(7).size, 9);
  assert.deepEqual([buildSudoku(4).boxH, buildSudoku(4).boxW], [2, 3], '6x6 uses 2x3 boxes');
});

test('the rule check catches row, column and box clashes', () => {
  const p = buildSudoku(1);
  const shape = { size: p.size, boxH: p.boxH, boxW: p.boxW };
  const g = p.solution.map((r) => [...r]);
  const v = g[0][0];
  // Same value twice in a row is a conflict for both cells.
  g[0][1] = v;
  const bad = conflicts(g, shape);
  assert.ok(bad.has('0,0') && bad.has('0,1'));
  assert.equal(isSolved(g, shape), false);
  assert.equal(canPlace(g, 0, 1, v, shape.size, shape.boxH, shape.boxW), false);
});

test('an incomplete grid is not solved', () => {
  const p = buildSudoku(1);
  assert.equal(isSolved(p.puzzle, p), false, 'a puzzle with blanks is not finished');
});

/* --------------------------- shopping recall --------------------------- */

test('the shopping list is always findable among the choices', () => {
  for (const lv of LEVELS) {
    const g = buildShoppingRecall(lv);
    assert.ok(g.list.length >= 3);
    for (const item of g.list) {
      assert.ok(g.choices.includes(item), `level ${lv}: ${item} is not offered`);
    }
    // No duplicates, or picking one would be ambiguous.
    assert.equal(new Set(g.choices).size, g.choices.length, 'duplicate choices');
    assert.ok(g.choices.length > g.list.length, 'there must be wrong answers too');
    assert.ok(g.showSeconds >= 12, 'never a snap glance');
  }
});

test('scoring rewards recall, not guessing everything', () => {
  const list = ['Milk', 'Bread', 'Eggs'];
  assert.deepEqual(scoreRecall(list, ['Milk', 'Bread', 'Eggs']),
    { correct: 3, wrong: 0, missed: 0, score: 3, max: 3 });

  // Picking the whole shop must not score full marks.
  const all = scoreRecall(list, ['Milk', 'Bread', 'Eggs', 'Tea', 'Jam', 'Rice']);
  assert.equal(all.correct, 3);
  assert.equal(all.wrong, 3);
  assert.equal(all.score, 0, 'guessing everything scores nothing');

  const partial = scoreRecall(list, ['Milk', 'Tea']);
  assert.deepEqual(partial, { correct: 1, wrong: 1, missed: 2, score: 0, max: 3 });

  assert.equal(scoreRecall(list, []).score, 0);
  assert.equal(scoreRecall(list, null).score, 0);
  // Never negative, however wrong the attempt.
  assert.equal(scoreRecall(list, ['Tea', 'Jam', 'Rice', 'Salt']).score, 0);
});
