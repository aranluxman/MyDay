// App root: providers, hash router, app bar, and animated screen transitions.
import { html, useEffect, Fragment } from './react.js';
import { UIProvider, useRoute, navigate, Icon } from './ui.js';
import { syncTimezone } from './db.js';
import { GAME_NAMES } from './gamedata.js';
import { Home } from './home.js';
import { Medications } from './meds.js';
import { Appointments } from './appts.js';
import { Games } from './games.js';
import { Settings } from './settings.js';

const TOP_LEVEL = ['meds', 'appts', 'games', 'settings'];

export function App() {
  useEffect(() => { syncTimezone().catch((e) => console.warn('timezone sync failed', e)); }, []);
  return html`<${UIProvider}><${Shell} /><//>`;
}

function Shell() {
  const { top, sub } = useRoute();
  let screen, title, back = false;
  switch (top) {
    case 'meds': screen = html`<${Medications} />`; title = 'My Medications'; break;
    case 'appts': screen = html`<${Appointments} />`; title = 'My Appointments'; break;
    case 'games':
      back = !!sub;
      title = !sub ? 'Brain Games' : sub === 'progress' ? 'Your Progress' : (GAME_NAMES[sub] || 'Brain Games');
      screen = html`<${Games} sub=${sub} />`;
      break;
    case 'settings': screen = html`<${Settings} />`; title = 'Family & Settings'; break;
    default: screen = html`<${Home} />`; title = 'MyDay'; break;
  }
  const showHome = TOP_LEVEL.includes(top);

  return html`<${Fragment}>
    <${AppBar} title=${title} back=${back} showHome=${showHome} />
    <main class="app"><div class="screen" key=${top + '/' + (sub || '')}>${screen}</div></main>
  <//>`;
}

function AppBar({ title, back, showHome }) {
  return html`<header class="appbar">
    ${back
      ? html`<button class="appbar__btn appbar__btn--left" onClick=${() => history.back()} aria-label="Go back">
          <${Icon} name="back" size=${22} /><span>Back</span></button>`
      : html`<span class="appbar__edge"></span>`}
    <h1 class="appbar__title">${title}</h1>
    ${showHome
      ? html`<button class="appbar__btn appbar__btn--right" onClick=${() => navigate('#/home')} aria-label="Go to home">
          <${Icon} name="home" size=${22} /></button>`
      : html`<span class="appbar__edge"></span>`}
  </header>`;
}
