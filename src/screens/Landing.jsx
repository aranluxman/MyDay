import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { InstallButton } from '../components/InstallButton.jsx';

export default function Landing() {
  const navigate = useNavigate();
  const start = () => navigate('/get-started');
  const signin = () => navigate('/signin');

  return (
    <div className="mkt">
      <header className="mkt-header">
        <div className="mkt-wrap mkt-header__in">
          <div className="mkt-brand"><span className="mkt-brand__mark"><Icon name="pulse" size={22} /></span>MyDay</div>
          <nav className="mkt-nav">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#trust">Trust</a>
          </nav>
          <div className="mkt-head-cta">
            <InstallButton className="mkt-btn mkt-btn--ghost mkt-btn--install" label="Install MyDay" />
            <button className="mkt-btn mkt-btn--ghost" style={{ height: 46 }} onClick={signin}>Sign in</button>
            <button className="mkt-btn mkt-btn--primary" style={{ height: 46 }} onClick={start}>Get started</button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="mkt-hero">
        <div className="mkt-wrap mkt-hero__grid">
          <div>
            <span className="mkt-pill"><Icon name="shield" size={16} /> Trusted by families</span>
            <h1>Never miss a dose. <span className="grad">Stay close to the ones you love.</span></h1>
            <p className="mkt-hero__sub">MyDay keeps medications, appointments, health notes, and brain games in one calm, simple place — and alerts your family if a dose is missed.</p>
            <div className="mkt-hero__cta">
              <button className="mkt-btn mkt-btn--primary mkt-btn--lg" onClick={start}>Get started free <Icon name="chevron" size={20} /></button>
              <button className="mkt-btn mkt-btn--ghost mkt-btn--lg" onClick={signin}>Sign in</button>
            </div>
            <div className="mkt-trustrow">
              <span><Icon name="check" size={18} /> Free to start</span>
              <span><Icon name="check" size={18} /> Private &amp; secure</span>
              <span><Icon name="check" size={18} /> Made for seniors</span>
            </div>
          </div>
          <DashboardPreview />
        </div>
      </section>

      {/* features */}
      <section className="mkt-section mkt-section--tint" id="features">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow">Everything in one place</p>
          <h2 className="mkt-h2">Built around your day</h2>
          <p className="mkt-lede">Simple, large, and clear — designed so it's easy to use every single day.</p>
          <div className="feat-grid">
            <Feature ic="blue" icon="pill" title="Medication reminders" text="Add any medicine or vitamin with its times. Tap one big button when you take it — pending, taken, and missed are tracked for you." />
            <Feature ic="green" icon="calendar" title="Calendar &amp; history" text="A clear month calendar shows exactly which doses were taken, so you can look back over the whole month at a glance." />
            <Feature ic="red" icon="bell" title="Family alerts" text="If a dose isn't taken within an hour, a notification goes to a family member's phone — quietly keeping everyone in the loop." />
            <Feature ic="purple" icon="brain" title="Brain games" text="Match-the-pairs, word puzzles, number patterns, and gentle daily questions — across seven friendly difficulty levels." />
            <Feature ic="orange" icon="notes" title="Health diary" text="Jot down symptoms, health events, and anything worth remembering, all on a simple timeline you can show your doctor." />
            <Feature ic="teal" icon="phone" title="Contacts &amp; profile" text="Keep your pharmacy, doctors, clinic, and insurance in one tap-to-call place, alongside your personal health profile." />
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="mkt-section" id="how">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow">Get going in minutes</p>
          <h2 className="mkt-h2">How it works</h2>
          <div className="steps" style={{ marginTop: 36 }}>
            <Step n="1" title="Create your account" text="Answer a few simple questions and you're in — no complicated setup." />
            <Step n="2" title="Add your medicines" text="Enter each medicine and the times you take it. We'll handle the daily reminders." />
            <Step n="3" title="Relax — we'll remind you" text="Tap Done when you take a dose. If one's missed, your family is gently notified." />
          </div>
        </div>
      </section>

      {/* phone showcase */}
      <section className="mkt-section mkt-section--tint">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow">In your pocket</p>
          <h2 className="mkt-h2">Lovely on your phone, too</h2>
          <p className="mkt-lede">Add MyDay to your home screen and it works just like an app.</p>
          <div className="show-grid">
            <Phone src="/shots/home.png" title="Your day at a glance" sub="Today's medicines &amp; reminders" />
            <Phone src="/shots/calendar.png" title="A clear calendar" sub="See every dose you've taken" />
            <Phone src="/shots/game.png" title="Keep your mind sharp" sub="Games with seven levels" />
          </div>
        </div>
      </section>

      {/* testimonial */}
      <section className="mkt-section">
        <div className="mkt-wrap quote">
          <Icon name="star" size={28} className="" />
          <p>"My dad finally takes his pills on time, and I get a little nudge on my phone if he forgets. It gave our whole family peace of mind."</p>
          <div className="quote__who">— Sarah, daughter &amp; caregiver</div>
        </div>
      </section>

      {/* trust */}
      <section className="mkt-section mkt-section--tint" id="trust">
        <div className="mkt-wrap">
          <div className="trust-grid">
            <Trust ic="blue" icon="clock" title="Here to help" text="Simple, friendly, and made to be used every day — with large text and big buttons." />
            <Trust ic="green" icon="shield" title="Secure &amp; private" text="Your health information is protected and only ever visible to you and those you choose." />
            <Trust ic="pink" icon="pulse" title="Caring by design" text="Built for older adults and the families who look after them." />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mkt-section">
        <div className="mkt-wrap">
          <div className="cta-band">
            <h2>Start taking care of today</h2>
            <p>Create your free account in under a minute.</p>
            <button className="mkt-btn mkt-btn--ghost mkt-btn--lg" onClick={start}>Get started free <Icon name="chevron" size={20} /></button>
          </div>
        </div>
      </section>

      <footer className="mkt-footer">
        <div className="mkt-wrap mkt-footer__in">
          <div className="mkt-brand" style={{ fontSize: 20 }}><span className="mkt-brand__mark" style={{ width: 32, height: 32 }}><Icon name="pulse" size={18} /></span>MyDay</div>
          <span>© {new Date().getFullYear()} MyDay. Made with care.</span>
        </div>
      </footer>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="dash">
      <div className="dash__top">
        <span className="dash__avatar">E</span>
        <div>
          <div className="dash__hi">Good afternoon,</div>
          <div className="dash__name">Eleanor</div>
        </div>
        <span className="dash__order"><Icon name="check" size={16} /> On track</span>
      </div>
      <div className="dash-card">
        <div className="dash-card__h"><span>Today's medicines</span><small>67% of plan completed</small></div>
        <div className="dash-bar"><i /></div>
        <div className="dash-stats">
          <div className="dash-stat"><span className="ic ic--green ic--sm" style={{ margin: '0 auto 6px' }}><Icon name="check" size={16} /></span><b style={{ color: '#16a34a' }}>2</b><span>Taken</span></div>
          <div className="dash-stat"><span className="ic ic--red ic--sm" style={{ margin: '0 auto 6px' }}><Icon name="close" size={16} /></span><b style={{ color: '#dc2626' }}>0</b><span>Missed</span></div>
          <div className="dash-stat"><span className="ic ic--blue ic--sm" style={{ margin: '0 auto 6px' }}><Icon name="pill" size={16} /></span><b style={{ color: '#2563eb' }}>1</b><span>Remaining</span></div>
        </div>
      </div>
      <div className="dash-mini">
        <div className="dash-card">
          <div className="dash-mini__t"><span className="ic ic--blue ic--sm"><Icon name="calendar" size={16} /></span> Next visit</div>
          <p><b>Dr. Patel</b><br />Tue, 10:30 AM</p>
        </div>
        <div className="dash-card">
          <div className="dash-mini__t"><span className="ic ic--purple ic--sm"><Icon name="user" size={16} /></span> Family</div>
          <p>2 people will be<br />alerted if needed</p>
        </div>
      </div>
    </div>
  );
}

function Feature({ ic, icon, title, text }) {
  return (
    <div className="feat">
      <span className={`ic ic--${ic}`}><Icon name={icon} size={26} /></span>
      <h3 dangerouslySetInnerHTML={{ __html: title }} />
      <p dangerouslySetInnerHTML={{ __html: text }} />
    </div>
  );
}
function Step({ n, title, text }) {
  return <div className="step"><div className="step__n">{n}</div><h3>{title}</h3><p>{text}</p></div>;
}
function Phone({ src, title, sub }) {
  return (
    <div>
      <div className="phone"><img src={src} alt={title} loading="lazy" /></div>
      <div className="phone__cap">{title}<span>{sub}</span></div>
    </div>
  );
}
function Trust({ ic, icon, title, text }) {
  return (
    <div className="trust">
      <span className={`ic ic--${ic}`}><Icon name={icon} size={24} /></span>
      <div><h3 dangerouslySetInnerHTML={{ __html: title }} /><p>{text}</p></div>
    </div>
  );
}
