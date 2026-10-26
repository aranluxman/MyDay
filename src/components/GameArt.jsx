import { Icon } from './Icon.jsx';

// Small drawn pictures of each game, so the list reads at a glance instead of
// as eleven look-alike icons. Built from letters and shapes in em units: the
// same art works as a list tile and, larger, on the "Today's game" card.
// Purely decorative — the game's name is always written next to it.

const TINT = {
  word_search: 'pink', word_puzzle: 'violet', unscramble: 'blue', odd_one_out: 'pink',
  match_pairs: 'violet', memory_sequence: 'yellow', shopping_recall: 'green', orientation: 'green',
  quick_math: 'peach', number_pattern: 'blue', mini_sudoku: 'red',
};

const Tiles = ({ letters, hot = [], cls = '' }) => letters.split('').map((l, i) => (
  <span key={i} className={`gart__t${hot.includes(i) ? ' is-hot' : ''}${cls}`}>{l}</span>
));

function Picture({ game }) {
  switch (game) {
    case 'word_search':
      return <span className="gart__grid gart__grid--3"><Tiles letters="WORSEACHP" hot={[4, 5]} /></span>;
    case 'word_puzzle':
      return <span className="gart__abc"><Tiles letters="ABC" cls=" gart__t--violet" /></span>;
    case 'unscramble':
      return <span className="gart__row"><Tiles letters="CAT" cls=" gart__t--blue" /></span>;
    case 'odd_one_out':
      return <span className="gart__odd"><i /><i /><i className="is-odd" /></span>;
    case 'match_pairs':
      return <span className="gart__cards"><i /><i /></span>;
    case 'memory_sequence':
      return <span className="gart__dots"><i /><i /><i /></span>;
    case 'quick_math':
      return <span className="gart__calc"><b /><i /><i /><i /><i /><i /><i /></span>;
    case 'number_pattern':
      return <span className="gart__nums"><b>1</b><b>2</b><b>3</b></span>;
    case 'mini_sudoku':
      return <span className="gart__sudoku"><i /><i /><i /><i /></span>;
    case 'orientation':
      return <span className="gart__cal"><b /><span>{new Date().getDate()}</span></span>;
    case 'shopping_recall':
      return <span className="gart__ic"><Icon name="cart" size={30} stroke={2.4} /></span>;
    default:
      return <span className="gart__ic"><Icon name="brain" size={30} stroke={2.4} /></span>;
  }
}

export function GameArt({ game, size = 'sm' }) {
  return (
    <span className={`gart gart--${size} gart--${TINT[game] || 'peach'}`} aria-hidden="true">
      <Picture game={game} />
    </span>
  );
}

// The big picture on the "Today's game" card: a tilted puzzle card.
export function HeroArt({ game }) {
  if (game === 'word_search') {
    return (
      <span className="hart" aria-hidden="true">
        <span className="hart__card">
          <span className="gart__grid gart__grid--5">
            <Tiles letters="HEALTBRAINPEACEHAPPY" hot={[5, 6, 7, 8, 9]} />
          </span>
        </span>
        <span className="hart__pencil" />
      </span>
    );
  }
  return (
    <span className="hart" aria-hidden="true">
      <span className="hart__card hart__card--plain"><GameArt game={game} size="lg" /></span>
    </span>
  );
}
