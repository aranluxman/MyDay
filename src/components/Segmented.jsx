// Two-or-more option switch for the marketing pages ("For me / For my family",
// "I use MyDay / I'm a caregiver"). A radiogroup: Tab lands on the chosen
// option, arrow keys move the choice, like a native radio set.
export function Segmented({ label, options, value, onChange, className = '' }) {
  function onKey(e) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.value);
    e.currentTarget.parentElement.querySelector(`[data-value="${next.value}"]`)?.focus();
  }
  return (
    <div className={`mkt-seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            data-value={o.value} className={`mkt-seg__opt${on ? ' is-on' : ''}`}
            onClick={() => onChange(o.value)} onKeyDown={onKey}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
