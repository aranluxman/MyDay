import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, Avatar } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { todaysDoses, upcomingAppointments, playedTodayCount, markDoseTaken } from '../lib/db.js';
import { prettyTime, prettyDate, localDateStr } from '../lib/format.js';
import { profileCompleteness } from '../lib/appearance.js';

export default function Home() {
  const { profile } = useApp();
  const ui = useUI();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(async () => {
    const [doses, appts, games] = await Promise.all([todaysDoses(), upcomingAppointments(), playedTodayCount()]);
    return { doses, appts, games };
  });

  if (loading) return <Spinner label="Loading your day..." />;
  if (error) return <Card className="center"><p className="lead">We could not load your information.</p><Button onClick={reload}>Try again</Button></Card>;

  const { doses, appts, games } = data;
  const taken = doses.filter((d) => d.status === 'taken').length;
  const missed = doses.filter((d) => d.status === 'missed').length;
  const pending = doses.filter((d) => d.status === 'pending').length;
  const total = doses.length;
  const now = Date.now();
  const dueNow = doses.filter((d) => d.status === 'pending' && new Date(d.due_at).getTime() <= now)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];
  const pct = total ? Math.round((taken / total) * 100) : 0;
  const firstName = (profile?.full_name || 'there').split(' ')[0];
  const greeting = greetingFor();

  async function done(id) {
    try { await markDoseTaken(id); ui.toast('Great - marked as taken.'); reload(); }
    catch { ui.toast('Could not save. Please try again.', 'bad'); }
  }

  return (
    <div className="stack">
      <div className="hello">
        <div>
          <p className="hello__greet">{greeting},</p>
          <h2 className="hello__name">{firstName}</h2>
          <p className="hello__date">{prettyDate(localDateStr())}</p>
        </div>
        <button className="hello__avatar" onClick={() => navigate('/profile')} aria-label="Profile">
          <Avatar name={profile?.full_name} color={profile?.avatar_color} size={52} src={profile?.avatar_url} />
        </button>
      </div>

      {profileCompleteness(profile).pct < 100 && (
        <Card className="nudge" onClick={() => navigate('/profile')}>
          <Icon name="user" size={26} />
          <span>Your profile is {profileCompleteness(profile).pct}% complete — tap to finish it.</span>
          <Icon name="chevron" size={24} />
        </Card>
      )}

      {dueNow && (
        <Card accent="due" className="reminder">
          <div className="reminder__kicker">Time for your {prettyTime(dueNow.scheduled_time)} medicine</div>
          <div className="reminder__name">{dueNow.medication?.name}{dueNow.medication?.dose ? ` - ${dueNow.medication.dose}` : ''}</div>
          {dueNow.medication?.note && <div className="reminder__note">{dueNow.medication.note}</div>}
          <Button variant="good" size="lg" icon="check" onClick={() => done(dueNow.id)}>Done - I took it</Button>
        </Card>
      )}

      <Card className="status">
        <div className="status__head">
          <span>Today's medicines</span>
          <span className="status__count">{taken} of {total} taken</span>
        </div>
        <div className="bar"><div className="bar__fill" style={{ width: `${pct}%` }} /></div>
        <div className="status__row">
          <Stat kind="taken" n={taken} label="Taken" />
          <Stat kind="missed" n={missed} label="Missed" />
          <Stat kind="pending" n={pending} label="To take" />
        </div>
      </Card>

      <div className="quick-grid">
        <QuickCard icon="pill" title="Medicines" sub={pending ? `${pending} to take` : total ? 'All done today' : 'Add your medicines'} onClick={() => navigate('/medication')} />
        <QuickCard icon="calendar" title="Appointments" sub={appts.length ? `Next ${prettyDate(appts[0].appt_date)}` : 'None upcoming'} onClick={() => navigate('/appointments')} />
        <QuickCard icon="pulse" title="Health notes" sub="Symptoms & events" onClick={() => navigate('/updates')} />
        <QuickCard icon="brain" title="Brain Games" sub={games ? 'Play anytime' : 'A good time to play'} onClick={() => navigate('/games')} accent />
      </div>

      {games === 0 && (
        <Card className="nudge" onClick={() => navigate('/games')}>
          <Icon name="brain" size={28} />
          <span>You have not played a brain game today. A quick game keeps the mind sharp.</span>
          <Icon name="chevron" size={24} />
        </Card>
      )}
    </div>
  );
}

function Stat({ kind, n, label }) {
  return <div className={`stat stat--${kind}`}><div className="stat__num">{n}</div><div className="stat__label">{label}</div></div>;
}
function QuickCard({ icon, title, sub, onClick, accent }) {
  return (
    <button className={`quick${accent ? ' quick--accent' : ''}`} onClick={onClick}>
      <span className="quick__icon"><Icon name={icon} size={26} /></span>
      <span className="quick__title">{title}</span>
      <span className="quick__sub">{sub}</span>
    </button>
  );
}
function greetingFor() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
