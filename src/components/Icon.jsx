// Calm, stroke-based line icons (no emoji). Sized to scale with the UI.
const PATHS = {
  check: 'M5 13l4 4L19 7',
  back: 'M15 19l-7-7 7-7',
  close: 'M6 6l12 12M18 6L6 18',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L18 10l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pill: 'M10.5 13.5l3-3M7 17a4 4 0 010-6l4-4a4 4 0 116 6l-4 4a4 4 0 01-6 0z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-1 5 3 3 0 002 4 3 3 0 005 1 3 3 0 005-1 3 3 0 002-4 3 3 0 00-1-5 3 3 0 00-3-3 3 3 0 00-3-1 3 3 0 00-2 1zM12 4v15',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 21a2 2 0 004 0',
  chevron: 'M9 6l6 6-6 6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  pulse: 'M3 12h4l2 6 4-14 2 8h6',
  sun: 'M12 4v2M12 18v2M4 12H2M22 12h-2M6 6L4.5 4.5M18 6l1.5-1.5M6 18l-1.5 1.5M18 18l1.5 1.5M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  phone: 'M5 4h4l2 5-3 2a12 12 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  pin: 'M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12zM12 9a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  logout: 'M15 12H3M9 6l-6 6 6 6M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  notes: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  building: 'M4 21V5l8-2 8 2v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h6',
  cart: 'M5 6h16l-2 9H7L5 3H2M9 20a1 1 0 100 2 1 1 0 000-2zM17 20a1 1 0 100 2 1 1 0 000-2z',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  star: 'M12 4l2.4 5 5.6.8-4 3.9 1 5.6-5-2.6-5 2.6 1-5.6-4-3.9 5.6-.8z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 100 6 3 3 0 000-6z',
  download: 'M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  share: 'M12 16V4m0 0L8 8m4-4l4 4M6 12H5a1 1 0 00-1 1v6a1 1 0 001 1h14a1 1 0 001-1v-6a1 1 0 00-1-1h-1',
  dots: 'M12 6h.01M12 12h.01M12 18h.01',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
};

export function Icon({ name, size = 24, stroke = 2.1, className = '', style }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
