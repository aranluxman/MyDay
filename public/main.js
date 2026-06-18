// Bootstrap: mount the React app and register the PWA service worker.
import { html, createRoot } from './react.js';
import { App } from './app.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
