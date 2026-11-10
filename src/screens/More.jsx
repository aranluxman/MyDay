import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';

// Everything that is not one of the four everyday tabs, as one plain list.
// Only pages that exist are listed: nothing here leads to a dead end.
const LINKS = [
  { to: '/contacts', icon: 'users', title: 'Contacts', desc: 'Family and medical team' },
  { to: '/games', icon: 'brain', title: 'Games', desc: 'A little time for you' },
  { to: '/profile?section=guardians', icon: 'shield', title: 'Care team', desc: 'Guardians and people you support' },
  { to: '/profile', icon: 'gear', title: 'Settings', desc: 'Profile, alerts and accessibility' },
  { to: '/profile?section=howto', icon: 'help', title: 'How to use MyDay', desc: 'A step-by-step guide' },
];

export default function More() {
  const navigate = useNavigate();
  return (
    <div className="stack more-page">
      <p className="page-intro">Explore MyDay</p>
      <ul className="rd-list" aria-label="More pages">
        {LINKS.map((l) => (
          <li key={l.to}>
            <button type="button" className="rd-row" onClick={() => navigate(l.to)}>
              <span className="rd-row__ic" aria-hidden="true"><Icon name={l.icon} size={24} /></span>
              <span className="rd-row__main">
                <span className="rd-row__t">{l.title}</span>
                <span className="rd-row__d">{l.desc}</span>
              </span>
              <Icon name="chevron" size={22} className="rd-row__chev" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
