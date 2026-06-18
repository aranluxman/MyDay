// Navigation primitive shared by every screen. Routing is hash-based so the
// device Back button and "Add to Home Screen" both behave like a real app.
export function go(route) {
  if (location.hash === route) {
    // same route: force a re-render
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = route;
  }
}
