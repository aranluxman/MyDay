// Tiny DOM helpers + shared UI bits. No framework.

// h('button', { class:'btn', onclick: fn }, 'Label', childNode, ...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'hidden') el.hidden = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function mount(...nodes) {
  const app = document.getElementById('app');
  clear(app);
  const screen = h('div', { class: 'screen' }, ...nodes);
  app.appendChild(screen);
  app.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

let bannerTimer;
export function banner(message, kind = 'good', ms = 2600) {
  const b = document.getElementById('banner');
  b.textContent = message;
  b.className = 'banner' + (kind === 'info' ? ' banner--info' : kind === 'bad' ? ' banner--bad' : '');
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

// A short, varied bit of encouragement (no emojis, calm tone).
const CHEERS = ['Great job!', 'Well done!', 'Nicely done!', 'You got it!', "That's right!", 'Excellent!'];
export function cheer() {
  return CHEERS[Math.floor(Math.random() * CHEERS.length)];
}

// Simple confirm wrapper (kept large + readable via native dialog).
export function confirmAction(message) {
  return window.confirm(message);
}
