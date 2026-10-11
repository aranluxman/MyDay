import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { InstallButton } from '../components/InstallButton.jsx';
import { Segmented } from '../components/Segmented.jsx';

// Shown in the trust section and the footer. Reminders are a memory aid;
// the prescription label and the pharmacist stay in charge.
const DISCLAIMER = "MyDay helps you remember — it doesn't replace advice from your doctor or pharmacist. Always follow your prescription label.";

export default function Landing() {
  const navigate = useNavigate();
  const start = () => navigate('/get-started');
  const signin = () => navigate('/signin');
  const guardian = () => navigate('/guardian');
  const forParent = () => navigate('/get-started?for=other');
  // The person researching MyDay is often the adult child, not the senior, so
  // the hero speaks to whichever one is reading.
  const [audience, setAudience] = useState('me');
  const family = audience === 'family';

  // Sections glide in as they scroll into view. Without IntersectionObserver
  // (or with motion turned off in CSS) everything is simply shown.
  useEffect(() => {
    const els = document.querySelectorAll('.mkt [data-reveal]');
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return undefined; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="mkt">
      <header className="mkt-header">
        <div className="mkt-wrap mkt-header__in">
          <div className="mkt-brand"><span className="mkt-brand__mark"><Icon name="pulse" size={22} /></span>MyDay</div>
          <nav className="mkt-nav">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#families">For families</a>
            <a href="#trust">Privacy</a>
          </nav>
          {/* One primary action; signing in is a quiet text link beside it. */}
          <div className="mkt-head-cta">
            <button className="mkt-btn mkt-btn--link mkt-head-signin" onClick={signin}>Sign in</button>
            <button className="mkt-btn mkt-btn--primary" style={{ height: 46 }} onClick={start}>Get started free</button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="mkt-hero">
        <div className="mkt-wrap mkt-hero__grid">
          <div>
            <Segmented label="Who is MyDay for?" value={audience} onChange={setAudience} className="mkt-seg--hero"
              options={[{ value: 'me', label: 'For me' }, { value: 'family', label: 'For my family' }]} />
            {family ? (
              <>
                <h1>Know Mom or Dad took their pills. <span className="grad">Without calling to check.</span></h1>
                <p className="mkt-hero__sub">Set MyDay up on your parent's phone. Family alerts follow each guardian's saved delay or check-in time. Set up notifications on your device to receive them.</p>
                <div className="mkt-hero__cta">
                  <button className="mkt-btn mkt-btn--primary mkt-btn--lg" onClick={forParent}>Set up for a parent <Icon name="chevron" size={20} /></button>
                  <button className="mkt-btn mkt-btn--ghost mkt-btn--lg" onClick={guardian}>I have a guardian code</button>
                </div>
              </>
            ) : (
              <>
                <h1>Never miss a dose. <span className="grad">Stay close to the ones you love.</span></h1>
                <p className="mkt-hero__sub">Your medicines, appointments, and a few minutes of brain games — one calm daily routine. Connected guardians can receive alerts about untaken doses when notifications are set up.</p>
                <div className="mkt-hero__cta">
                  <button className="mkt-btn mkt-btn--primary mkt-btn--lg" onClick={start}>Get started free <Icon name="chevron" size={20} /></button>
                </div>
                <button className="mkt-helper" onClick={guardian}>
                  <span className="mkt-helper__ic"><Icon name="bell" size={20} /></span>
                  <span className="mkt-helper__main">
                    <b>I'm a guardian and I have a code</b>
                    <small>Connect to a family member and get their missed-dose alerts.</small>
                  </span>
                  <Icon name="chevron" size={20} />
                </button>
              </>
            )}
            <div className="mkt-trustrow">
              <span><Icon name="check" size={18} /> Free to start</span>
              <span><Icon name="check" size={18} /> Encrypted &amp; private</span>
              <span><Icon name="check" size={18} /> Made for seniors</span>
            </div>
          </div>
          <DashboardPreview />
        </div>
      </section>

      {/* features */}
      <section className="mkt-section mkt-section--tint" id="features">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow" data-reveal>Everything in one place</p>
          <h2 className="mkt-h2" data-reveal>Built around your day</h2>
          <p className="mkt-lede" data-reveal>Simple, large, and clear — designed so it's easy to use every single day.</p>
          <div className="feat-grid">
            <Feature i={0} ic="blue" icon="pill" title="Medication reminders" text="Add any medicine or vitamin with its times. Tap one big button when you take it — pending, taken, and missed are tracked for you." />
            <Feature i={1} ic="red" icon="bell" title="Family alerts" text="MyDay can send alerts about untaken doses at each guardian's chosen delay or check-in time. Device permissions and notification settings affect receipt." />
            <Feature i={2} ic="green" icon="calendar" title="Calendar &amp; history" text="A clear month calendar shows exactly which doses were taken, so you can look back over the whole month at a glance." />
            <Feature i={0} ic="purple" icon="brain" title="Keep your mind sharp" text="A few minutes of gentle games fit right into your daily check-in, next to your morning pills — word puzzles, pairs, and number patterns at seven friendly levels." />
            <Feature i={1} ic="orange" icon="notes" title="Health diary" text="Jot down symptoms, health events, and anything worth remembering, all on a simple timeline you can show your doctor." />
            <Feature i={2} ic="teal" icon="phone" title="Contacts &amp; profile" text="Keep your pharmacy, doctors, clinic, and insurance in one tap-to-call place, alongside your personal health profile." />
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="mkt-section" id="how">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow" data-reveal>Get going in minutes</p>
          <h2 className="mkt-h2" data-reveal>How it works</h2>
          <div className="steps" style={{ marginTop: 36 }}>
            <Step i={0} n="1" title="Create your account" text="Answer a few simple questions and you're in — no complicated setup." />
            <Step i={1} n="2" title="Add your medicines" text="Enter each medicine and the times you take it. We'll handle the daily reminders." />
            <Step i={2} n="3" title="Relax — we'll remind you" text="Tap Done when you take a dose. Connected guardians can receive alerts at their saved timing when notifications are enabled." />
          </div>
        </div>
      </section>

      {/* for families */}
      <section className="mkt-section mkt-section--tint" id="families">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow" data-reveal>For families &amp; caregivers</p>
          <h2 className="mkt-h2" data-reveal>Peace of mind from anywhere</h2>
          <p className="mkt-lede" data-reveal>You don't need to live nearby or call every morning. MyDay tells you when something needs your attention — and stays quiet when it doesn't.</p>
          <div className="steps">
            <Step i={0} n="1" title="They get MyDay" text="Create their account on their phone — or set it up together. It takes a few minutes." />
            <Step i={1} n="2" title="They invite you" text="In their Profile, they tap Invite a guardian. Their phone shows a 6-digit code." />
            <Step i={2} n="3" title="You get alerts" text="Type the code on your phone, choose your alert timing, and set up notifications. Check a test alert on your device." />
          </div>
          <div className="quote quote--inline" data-reveal>
            <Icon name="star" size={28} />
            <p>"My dad finally takes his pills on time, and I get a little nudge on my phone if he forgets. It gave our whole family peace of mind."</p>
            <div className="quote__who">— Sarah, daughter &amp; caregiver</div>
          </div>
          <div className="mkt-center-cta" data-reveal>
            <button className="mkt-btn mkt-btn--primary mkt-btn--lg" onClick={forParent}>Set up for a parent <Icon name="chevron" size={20} /></button>
            <button className="mkt-btn mkt-btn--ghost mkt-btn--lg" onClick={guardian}>I have a guardian code</button>
          </div>
        </div>
      </section>

      {/* phone showcase */}
      <section className="mkt-section">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow" data-reveal>In your pocket</p>
          <h2 className="mkt-h2" data-reveal>Lovely on your phone, too</h2>
          <p className="mkt-lede" data-reveal>Add MyDay to your home screen and it works just like an app.</p>
          <div className="mkt-center-cta mkt-center-cta--tight" data-reveal>
            <InstallButton className="mkt-btn mkt-btn--ghost mkt-btn--install" label="Add MyDay to your phone" />
          </div>
          <div className="show-grid">
            <Phone i={0} src="/shots/home.png" title="Your day at a glance" sub="Today's medicines &amp; reminders" />
            <Phone i={1} src="/shots/calendar.png" title="A clear calendar" sub="See every dose you've taken" />
            <Phone i={2} src="/shots/game.png" title="Keep your mind sharp" sub="Part of your daily routine" />
          </div>
        </div>
      </section>

      {/* trust */}
      <section className="mkt-section mkt-section--tint" id="trust">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow" data-reveal>Privacy &amp; safety</p>
          <h2 className="mkt-h2" data-reveal>Your health information stays yours</h2>
          <div className="trust-grid trust-grid--4">
            <Trust i={0} ic="green" icon="shield" title="Encrypted" text="Protected with HTTPS/TLS on the way to our servers and AES-256 encryption once it's stored." />
            <Trust i={1} ic="blue" icon="user" title="Only who you choose" text="Access rules on every record mean only you — and the guardians you invite — can see your information." />
            <Trust i={2} ic="pink" icon="heart" title="We never sell your data" text="No ads, no data brokers. Your health information is never sold or shared for marketing." />
            <Trust i={3} ic="orange" icon="clock" title="Easy every day" text="Large text, big buttons, and simple screens — made for older adults and the families who help them." />
          </div>
          <p className="mkt-disclaimer" data-reveal><Icon name="info" size={18} /> {DISCLAIMER}</p>
        </div>
      </section>

      {/* CTA */}
      <section className="mkt-section">
        <div className="mkt-wrap">
          <div className="cta-band" data-reveal>
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
        <p className="mkt-wrap mkt-footer__note">{DISCLAIMER}</p>
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

function Feature({ ic, icon, title, text, i }) {
  return (
    <div className="feat" data-reveal style={{ '--i': i }}>
      <span className={`ic ic--${ic}`}><Icon name={icon} size={26} /></span>
      <h3 dangerouslySetInnerHTML={{ __html: title }} />
      <p dangerouslySetInnerHTML={{ __html: text }} />
    </div>
  );
}
function Step({ n, title, text, i }) {
  return <div className="step" data-reveal style={{ '--i': i }}><div className="step__n">{n}</div><h3>{title}</h3><p>{text}</p></div>;
}
function Phone({ src, title, sub, i }) {
  return (
    <div data-reveal style={{ '--i': i }}>
      <div className="phone"><img src={src} alt={title} loading="lazy" /></div>
      <div className="phone__cap">{title}<span>{sub}</span></div>
    </div>
  );
}
function Trust({ ic, icon, title, text, i }) {
  return (
    <div className="trust" data-reveal style={{ '--i': i }}>
      <span className={`ic ic--${ic}`}><Icon name={icon} size={24} /></span>
      <div><h3 dangerouslySetInnerHTML={{ __html: title }} /><p>{text}</p></div>
    </div>
  );
}
