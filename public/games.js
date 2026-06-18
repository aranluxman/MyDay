// Brain Games (React): match-the-pairs, word puzzle, number patterns, and
// orientation prompts. Adaptive difficulty, gentle encouragement, saved scores.
import { html, useState, useMemo, useRef } from './react.js';
import { Button, Card, Icon, Spinner, useUI, useAsync, navigate } from './ui.js';
import { saveGameResult, recentResults } from './db.js';
import {
  GAME_NAMES, GAME_SUB, resolveLevel, adapt,
  buildWordQuestions, buildNumberQuestions, buildOrientationQuestions, buildMatchDeck,
} from './gamedata.js';

const BUILDERS = {
  word_puzzle: buildWordQuestions,
  number_pattern: buildNumberQuestions,
  orientation: buildOrientationQuestions,
};
const CHEERS = ['Great job!', 'Well done!', 'Nicely done!', 'You got it!', "That's right!", 'Excellent!'];
const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];

export function Games({ sub }) {
  if (!sub) return html`<${GamesMenu} />`;
  if (sub === 'progress') return html`<${Progress} />`;
  return html`<${GameRunner} type=${sub} />`;
}

// ---------------------------------------------------------------- menu
function GamesMenu() {
  return html`<div class="stack">
    <h2 class="section">Brain Games</h2>
    <p class="lead">Pick a game. You can play as much as you like.</p>
    <nav class="menu">
      ${['match_pairs', 'word_puzzle', 'number_pattern', 'orientation'].map((t) => html`
        <button key=${t} class="menu__btn" onClick=${() => navigate('#/games/' + t)}>
          <span class="menu__icon"><${Icon} name="brain" size=${28} /></span>
          <span class="menu__text"><span class="menu__title">${GAME_NAMES[t]}</span>
            <span class="menu__sub">${GAME_SUB[t]}</span></span>
          <span class="menu__chev"><${Icon} name="chevron" size=${26} /></span>
        </button>`)}
    </nav>
    <${Button} variant="ghost" onClick=${() => navigate('#/games/progress')}>See your progress<//>
  </div>`;
}

// ---------------------------------------------------------------- runner (resolves level, owns result screen)
function GameRunner({ type }) {
  const [round, setRound] = useState(0);
  return html`<${GameOnce} key=${round} type=${type} onAgain=${() => setRound((r) => r + 1)} />`;
}

function GameOnce({ type, onAgain }) {
  const { data: level, loading } = useAsync(() => resolveLevel(type), [type]);
  const [result, setResult] = useState(null);
  if (loading || level == null) return html`<${Spinner} label="Getting ready..." />`;
  if (result) return html`<${ResultScreen} result=${result} onAgain=${onAgain} />`;
  if (type === 'match_pairs') return html`<${Match} level=${level} onComplete=${setResult} />`;
  return html`<${Quiz} type=${type} level=${level} onComplete=${setResult} />`;
}

// ---------------------------------------------------------------- quiz (word / number / orientation)
function Quiz({ type, level, onComplete }) {
  const questions = useMemo(() => BUILDERS[type](level), [type, level]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const correctRef = useRef(0);
  const ui = useUI();
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
    const newLevel = adapt(type, level, ratio);
    try { await saveGameResult({ game_type: type, score, max_score: questions.length, difficulty: level, details: { ratio } }); } catch {}
    onComplete({ type, score, max: questions.length, ratio, newLevel, oldLevel: level });
  }
  const feedback = answered
    ? (picked === q.answer ? (q.confirmRight || "That's right.") : (q.confirmWrong || `The answer is ${q.answer}.`))
    : null;

  return html`<div class="stack">
    <p class="game-progress">Question ${idx + 1} of ${questions.length}</p>
    ${q.lead ? html`<p class="lead center">${q.lead}</p>` : null}
    ${q.big ? html`<div class="big-number">${q.big}</div>` : null}
    ${q.prompt ? html`<p class="prompt-q">${q.prompt}</p>` : null}
    <div class="choice-grid">
      ${q.options.map((opt) => {
        let cls = 'choice';
        if (answered && opt === q.answer) cls += ' choice--right';
        else if (answered && opt === picked) cls += ' choice--wrong';
        return html`<button key=${opt} class=${cls} disabled=${answered} onClick=${() => choose(opt)}>${opt}</button>`;
      })}
    </div>
    ${answered ? html`<p class=${'feedback ' + (picked === q.answer ? 'feedback--good' : 'feedback--bad')}>${feedback}</p>` : null}
    ${answered ? html`<${Button} onClick=${next}>${idx < questions.length - 1 ? 'Next question' : 'See result'}<//>` : null}
  </div>`;
}

// ---------------------------------------------------------------- match the pairs
function Match({ level, onComplete }) {
  const { pairs, deck } = useMemo(() => buildMatchDeck(level), [level]);
  const [faces, setFaces] = useState(() => deck.map(() => 'down'));
  const firstRef = useRef(null);
  const lockRef = useRef(false);
  const matchedRef = useRef(0);
  const mistakesRef = useRef(0);
  const startRef = useRef(Date.now());
  const ui = useUI();

  function flip(i) {
    if (lockRef.current || faces[i] !== 'down' || firstRef.current === i) return;
    setFaces((f) => f.map((v, j) => (j === i ? 'up' : v)));
    if (firstRef.current == null) { firstRef.current = i; return; }
    const a = firstRef.current; firstRef.current = null;
    if (deck[a] === deck[i]) {
      matchedRef.current++;
      setFaces((f) => f.map((v, j) => (j === a || j === i ? 'matched' : v)));
      if (matchedRef.current === pairs) finish();
    } else {
      mistakesRef.current++; lockRef.current = true;
      setTimeout(() => {
        setFaces((f) => f.map((v, j) => (j === a || j === i ? 'down' : v)));
        lockRef.current = false;
      }, 850);
    }
  }
  async function finish() {
    const secs = Math.round((Date.now() - startRef.current) / 1000);
    const mistakes = mistakesRef.current;
    const ratio = pairs / (pairs + mistakes);
    const newLevel = adapt('match_pairs', level, ratio >= 0.7 ? 0.9 : ratio < 0.5 ? 0.3 : 0.6);
    try { await saveGameResult({ game_type: 'match_pairs', score: pairs, max_score: pairs, difficulty: level, duration_seconds: secs, details: { mistakes } }); } catch {}
    ui.toast(cheer());
    setTimeout(() => onComplete({ type: 'match_pairs', score: pairs, max: pairs, ratio, newLevel, oldLevel: level, mistakes }), 400);
  }

  return html`<div class="stack">
    <p class="game-progress">Find all ${pairs} matching pairs</p>
    <div class=${'cards-grid cards-grid--' + (deck.length > 12 ? 4 : 4)}>
      ${deck.map((word, i) => html`<button key=${i} class="flip" data-face=${faces[i]}
        disabled=${faces[i] === 'matched'} aria-label=${faces[i] === 'down' ? 'Hidden card' : word}
        onClick=${() => flip(i)}>${faces[i] === 'down' ? '?' : word}</button>`)}
    </div>
    <p class="muted center">Tap two cards to see if they match.</p>
  </div>`;
}

// ---------------------------------------------------------------- result
function ResultScreen({ result, onAgain }) {
  const { type, score, max, ratio, newLevel, oldLevel } = result;
  const good = ratio >= 0.6;
  let levelNote = null;
  if (type !== 'orientation') {
    if (newLevel > oldLevel) levelNote = 'You did well - the next round will be a little harder.';
    else if (newLevel < oldLevel) levelNote = 'The next round will be a little easier.';
  }
  const line = type === 'match_pairs' ? `You found all ${max} pairs!` : `You got ${score} out of ${max}.`;
  return html`<div class="stack center result">
    <div class=${'result__badge ' + (good ? 'result__badge--good' : '')}><${Icon} name="check" size=${44} /></div>
    <h2 class="section">${good ? cheer() : 'Nice effort.'}</h2>
    <p class="prompt-q">${line}</p>
    ${levelNote ? html`<p class="muted">${levelNote}</p>` : null}
    <${Button} size="lg" onClick=${onAgain}>Play again<//>
    <${Button} variant="ghost" onClick=${() => navigate('#/games')}>Back to games<//>
  </div>`;
}

// ---------------------------------------------------------------- progress
function Progress() {
  const { data, loading, error, reload } = useAsync(() => recentResults(40));
  if (loading) return html`<${Spinner} label="Loading your progress..." />`;
  if (error) return html`<${Card} className="center"><p class="lead">Could not load progress.</p><${Button} onClick=${reload}>Try again<//><//>`;
  if (!data.length) return html`<div class="stack">
    <h2 class="section">Your Progress</h2>
    <p class="empty">No games played yet. Play a game to start tracking.</p>
    <${Button} variant="ghost" onClick=${() => navigate('#/games')}>Back to games<//>
  </div>`;

  const byType = {};
  for (const r of data) (byType[r.game_type] ||= []).push(r);
  const recent = data.slice(0, 14).reverse();

  return html`<div class="stack">
    <h2 class="section">Your Progress</h2>
    <p class="lead">Recent games (left is older):</p>
    <div class="trend">
      ${recent.map((r, i) => {
        const pct = r.max_score ? Math.round((100 * r.score) / r.max_score) : 50;
        return html`<div key=${i} class="trend__col" style=${{ height: Math.max(8, pct) + '%' }}
          title=${`${GAME_NAMES[r.game_type] || r.game_type}: ${r.score}/${r.max_score ?? '?'}`}></div>`;
      })}
    </div>
    <div class="divider"></div>
    ${Object.entries(byType).map(([type, rows]) => {
      const plays = rows.length;
      const avg = Math.round((100 * rows.reduce((s, r) => s + (r.max_score ? r.score / r.max_score : 0), 0)) / plays);
      return html`<${Card} key=${type}>
        <div class="card__title">${GAME_NAMES[type] || type}</div>
        <div class="card__meta">${plays} game${plays > 1 ? 's' : ''} - about ${avg}% correct</div>
      <//>`;
    })}
    <${Button} variant="ghost" onClick=${() => navigate('#/games')}>Back to games<//>
  </div>`;
}
