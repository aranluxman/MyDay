// React (build-less) setup. Every module imports React/hooks/html from HERE so
// there is exactly one React instance across the app. htm gives us JSX-like
// templating with tagged template literals - no build step, deploys as plain HTML.
import React from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1';
import htm from 'https://esm.sh/htm@3.1.1';

// Normalize HTML-friendly attributes so templates can use `class` and string
// `style` (React itself only accepts className + a style object).
function styleStringToObject(str) {
  const out = {};
  for (const decl of str.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const key = decl.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = decl.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}
function h(type, props, ...children) {
  if (props) {
    if (props.class != null && props.className == null) props.className = props.class;
    if ('class' in props) delete props.class;
    if (props.for != null && props.htmlFor == null) { props.htmlFor = props.for; delete props.for; }
    if (typeof props.style === 'string') props.style = styleStringToObject(props.style);
  }
  return React.createElement(type, props, ...children);
}

export const html = htm.bind(h);
export const {
  useState, useEffect, useRef, useMemo, useCallback,
  useContext, createContext, Fragment,
} = React;
export { React, createRoot };
