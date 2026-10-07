import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { initLanguage } from './lib/translate.js';
import './index.css';
import './marketing.css';
import './glass.css';
import './phone.css';

initLanguage();

// The visible height of the page, which shrinks when the on-screen keyboard
// opens (iOS Safari does not resize the layout viewport). Sheets use it so
// their footer stays above the keyboard.
// Text size is applied as CSS zoom on <html>, so the height is divided by it.
if (window.visualViewport) {
  const root = document.documentElement;
  const setVvh = () => {
    const zoom = parseFloat(getComputedStyle(root).zoom) || 1;
    root.style.setProperty('--vvh', `${window.visualViewport.height / zoom}px`);
  };
  setVvh();
  window.visualViewport.addEventListener('resize', setVvh);
  new MutationObserver(setVvh).observe(root, { attributes: true, attributeFilter: ['data-text'] });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
