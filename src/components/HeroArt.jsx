// The calm picture in the greeting: a sun over rolling hills and two trees,
// drawn in the theme's own colours. Decorative only.
export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 360 150" aria-hidden="true" preserveAspectRatio="xMaxYMax meet">
      <g className="hero-art__rays">
        {[...Array(9)].map((_, i) => {
          const a = (Math.PI * (i + 0.5)) / 9 + Math.PI;
          return <line key={i} x1={250 + Math.cos(a) * 40} y1={66 + Math.sin(a) * 40} x2={250 + Math.cos(a) * 54} y2={66 + Math.sin(a) * 54} />;
        })}
      </g>
      <circle cx="250" cy="66" r="30" className="hero-art__sun" />
      <path d="M0 150 C 70 95, 150 92, 220 112 S 330 96, 360 84 V150 Z" className="hero-art__far" />
      <path d="M40 150 C 120 112, 210 118, 280 128 S 350 118, 360 116 V150 Z" className="hero-art__near" />
      <g className="hero-art__tree"><circle cx="150" cy="92" r="17" /><rect x="147" y="104" width="6" height="20" rx="2" /></g>
      <g className="hero-art__tree"><circle cx="182" cy="104" r="11" /><rect x="180" y="112" width="4" height="14" rx="2" /></g>
    </svg>
  );
}

