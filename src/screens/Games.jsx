import { useEffect, useMemo, useRef, useState } from 'react';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, EmptyState } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { saveGameResult, recentResults } from '../lib/db.js';
import {
  GAME_NAMES, GAME_SUB, GAME_HOWTO, LEVELS, resolveLevel, adapt,
  buildWordQuestions, buildNumberQuestions, buildOrientationQuestions, buildMatchDeck,
  buildMathQuestions, buildOddOneOut,
} from '../lib/games.js';
import { WordSearch, Unscramble, MemorySequence, MiniSudoku, ShoppingRecall } from '../components/NewGames.jsx';
import { GameArt, HeroArt } from '../components/GameArt.jsx';

const BUILDERS = {
  word_puzzle: buildWordQuestions, number_pattern: buildNumberQuestions,
  quick_math: buildMathQuestions, odd_one_out: buildOddOneOut, orientation: buildOrientationQuestions,
};
const CHEERS = ['Great job!', 'Well done!', 'Nicely done!', 'You got it!', "That's right!", 'Excellent!'];
const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];
const GAMES = [
  'match_pairs', 'word_puzzle', 'number_pattern', 'quick_math', 'odd_one_out', 'orientation',
  'word_search', 'unscramble', 'memory_sequence', 'mini_sudoku', 'shopping_recall',
];
// The five new games render their own board rather than the shared quiz shell.
const CUSTOM_GAMES = {
  word_search: WordSearch, unscramble: Unscramble, memory_sequence: MemorySequence,
  mini_sudoku: MiniSudoku, shopping_recall: ShoppingRecall,
};
const HOWTO_SEEN_KEY = 'myday_game_howto_seen';
const GAME_ICONS = { match_pairs: 'brain', word_puzzle: 'notes', number_pattern: 'pulse', quick_math: 'plus', odd_one_out: 'eye', orientation: 'calendar', word_search: 'eye', unscramble: 'notes', memory_sequence: 'sparkle', mini_sudoku: 'calendar', shopping_recall: 'cart' };

// One game suggested per day, rotating through the list. Eleven games on a
// screen is a choice, and a choice is exactly what someone who is tired does
// not want — so the app picks one and the list stays there for anyone who
// would rather browse. Seeded by the date so it is the same all day and
// different tomorrow, rather than changing every time the screen re-renders.
function todaysGame() {
  const d = new Date();
  const dayNumber = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return GAMES[dayNumber % GAMES.length];
}

// The order games are listed in on the menu: the everyday favourites first.
const MENU_ORDER = [
  'word_search', 'match_pairs', 'word_puzzle', 'quick_math', 'number_pattern', 'mini_sudoku',
  'memory_sequence', 'shopping_recall', 'unscramble', 'odd_one_out', 'orientation',
];
const CATEGORIES = [
  { id: 'word', tint: 'pink', glyph: 'Abc', title: 'Word Games', sub: 'Improve memory, focus and vocabulary.',
    games: ['word_search', 'word_puzzle', 'unscramble', 'odd_one_out'] },
  { id: 'memory', tint: 'green', icon: 'sparkle', title: 'Memory & Focus', sub: 'Train your memory and concentration.',
    games: ['match_pairs', 'memory_sequence', 'shopping_recall', 'orientation'] },
  { id: 'math', tint: 'blue', title: 'Math & Logic', sub: 'Keep your brain sharp.',
    games: ['quick_math', 'number_pattern', 'mini_sudoku'] },
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Consecutive days (ending today or yesterday) with at least one game played.
function streakFromResults(results) {
  const days = new Set(results.map((r) => new Date(r.played_at).toDateString()));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // streak survives until today is missed
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

// This week, Sunday to Saturday: which days had a game.
function weekFromResults(results) {
  const days = new Set(results.map((r) => new Date(r.played_at).toDateString()));
  const today = new Date();
  const d = new Date(today);
  d.setDate(d.getDate() - d.getDay());
  return DAY_NAMES.map((name, i) => {
    const day = { name, played: days.has(d.toDateString()), today: i === today.getDay(), future: i > today.getDay() };
    d.setDate(d.getDate() + 1);
    return day;
  });
}

// Encouraging, never a scorecard: no "0 days", and milestones are celebrated
// gently rather than turned into something to lose.
function streakMessage(streak) {
  if (!streak) return 'Play any game to begin.';
  if (streak >= 30) return "That's a wonderful habit. Well done!";
  if (streak >= 7) return 'A whole week or more. Your brain thanks you!';
  if (streak >= 3) return 'Lovely. Keep it going if you can.';
  return 'Nice start! Come back tomorrow to keep it going.';
}

export default function Games() {
  const [screen, setScreen] = useState('menu'); // menu | categories | level | play | result | progress
  const [browse, setBrowse] = useState('menu'); // the list a game was picked from, to go back to
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState(1);
  const [result, setResult] = useState(null);

  // Each screen starts at its top, as a new page would.
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);

  function pickGame(g) { setBrowse(screen); setGame(g); setScreen('level'); }
  function start(lvl) { setLevel(lvl); setResult(null); setScreen('play'); }
  function finish(r) { setResult(r); setScreen('result'); }
  const back = () => setScreen(browse);

  if (screen === 'menu') return <Menu onPick={pickGame} onCategories={() => setScreen('categories')} onProgress={() => setScreen('progress')} />;
  if (screen === 'categories') return <Categories onPick={pickGame} onBack={() => setScreen('menu')} />;
  if (screen === 'progress') return <Progress onBack={() => setScreen('menu')} />;
  if (screen === 'level') return <LevelPicker game={game} onStart={start} onBack={back} />;
  if (screen === 'play') return <Play key={`${game}-${level}-${result ? 'r' : 'f'}`} game={game} level={level} onComplete={finish} onQuit={back} />;
  if (screen === 'result') return <Result result={result} onAgain={() => start(result.newLevel)} onMenu={back} />;
  return null;
}

function Menu({ onPick, onCategories, onProgress }) {
  const { data: results } = useAsync(() => recentResults(200), []);
  const played = results?.length ?? 0;
  const streak = results ? streakFromResults(results) : 0;
  const week = weekFromResults(results || []);
  const playedDays = week.filter((d) => d.played).map((d) => d.name);
  const best = results?.length
    ? Math.max(...results.map((r) => (r.max_score ? Math.round((100 * r.score) / r.max_score) : 0)))
    : 0;
  const today = useMemo(todaysGame, []);

  return (
    <div className="stack games">
      <p className="games__intro">Keep your mind active, have fun and build healthy habits.</p>

      <div className="gstreak">
        <span className="gstreak__ic"><Icon name={streak ? 'flame' : 'leaf'} size={26} stroke={2.4} /></span>
        <div className="gstreak__main">
          <p className="gstreak__t">{streak ? `${streak}-day streak!` : 'Start a streak today!'}</p>
          <p className="gstreak__d">{streakMessage(streak)}</p>
        </div>
        <div className="gweek" role="img"
          aria-label={playedDays.length ? `Played this week: ${playedDays.join(', ')}` : 'No games played yet this week'}>
          {week.map((d) => (
            <span key={d.name} className={`gweek__d${d.played ? ' is-played' : ''}${d.today ? ' is-today' : ''}${d.future ? ' is-future' : ''}`}>
              <i>{d.played && <Icon name="check" size={12} stroke={3.4} />}</i>
              <b>{d.name[0]}</b>
            </span>
          ))}
        </div>
      </div>

      <button type="button" className="ghero" aria-label={`Play today's game: ${GAME_NAMES[today]}`} onClick={() => onPick(today)}>
        <span className="ghero__main">
          <span className="ghero__badge"><Icon name="sparkle" size={20} /> Today's Game for You</span>
          <span className="ghero__name">{GAME_NAMES[today]}</span>
          <span className="ghero__sub">{GAME_SUB[today]}</span>
          <span className="ghero__go"><Icon name="play" size={20} /> Play Now</span>
        </span>
        <HeroArt game={today} />
      </button>

      <div className="section-head">
        <h3>All Games</h3>
        <button type="button" className="gfilter" onClick={onCategories}>
          All Categories <Icon name="chevron" size={18} stroke={2.6} />
        </button>
      </div>
      <div className="glist">
        {MENU_ORDER.map((g) => (
          <button key={g} type="button" className="glist__item" onClick={() => onPick(g)}>
            <GameArt game={g} />
            <span className="glist__main">
              <span className="glist__t">{GAME_NAMES[g]}</span>
              <span className="glist__d">{GAME_SUB[g]}</span>
            </span>
            <Icon name="chevron" size={20} className="glist__go" />
          </button>
        ))}
      </div>

      <div className="section-head">
        <h3>Your Progress</h3>
        <button className="section-head__link" onClick={onProgress}>See all</button>
      </div>
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile__ic stat-tile__ic--gold"><Icon name="star" size={24} /></span>
          <span className="stat-tile__n">{played}</span>
          <span className="stat-tile__l">Games played</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__ic stat-tile__ic--flame"><Icon name="flame" size={24} /></span>
          <span className="stat-tile__n">{streak ? `${streak} day${streak === 1 ? '' : 's'}` : 'Ready'}</span>
          <span className="stat-tile__l">{streak ? 'Current streak' : 'Play today to start'}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__ic stat-tile__ic--trophy"><Icon name="trophy" size={24} /></span>
          <span className="stat-tile__n">{best}%</span>
          <span className="stat-tile__l">Best score</span>
        </div>
      </div>
    </div>
  );
}

// Every game, grouped by what it exercises. Today's game carries the one
// filled Play button so the eye lands on it first.
function Categories({ onPick, onBack }) {
  const today = useMemo(todaysGame, []);
  return (
    <div className="stack games">
      <div className="ghead">
        <button type="button" className="ghead__back" aria-label="Back to Brain Games" onClick={onBack}>
          <Icon name="back" size={24} stroke={2.4} />
        </button>
        <h2 className="ghead__t">All Categories</h2>
      </div>
      {CATEGORIES.map((c) => (
        <section key={c.id} className={`gcat gcat--${c.tint}`} aria-labelledby={`gcat-${c.id}`}>
          <div className="gcat__head">
            <span className="gcat__badge" aria-hidden="true">
              {c.icon ? <Icon name={c.icon} size={30} stroke={2.3} />
                : c.glyph ? <span className="gcat__abc">{c.glyph}</span>
                  : <span className="gcat__ops">+−<br />×=</span>}
            </span>
            <div>
              <h3 className="gcat__t" id={`gcat-${c.id}`}>{c.title}</h3>
              <p className="gcat__d">{c.sub}</p>
            </div>
          </div>
          <div className="gcat__list">
            {c.games.map((g) => (
              <button key={g} type="button" className="grow" aria-label={`Play ${GAME_NAMES[g]}: ${GAME_SUB[g]}`} onClick={() => onPick(g)}>
                <GameArt game={g} size="md" />
                <span className="grow__main">
                  <span className="grow__t">{GAME_NAMES[g]}</span>
                  <span className="grow__d">{GAME_SUB[g]}</span>
                </span>
                <span className={`gplay${g === today ? ' gplay--main' : ''}`}><Icon name="play" size={18} /> Play</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LevelPicker({ game, onStart, onBack }) {
  const [suggested, setSuggested] = useState(null);
  useEffect(() => { resolveLevel(game).then(setSuggested); }, [game]);
  return (
    <div className="stack">
      <h2 className="section">{GAME_NAMES[game]}</h2>
      <p className="muted">Choose a level. Higher numbers are harder.</p>
      <div className="level-grid">
        {LEVELS.map((l) => (
          <button key={l} className={`level-chip${suggested === l ? ' is-suggested' : ''}`} onClick={() => onStart(l)}>
            <span className="level-chip__n">{l}</span>
            <span className="level-chip__l">Level</span>
          </button>
        ))}
      </div>
      {suggested && <p className="muted center">Suggested for you: Level {suggested}</p>}
      <Button variant="ghost" icon="back" onClick={onBack}>Back to games</Button>
    </div>
  );
}

function Play({ game, level, onComplete, onQuit }) {
  const ui = useUI();
  const Custom = CUSTOM_GAMES[game];
  const saveAndFinish = useSaveResult(game, level, onComplete);
  const CustomBoard = Custom;

  // The how-to card appears before the FIRST play of each game, then only on
  // request — so it teaches without getting in the way afterwards.
  const [showHowTo, setShowHowTo] = useState(() => {
    if (!GAME_HOWTO[game]) return false;
    try { return !(JSON.parse(localStorage.getItem(HOWTO_SEEN_KEY) || '[]') || []).includes(game); }
    catch { return true; }
  });
  function dismissHowTo() {
    setShowHowTo(false);
    try {
      const seen = JSON.parse(localStorage.getItem(HOWTO_SEEN_KEY) || '[]') || [];
      if (!seen.includes(game)) localStorage.setItem(HOWTO_SEEN_KEY, JSON.stringify([...seen, game]));
    } catch {}
  }

  async function quit() {
    const ok = await ui.confirm({ title: 'Leave this game?', message: 'Your progress in this round will not be saved.', confirmLabel: 'Leave game', cancelLabel: 'Keep playing', danger: true });
    if (ok) onQuit();
  }

  if (showHowTo) return <div className="stack play"><HowToPlay game={game} onStart={dismissHowTo} onBack={onQuit} /></div>;

  return (
    <div className="stack play">
      <div className="play-head">
        <button className="play-quit" aria-label="Quit this game" onClick={quit}><Icon name="back" size={20} /> Quit</button>
        <span className="play-head__title">{GAME_NAMES[game]} · Level {level}</span>
        <button className="play-quit" aria-label="How to play" onClick={() => setShowHowTo(true)}>
          <Icon name="notes" size={20} /> Help
        </button>
      </div>
      {Custom
        ? <CustomBoard key={`${game}-${level}`} level={level} onComplete={saveAndFinish} />
        : game === 'match_pairs'
          ? <Match level={level} onComplete={onComplete} />
          : <Quiz game={game} level={level} onComplete={onComplete} />}
    </div>
  );
}

/**
 * Saving, adaptive difficulty and the result shape are the same for every new
 * game, so they live here rather than being repeated in each board. A board
 * only has to say how it did.
 */
function useSaveResult(game, level, onComplete) {
  const ui = useUI();
  return async function saveAndFinish({ score, max, details }) {
    const ratio = max ? score / max : 0;
    const newLevel = adapt(game, level, ratio);
    try { await saveGameResult({ game_type: game, score, max_score: max, difficulty: level, details: details ?? null }); }
    catch { ui.toast('Saved on this device — we will upload it when you are back online.', 'info'); }
    onComplete({ game, score, max, ratio, newLevel, oldLevel: level });
  };
}

// Shown before the first play of a game, and again from the Quit row.
function HowToPlay({ game, onStart, onBack }) {
  const steps = GAME_HOWTO[game] || [];
  return (
    <div className="stack">
      <div className="howto">
        <div className="howto__ic"><Icon name={GAME_ICONS[game] || 'brain'} size={30} /></div>
        <h2 className="howto__title">{GAME_NAMES[game]}</h2>
        <p className="howto__sub">{GAME_SUB[game]}</p>
        <ol className="howto__steps">
          {steps.map((step, i) => (
            <li key={i}><span className="howto__n">{i + 1}</span><span>{step}</span></li>
          ))}
        </ol>
        <p className="howto__calm">
          <Icon name="clock" size={18} /> There is no time limit. Take as long as you like.
        </p>
      </div>
      <Button size="lg" onClick={onStart}>Start playing</Button>
      <Button variant="ghost" onClick={onBack}>Back to the games</Button>
    </div>
  );
}

function Quiz({ game, level, onComplete }) {
  const ui = useUI();
  const questions = useMemo(() => BUILDERS[game](level), [game, level]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const correctRef = useRef(0);
  const q = questions[idx];
  const answered = picked != null;

  function choose(opt) {
    if (answered) return;
    setPicked(opt);
    if (opt === q.answer) { correctRef.current++; ui.toast(cheer()); }
  }
  async function next() {
    if (idx < questions.length - 1) { setIdx(idx + 1); setPicked(null); return; }
    const score = correctRef.current;
    const ratio = score / questions.length;
    const newLevel = adapt(game, level, ratio);
    try { await saveGameResult({ game_type: game, score, max_score: questions.length, difficulty: level, details: { ratio } }); }
    catch { ui.toast('Saved on this device — it will be added to your progress when you\'re back online.', 'info'); }
    onComplete({ game, score, max: questions.length, ratio, newLevel, oldLevel: level });
  }
  const feedback = answered ? (picked === q.answer ? (q.confirmRight || "That's right.") : (q.confirmWrong || `The answer is ${q.answer}.`)) : null;

  return (
    <div className="stack">
      <div className="game-progress"><div className="game-progress__bar" style={{ width: `${(idx / questions.length) * 100}%` }} /></div>
      <p className="game-count">Question {idx + 1} of {questions.length}</p>
      {q.lead && <p className="lead center">{q.lead}</p>}
      {q.big && <div className="big-number">{q.big}</div>}
      {q.prompt && <p className="prompt-q">{q.prompt}</p>}
      <div className="choice-grid">
        {q.options.map((opt) => {
          let cls = 'choice';
          if (answered && opt === q.answer) cls += ' choice--right';
          else if (answered && opt === picked) cls += ' choice--wrong';
          return <button key={opt} className={cls} disabled={answered} onClick={() => choose(opt)}>{opt}</button>;
        })}
      </div>
      {answered && <p className={`feedback ${picked === q.answer ? 'feedback--good' : 'feedback--bad'}`}>{feedback}</p>}
      {answered && <Button onClick={next}>{idx < questions.length - 1 ? 'Next question' : 'See result'}</Button>}
    </div>
  );
}

function Match({ level, onComplete }) {
  const ui = useUI();
  const { pairs, deck } = useMemo(() => buildMatchDeck(level), [level]);
  const [faces, setFaces] = useState(() => deck.map(() => 'down'));
  const first = useRef(null);
  const lock = useRef(false);
  const matched = useRef(0);
  const mistakes = useRef(0);
  const start = useRef(Date.now());

  function flip(i) {
    if (lock.current || faces[i] !== 'down' || first.current === i) return;
    setFaces((f) => f.map((v, j) => (j === i ? 'up' : v)));
    if (first.current == null) { first.current = i; return; }
    const a = first.current; first.current = null;
    if (deck[a] === deck[i]) {
      matched.current++;
      setFaces((f) => f.map((v, j) => (j === a || j === i ? 'matched' : v)));
      if (matched.current === pairs) finish();
    } else {
      mistakes.current++; lock.current = true;
      setTimeout(() => { setFaces((f) => f.map((v, j) => (j === a || j === i ? 'down' : v))); lock.current = false; }, 850);
    }
  }
  async function finish() {
    const secs = Math.round((Date.now() - start.current) / 1000);
    const ratio = pairs / (pairs + mistakes.current);
    const newLevel = adapt('match_pairs', level, ratio >= 0.7 ? 0.9 : ratio < 0.5 ? 0.3 : 0.6);
    try { await saveGameResult({ game_type: 'match_pairs', score: pairs, max_score: pairs, difficulty: level, duration_seconds: secs, details: { mistakes: mistakes.current } }); ui.toast(cheer()); }
    catch { ui.toast('Saved on this device — it will be added to your progress when you\'re back online.', 'info'); }
    setTimeout(() => onComplete({ game: 'match_pairs', score: pairs, max: pairs, ratio, newLevel, oldLevel: level }), 450);
  }

  return (
    <div className="stack">
      <p className="game-count">Find all {pairs} matching pairs</p>
      <div className={`cards-grid cards-grid--${deck.length > 16 ? 5 : 4}`}>
        {deck.map((word, i) => (
          <button key={i} className="flip" data-face={faces[i]} disabled={faces[i] === 'matched'}
            aria-label={faces[i] === 'down' ? 'Hidden card' : word} onClick={() => flip(i)}>
            {faces[i] === 'down' ? '?' : word}
          </button>
        ))}
      </div>
      <p className="muted center">Tap two cards to see if they match.</p>
    </div>
  );
}

function Result({ result, onAgain, onMenu }) {
  const { game, score, max, ratio, newLevel, oldLevel } = result;
  const good = ratio >= 0.6;
  let note = null;
  if (game !== 'orientation') {
    if (newLevel > oldLevel) note = `Great work - moving you up to Level ${newLevel}.`;
    else if (newLevel < oldLevel) note = `Easing back to Level ${newLevel} next time.`;
  }
  const line = game === 'match_pairs' ? `You found all ${max} pairs!` : `You got ${score} out of ${max}.`;
  return (
    <div className="stack center result">
      <div className={`result__badge${good ? ' result__badge--good' : ''}`}><Icon name="check" size={44} /></div>
      <h2 className="section">{good ? cheer() : 'Nice effort.'}</h2>
      <p className="prompt-q">{line}</p>
      {note && <p className="muted">{note}</p>}
      <Button size="lg" onClick={onAgain}>Play again</Button>
      <Button variant="ghost" onClick={onMenu}>Back to games</Button>
    </div>
  );
}

function Progress({ onBack }) {
  const { data, loading, error, reload } = useAsync(() => recentResults(40), []);
  if (loading) return <Spinner label="Loading your progress..." />;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;
  if (!data.length) return <div className="stack"><h2 className="section">Your Progress</h2><EmptyState icon="brain">No games played yet. Play a game to start tracking.</EmptyState><Button variant="ghost" icon="back" onClick={onBack}>Back to games</Button></div>;

  const byType = {};
  for (const r of data) (byType[r.game_type] ||= []).push(r);
  const recent = data.slice(0, 14).reverse();

  return (
    <div className="stack">
      <h2 className="section">Your Progress</h2>
      <p className="muted">Recent games (left is older):</p>
      <div className="trend">
        {recent.map((r, i) => {
          const pct = r.max_score ? Math.round((100 * r.score) / r.max_score) : 50;
          return <div key={i} className="trend__col" style={{ height: `${Math.max(8, pct)}%` }} title={`${GAME_NAMES[r.game_type]}: ${r.score}/${r.max_score ?? '?'}`} />;
        })}
      </div>
      {Object.entries(byType).map(([type, rows]) => {
        const plays = rows.length;
        const avg = Math.round((100 * rows.reduce((s, r) => s + (r.max_score ? r.score / r.max_score : 0), 0)) / plays);
        return <Card key={type}><div className="card__title">{GAME_NAMES[type]}</div><div className="card__meta">{plays} game{plays > 1 ? 's' : ''} · about {avg}% correct · last level {rows[0].difficulty}</div></Card>;
      })}
      <Button variant="ghost" icon="back" onClick={onBack}>Back to games</Button>
    </div>
  );
}
