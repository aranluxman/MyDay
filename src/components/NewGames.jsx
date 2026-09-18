import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Button } from './ui.jsx';
import {
  buildWordSearch, lineBetween, sameCells,
  buildUnscramble, buildSequence, extendSequence,
  buildSudoku, conflicts, isSolved,
  buildShoppingRecall, scoreRecall,
} from '../lib/gamesExtra.js';

// The five new games. Each one is handed `level` and calls `onComplete` with
// { score, max } — the Games screen owns saving, adaptive difficulty and the
// finish screen, exactly as it already does for the original six.
//
// Shared rules: no clock unless the game IS about memory, every wrong answer
// is a small shake rather than a buzzer, and nothing is ever lost by pausing.

/* ============================ Word Search ============================ */

export function WordSearch({ level, onComplete }) {
  const puzzle = useMemo(() => buildWordSearch(level), [level]);
  const [found, setFound] = useState([]);
  const [anchor, setAnchor] = useState(null);
  const [wrong, setWrong] = useState(false);

  const remaining = puzzle.words.filter((w) => !found.includes(w.word));

  useEffect(() => {
    if (puzzle.words.length && found.length === puzzle.words.length) {
      const t = setTimeout(() => onComplete({ score: found.length, max: puzzle.words.length }), 650);
      return () => clearTimeout(t);
    }
  }, [found, puzzle, onComplete]);

  const foundCells = new Set(
    puzzle.words.filter((w) => found.includes(w.word)).flatMap((w) => w.cells.map(([r, c]) => `${r},${c}`))
  );

  function tap(r, c) {
    if (!anchor) { setAnchor([r, c]); return; }
    if (anchor[0] === r && anchor[1] === c) { setAnchor(null); return; }

    const line = lineBetween(anchor, [r, c]);
    setAnchor(null);
    if (!line) { flashWrong(); return; }

    const hit = puzzle.words.find((w) => !found.includes(w.word) && sameCells(w.cells, line));
    if (hit) setFound((f) => [...f, hit.word]);
    else flashWrong();
  }
  function flashWrong() { setWrong(true); setTimeout(() => setWrong(false), 400); }

  return (
    <div className="stack">
      <div className="ws__theme">{puzzle.theme}</div>
      <div className="ws__words">
        {puzzle.words.map((w) => (
          <span key={w.word} className={`ws__word${found.includes(w.word) ? ' is-found' : ''}`}>
            {w.word}
          </span>
        ))}
      </div>

      <div className={`ws__grid${wrong ? ' is-wrong' : ''}`}
        style={{ '--n': puzzle.size }} role="grid" aria-label={`Word search, ${puzzle.size} by ${puzzle.size}`}>
        {puzzle.grid.map((row, r) => row.map((ch, c) => {
          const isFound = foundCells.has(`${r},${c}`);
          const isAnchor = anchor && anchor[0] === r && anchor[1] === c;
          return (
            <button key={`${r},${c}`} role="gridcell"
              className={`ws__cell${isFound ? ' is-found' : ''}${isAnchor ? ' is-anchor' : ''}`}
              aria-label={`${ch}, row ${r + 1}, column ${c + 1}`}
              onClick={() => tap(r, c)}>{ch}</button>
          );
        }))}
      </div>

      <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
        {anchor
          ? 'Now tap the last letter of the word.'
          : `Tap the first letter of a word. ${remaining.length} left to find.`}
      </p>
    </div>
  );
}

/* ============================= Unscramble ============================= */

export function Unscramble({ level, onComplete }) {
  const rounds = useMemo(() => buildUnscramble(level), [level]);
  const [index, setIndex] = useState(0);
  const [placed, setPlaced] = useState([]);
  const [score, setScore] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [state, setState] = useState('playing'); // playing | right | wrong

  const round = rounds[index];
  // Which tiles are still in the tray, tracked by position so duplicate
  // letters do not disappear together.
  const used = new Set(placed.map((p) => p.from));
  const answer = placed.map((p) => p.ch).join('');

  useEffect(() => { setPlaced([]); setShowHint(false); setState('playing'); }, [index]);

  function place(ch, from) {
    if (state !== 'playing' || used.has(from)) return;
    const next = [...placed, { ch, from }];
    setPlaced(next);
    if (next.length !== round.word.length) return;

    if (next.map((p) => p.ch).join('') === round.word) {
      setState('right');
      setScore((s) => s + 1);
      setTimeout(advance, 850);
    } else {
      setState('wrong');
      // Hand the letters back rather than failing the round: the point is to
      // solve it, not to be caught out.
      setTimeout(() => { setPlaced([]); setState('playing'); }, 700);
    }
  }
  function advance() {
    if (index + 1 < rounds.length) setIndex((i) => i + 1);
    else onComplete({ score: score + 1, max: rounds.length });
  }

  return (
    <div className="stack">
      <div className="un__count">Word {index + 1} of {rounds.length}</div>

      <div className={`un__answer un__answer--${state}`} aria-live="polite">
        {Array.from({ length: round.word.length }).map((_, i) => (
          <button key={i} className={`un__slot${placed[i] ? ' is-filled' : ''}`}
            onClick={() => placed[i] && state === 'playing' && setPlaced((p) => p.slice(0, i))}
            aria-label={placed[i] ? `Letter ${placed[i].ch}, tap to take back` : `Empty space ${i + 1}`}>
            {placed[i]?.ch || ''}
          </button>
        ))}
      </div>

      <div className="un__tray">
        {round.tiles.map((ch, i) => (
          <button key={i} className={`un__tile${used.has(i) ? ' is-used' : ''}`}
            disabled={used.has(i)} onClick={() => place(ch, i)} aria-label={`Letter ${ch}`}>
            {ch}
          </button>
        ))}
      </div>

      {showHint || !round.hintHidden ? (
        <p className="un__hint"><Icon name="sparkle" size={18} /> {round.hint}</p>
      ) : (
        <Button variant="ghost" icon="sparkle" onClick={() => setShowHint(true)}>Give me a hint</Button>
      )}
    </div>
  );
}

/* =========================== Memory Sequence =========================== */

export function MemorySequence({ level, onComplete }) {
  const cfg = useMemo(() => buildSequence(level), [level]);
  const [sequence, setSequence] = useState([]);
  const [step, setStep] = useState(0);
  const [lit, setLit] = useState(null);
  const [phase, setPhase] = useState('watch'); // watch | repeat | right | wrong
  const [best, setBest] = useState(0);
  const timers = useRef([]);

  // Every timeout is tracked so quitting mid-flash cannot fire into a
  // component that has gone away.
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  useEffect(() => { grow([]); /* first round */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function grow(current) {
    const next = extendSequence(current, cfg.padCount);
    setSequence(next);
    setPhase('watch');
    setStep(0);
    clearTimers();
    next.forEach((padIndex, i) => {
      timers.current.push(setTimeout(() => setLit(padIndex), i * cfg.flashMs + 400));
      timers.current.push(setTimeout(() => setLit(null), i * cfg.flashMs + 400 + cfg.flashMs * 0.6));
    });
    timers.current.push(setTimeout(() => setPhase('repeat'), next.length * cfg.flashMs + 500));
  }

  function tap(padIndex) {
    if (phase !== 'repeat') return;
    if (padIndex !== sequence[step]) {
      setPhase('wrong');
      // The run ends, but the score is how far they got — which is the real
      // achievement in this game.
      clearTimers();
      timers.current.push(setTimeout(() => onComplete({ score: best, max: cfg.target }), 1100));
      return;
    }
    const nextStep = step + 1;
    setStep(nextStep);
    if (nextStep < sequence.length) return;

    const reached = sequence.length;
    setBest((b) => Math.max(b, reached));
    if (reached >= cfg.target) {
      setPhase('right');
      clearTimers();
      timers.current.push(setTimeout(() => onComplete({ score: cfg.target, max: cfg.target }), 900));
      return;
    }
    setPhase('right');
    clearTimers();
    timers.current.push(setTimeout(() => grow(sequence), 800));
  }

  return (
    <div className="stack">
      <div className="ms__status" aria-live="polite">
        {phase === 'watch' && 'Watch carefully…'}
        {phase === 'repeat' && `Your turn — ${sequence.length} to repeat`}
        {phase === 'right' && 'Correct!'}
        {phase === 'wrong' && `Not quite. You reached ${best}.`}
      </div>
      <div className="ms__progress">Round {sequence.length} of {cfg.target}</div>

      <div className={`ms__pads ms__pads--${cfg.padCount}`}>
        {cfg.pads.map((pad, i) => (
          <button key={pad.id}
            className={`ms__pad ms__pad--${pad.tone}${lit === i ? ' is-lit' : ''}`}
            disabled={phase !== 'repeat'}
            onClick={() => tap(i)}
            aria-label={pad.label}>
            {/* Shape AND word, so the game never depends on telling colours
                apart — which is exactly what many older eyes cannot do. */}
            <span className={`ms__shape ms__shape--${pad.shape}`} aria-hidden="true" />
            <span className="ms__label">{pad.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================= Mini Sudoku ============================= */

export function MiniSudoku({ level, onComplete }) {
  const puzzle = useMemo(() => buildSudoku(level), [level]);
  const [grid, setGrid] = useState(() => puzzle.puzzle.map((r) => [...r]));
  const [selected, setSelected] = useState(null);
  const shape = { size: puzzle.size, boxH: puzzle.boxH, boxW: puzzle.boxW };
  const bad = useMemo(() => conflicts(grid, shape), [grid, shape.size, shape.boxH, shape.boxW]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isSolved(grid, shape)) {
      const t = setTimeout(() => onComplete({ score: puzzle.blanks, max: puzzle.blanks }), 700);
      return () => clearTimeout(t);
    }
  }, [grid]); // eslint-disable-line react-hooks/exhaustive-deps

  function setValue(v) {
    if (!selected) return;
    const [r, c] = selected;
    if (puzzle.given[r][c]) return; // a clue is not editable
    setGrid((g) => g.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? v : cell))));
  }

  const filled = grid.flat().filter(Boolean).length;
  const total = puzzle.size * puzzle.size;

  return (
    <div className="stack">
      <div className="sd__progress">{filled} of {total} squares filled</div>

      <div className="sd__grid" style={{ '--n': puzzle.size, '--bh': puzzle.boxH, '--bw': puzzle.boxW }}
        role="grid" aria-label={`Sudoku, ${puzzle.size} by ${puzzle.size}`}>
        {grid.map((row, r) => row.map((v, c) => {
          const given = puzzle.given[r][c];
          const isBad = bad.has(`${r},${c}`);
          const isSel = selected && selected[0] === r && selected[1] === c;
          return (
            <button key={`${r},${c}`} role="gridcell"
              className={`sd__cell${given ? ' is-given' : ''}${isBad ? ' is-bad' : ''}${isSel ? ' is-sel' : ''}`}
              style={{
                borderRightWidth: (c + 1) % puzzle.boxW === 0 && c + 1 < puzzle.size ? 3 : undefined,
                borderBottomWidth: (r + 1) % puzzle.boxH === 0 && r + 1 < puzzle.size ? 3 : undefined,
              }}
              aria-label={`Row ${r + 1}, column ${c + 1}${v ? `, ${v}` : ', empty'}${isBad ? ', clashes' : ''}`}
              onClick={() => !given && setSelected([r, c])}>
              {v || ''}
            </button>
          );
        }))}
      </div>

      <div className="sd__keys">
        {Array.from({ length: puzzle.size }, (_, i) => i + 1).map((n) => (
          <button key={n} className="sd__key" disabled={!selected} onClick={() => setValue(n)}>{n}</button>
        ))}
        <button className="sd__key sd__key--clear" disabled={!selected} onClick={() => setValue(0)}
          aria-label="Clear this square">
          <Icon name="close" size={22} />
        </button>
      </div>

      {bad.size > 0 && (
        <p className="sd__hint" role="status">
          <Icon name="bell" size={18} />
          A number is repeated in a row, column or box. Change one of the red squares.
        </p>
      )}
    </div>
  );
}

/* ========================== Shopping List Recall ========================== */

export function ShoppingRecall({ level, onComplete }) {
  const game = useMemo(() => buildShoppingRecall(level), [level]);
  const [phase, setPhase] = useState('memorise'); // memorise | pick | done
  const [left, setLeft] = useState(game.showSeconds);
  const [picked, setPicked] = useState([]);

  useEffect(() => {
    if (phase !== 'memorise') return;
    if (left <= 0) { setPhase('pick'); return; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, left]);

  function finish() {
    const result = scoreRecall(game.list, picked);
    setPhase('done');
    setTimeout(() => onComplete({ score: result.score, max: result.max, details: result }), 500);
  }

  if (phase === 'memorise') {
    return (
      <div className="stack">
        <div className="sr__head">
          <h3 className="sr__title">Remember this list</h3>
          {/* A countdown, not a deadline: they can move on early, and it
              never cuts them off mid-read. */}
          <span className="sr__timer" aria-live="off">{left}s</span>
        </div>
        <ul className="sr__list">
          {game.list.map((item) => <li key={item} className="sr__item">{item}</li>)}
        </ul>
        <Button size="lg" onClick={() => setPhase('pick')}>I have remembered them</Button>
      </div>
    );
  }

  return (
    <div className="stack">
      <h3 className="sr__title">Which were on the list?</h3>
      <p className="muted" style={{ margin: 0 }}>
        Pick {game.list.length}. A wrong pick cancels out a right one, so only pick what you remember.
      </p>
      <div className="sr__choices">
        {game.choices.map((item) => {
          const on = picked.includes(item);
          return (
            <button key={item} aria-pressed={on}
              className={`sr__choice${on ? ' is-on' : ''}`}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== item) : [...p, item]))}>
              <span className="sr__check" aria-hidden="true">{on ? <Icon name="check" size={18} stroke={3} /> : null}</span>
              {item}
            </button>
          );
        })}
      </div>
      <Button size="lg" disabled={phase === 'done'} onClick={finish}>
        {picked.length ? `Check my ${picked.length}` : 'I cannot remember any'}
      </Button>
    </div>
  );
}
