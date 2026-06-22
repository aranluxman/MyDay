import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, EmptyState } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { saveGameResult, recentResults } from '../lib/db.js';
import {
  GAME_NAMES, GAME_SUB, LEVELS, resolveLevel, adapt,
  buildWordQuestions, buildNumberQuestions, buildOrientationQuestions, buildMatchDeck,
  buildMathQuestions, buildOddOneOut,
} from '../lib/games.js';

const BUILDERS = {
  word_puzzle: buildWordQuestions, number_pattern: buildNumberQuestions,
  quick_math: buildMathQuestions, odd_one_out: buildOddOneOut, orientation: buildOrientationQuestions,
};
const CHEERS = ['Great job!', 'Well done!', 'Nicely done!', 'You got it!', "That's right!", 'Excellent!'];
const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];
const GAMES = ['match_pairs', 'word_puzzle', 'number_pattern', 'quick_math', 'odd_one_out', 'orientation'];
const GAME_ICONS = { match_pairs: 'brain', word_puzzle: 'notes', number_pattern: 'pulse', quick_math: 'plus', odd_one_out: 'eye', orientation: 'calendar' };

export default function Games() {
  const navigate = useNavigate();
  const [screen, setScreen] = useState('menu'); // menu | level | play | result | progress
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState(1);
  const [result, setResult] = useState(null);

  function pickGame(g) { setGame(g); setScreen('level'); }
  function start(lvl) { setLevel(lvl); setResult(null); setScreen('play'); }
  function finish(r) { setResult(r); setScreen('result'); }

  if (screen === 'menu') return <Menu onPick={pickGame} onProgress={() => setScreen('progress')} onHome={() => navigate('/')} />;
  if (screen === 'progress') return <Progress onBack={() => setScreen('menu')} />;
  if (screen === 'level') return <LevelPicker game={game} onStart={start} onBack={() => setScreen('menu')} />;
  if (screen === 'play') return <Play key={`${game}-${level}-${result ? 'r' : 'f'}`} game={game} level={level} onComplete={finish} onQuit={() => setScreen('menu')} />;
  if (screen === 'result') return <Result result={result} onAgain={() => start(result.newLevel)} onMenu={() => setScreen('menu')} />;
  return null;
}

function Menu({ onPick, onProgress, onHome }) {
  return (
    <div className="stack">
      <h2 className="section">Brain Games</h2>
      <p className="muted">Pick a game and a level. Play as much as you like.</p>
      <div className="game-grid">
        {GAMES.map((g) => (
          <button key={g} className="game-card" onClick={() => onPick(g)}>
            <span className="game-card__icon"><Icon name={GAME_ICONS[g] || 'brain'} size={28} /></span>
            <span className="game-card__title">{GAME_NAMES[g]}</span>
            <span className="game-card__sub">{GAME_SUB[g]}</span>
          </button>
        ))}
      </div>
      <Button variant="ghost" icon="pulse" onClick={onProgress}>See your progress</Button>
      <Button variant="ghost" icon="home" onClick={onHome}>Back to home</Button>
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
  async function quit() {
    const ok = await ui.confirm({ title: 'Leave this game?', message: 'Your progress in this round will not be saved.', confirmLabel: 'Leave game', cancelLabel: 'Keep playing', danger: true });
    if (ok) onQuit();
  }
  return (
    <div className="stack play">
      <div className="play-head">
        <button className="play-quit" aria-label="Quit this game" onClick={quit}><Icon name="back" size={20} /> Quit</button>
        <span className="play-head__title">{GAME_NAMES[game]} · Level {level}</span>
        <span style={{ width: 64 }} />
      </div>
      {game === 'match_pairs'
        ? <Match level={level} onComplete={onComplete} />
        : <Quiz game={game} level={level} onComplete={onComplete} />}
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
    try { await saveGameResult({ game_type: game, score, max_score: questions.length, difficulty: level, details: { ratio } }); } catch {}
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
    try { await saveGameResult({ game_type: 'match_pairs', score: pairs, max_score: pairs, difficulty: level, duration_seconds: secs, details: { mistakes: mistakes.current } }); } catch {}
    ui.toast(cheer());
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
