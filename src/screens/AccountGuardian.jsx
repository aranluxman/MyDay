import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, SkeletonCard, Avatar } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { addAccountGuardianDevice, clearAccountGuardianToken, getAccountGuardianToken, listAccountGuardians, linkAccountWithCode, unlinkAccountGuardian, fetchAccountDashboard } from '../lib/guardianAccount.js';
import { summarisePerson, needsCheckIn } from '../lib/caregiver.js';
import { prettyClock, prettyTime } from '../lib/format.js';
import { CodeEntry, Dashboard } from './Guardian.jsx';

// Caregiver mode: a separate, clearly marked place for someone who supports
// other people. It shows only the people who invited this account, and it is
// VIEW-ONLY: there is no way here to record a dose, change a medicine or edit
// an appointment, because the server gives a guardian no write access at all
// (see supabase/functions/_shared/guardianAccess.js). Nothing is hidden behind
// a missing button: the controls do not exist.
//
// Every number is "what MyDay has on record, as of the last sync". A record
// that is missing is called "not recorded", never "missed" or "not taken".
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'people', label: 'People', icon: 'users' },
  { id: 'alerts', label: 'Alerts', icon: 'bell' },
  { id: 'more', label: 'More', icon: 'more' },
];
const COLORS = ['#175c43', '#2563a8', '#a1520e', '#b3376c', '#6d3fd1', '#0f8f86'];
const colorFor = (name = '') => COLORS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % COLORS.length];

export default function AccountGuardian() {
  const { profile, user } = useApp();
  const ui = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState(location.state?.linkId || null);
  const [tab, setTab] = useState('overview');
  const [name, setName] = useState(profile?.full_name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const links = useAsync(() => listAccountGuardians(), []);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const online = useOnline();

  const localLink = useCallback((link) => (
    link.device_ids?.find((id) => getAccountGuardianToken(user?.id, id)) || link.id
  ), [user?.id]);

  useEffect(() => { document.title = 'Caregiver dashboard · MyDay'; }, []);
  useEffect(() => {
    if (!selected || !links.data?.length) return;
    const link = links.data.find((item) => item.id === selected || item.device_ids?.includes(selected));
    if (link) {
      const local = localLink(link);
      if (local !== selected) setSelected(local);
    }
  }, [selected, links.data, localLink]);

  // One read-only dashboard per person, fetched through the same server
  // function as the detailed view. A failure is kept as a failure: the card
  // says it could not update rather than showing old or empty numbers.
  const [people, setPeople] = useState({});
  const loadPeople = useCallback(async () => {
    const list = links.data || [];
    if (!list.length) { setPeople({}); return; }
    setPeople((prev) => Object.fromEntries(list.map((l) => [l.id, { ...(prev[l.id] || {}), loading: true }])));
    await Promise.all(list.map(async (l) => {
      try {
        const res = await fetchAccountDashboard(localLink(l));
        setPeople((prev) => ({ ...prev, [l.id]: { loading: false, data: res.data, at: res.at, error: null } }));
      } catch (e) {
        setPeople((prev) => ({ ...prev, [l.id]: { loading: false, data: null, at: prev[l.id]?.at || null, error: e.message || 'Could not update.' } }));
      }
    }));
  }, [links.data, localLink]);
  useEffect(() => { loadPeople(); }, [loadPeople]);

  async function setupThisDevice() {
    setDeviceBusy(true);
    try {
      const id = await addAccountGuardianDevice(selected);
      setSelected(id);
      links.reload();
    } catch (e) { ui.toast(e.message || 'Could not set up alerts on this device.', 'bad'); }
    finally { setDeviceBusy(false); }
  }

  const backToList = useCallback(() => { setSelected(null); links.reload(); window.scrollTo(0, 0); }, [links.reload]);

  async function submit(code) {
    setError('');
    if (!name.trim()) { setError('Enter the name this person will see.'); return; }
    setBusy(true);
    try {
      const linked = await linkAccountWithCode(code, name);
      links.reload();
      setSelected(linked.id);
    } catch (e) {
      setError(e.message || 'Could not connect. Please try again.');
    } finally { setBusy(false); }
  }

  async function stopWatching(link) {
    const ok = await ui.confirm({
      title: `Stop supporting ${link.name}?`,
      message: 'You will no longer see their medicine records or get alerts about them. They can invite you again later.',
      confirmLabel: 'Disconnect', danger: true,
    });
    if (!ok) return;
    try {
      await unlinkAccountGuardian(link.id);
      link.device_ids?.forEach((id) => clearAccountGuardianToken(user?.id, id));
      links.reload();
      ui.toast(`Disconnected from ${link.name}.`, 'info');
    }
    catch (e) { ui.toast(e.message || 'Could not disconnect.', 'bad'); }
  }

  const list = links.data || [];
  const summaries = useMemo(() => list.map((l) => ({ link: l, state: people[l.id] || { loading: true }, sum: summarisePerson(people[l.id]?.data) })), [list, people]);
  const attention = summaries.filter((s) => needsCheckIn(s.sum));

  // ---------- one person's day ----------
  if (selected) {
    const token = getAccountGuardianToken(user?.id, selected);
    const link = list.find((item) => item.id === selected || item.device_ids?.includes(selected));
    return (
      <div className="cg cg--person">
        <div className="cg-viewing" role="status">
          <button type="button" className="cg-viewing__back" onClick={backToList}><Icon name="back" size={20} stroke={2.4} /> <span>Dashboard</span></button>
          <div className="cg-viewing__who">
            <Avatar name={link?.name} color={colorFor(link?.name)} size={40} />
            <span className="cg-viewing__main">
              <span className="cg-viewing__name">Viewing <span translate="no">{link?.name || 'this person'}</span></span>
              <span className="cg-chip"><Icon name="eye" size={15} stroke={2.4} /> View-only</span>
            </span>
          </div>
        </div>
        {!token && <Card className="g-account-device">
          <p>Set up alerts on this device to be told when no dose has been recorded for {link?.name || 'this person'}.</p>
          <Button onClick={setupThisDevice} disabled={deviceBusy}>{deviceBusy ? 'Setting up…' : 'Set up alerts on this device'}</Button>
        </Card>}
        <Dashboard key={selected} accountLinkId={selected} accountToken={token} onUnlinked={backToList} />
      </div>
    );
  }

  // ---------- caregiver home ----------
  const joinCard = (
    <Card className="g-account-join">
      <h3 className="cg-h3">Add someone with a code</h3>
      <p>Only the person themselves can give you access. Ask them to open Settings → Dependants &amp; caregivers → Invite a guardian and read you their 6-digit code.</p>
      <label className="g-account-label" htmlFor="account-guardian-name">Your name</label>
      <input id="account-guardian-name" className="input" maxLength={60} autoComplete="name"
        value={name} onChange={(e) => setName(e.target.value)} placeholder="Name they will see" />
      <CodeEntry error={error} busy={busy} nameRequired name={name} onSubmit={submit} />
    </Card>
  );
  return (
    <div className="cg">
      <header className="cg-top">
        <h1 className="cg-top__brand"><span translate="no">MYDAY</span></h1>
        <button type="button" className="topbar__settings" onClick={() => navigate('/')}>
          <Icon name="home" size={22} /> <span>My day</span>
        </button>
      </header>

      <main className="cg-main" id="main">
        <div className="cg-mode" role="note">
          <span className="rd-row__ic" aria-hidden="true"><Icon name="users" size={24} /></span>
          <div>
            <p className="cg-mode__t">Caregiver mode</p>
            <p className="cg-mode__d">View-only. You see what the people you support have recorded; you cannot change it.</p>
          </div>
        </div>
        {!online && <p className="cg-warn" role="status"><Icon name="alert" size={20} /> You are offline. What you see may be out of date and is not confirmed.</p>}

        {links.loading ? <SkeletonCard lines={3} /> : links.error ? (
          <Card><p className="lead">Could not load the people you support.</p><p className="muted">Nothing shown here is confirmed until this loads.</p><Button onClick={links.reload}>Try again</Button></Card>
        ) : (
          <>
            {tab === 'overview' && (
              <section className="stack" aria-labelledby="cg-over-t">
                <h2 className="cg-h" id="cg-over-t">People you support</h2>
                {!list.length && <><NobodyYet />{joinCard}</>}
                {list.length > 0 && attention.length > 0 && (
                  <button type="button" className="cg-attn" onClick={() => setTab('alerts')}>
                    <Icon name="alert" size={22} />
                    <span>{attention.length} {attention.length === 1 ? 'person has' : 'people have'} a dose with no record</span>
                    <Icon name="chevron" size={20} />
                  </button>
                )}
                {summaries.map(({ link, state, sum }) => (
                  <PersonCard key={link.id} link={link} state={state} sum={sum}
                    onView={() => { setSelected(localLink(link)); window.scrollTo(0, 0); }} onRetry={loadPeople} />
                ))}
                {list.length > 0 && (
                  <>
                    <Button variant="ghost" icon="refresh" onClick={loadPeople}>Refresh</Button>
                    <p className="cg-foot">View-only access · Records may be delayed</p>
                  </>
                )}
              </section>
            )}

            {tab === 'people' && (
              <section className="stack" aria-labelledby="cg-people-t">
                <h2 className="cg-h" id="cg-people-t">People</h2>
                {list.length ? (
                  <ul className="rd-list">
                    {list.map((link) => (
                      <li key={link.id} className="cg-person">
                        <Avatar name={link.name} color={colorFor(link.name)} size={46} />
                        <div className="cg-person__main">
                          <span className="cg-person__name" translate="no">{link.name}</span>
                          <span className="cg-chip"><Icon name="eye" size={15} stroke={2.4} /> View-only</span>
                        </div>
                        <div className="cg-person__acts">
                          <Button size="sm" full={false} onClick={() => { setSelected(localLink(link)); window.scrollTo(0, 0); }}>View day</Button>
                          <button type="button" className="g-account-remove" onClick={() => stopWatching(link)}>Stop supporting</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <NobodyYet />}
                {joinCard}
              </section>
            )}

            {tab === 'alerts' && (
              <section className="stack" aria-labelledby="cg-alerts-t">
                <h2 className="cg-h" id="cg-alerts-t">Alerts</h2>
                <p className="cg-foot" style={{ textAlign: 'left' }}>Doses with no record in MyDay today. A missing record does not mean the dose was not taken: consider checking in.</p>
                {attention.length ? (
                  <ul className="rd-list">
                    {attention.flatMap(({ link, sum }) => sum.unrecorded.map((d) => (
                      <li key={d.id} className="cg-alert">
                        <span className="cg-alert__ic" aria-hidden="true"><Icon name="alert" size={22} /></span>
                        <div className="cg-alert__main">
                          <span className="cg-alert__t"><span translate="no">{link.name}</span>: <span translate="no">{d.name}</span></span>
                          <span className="cg-alert__d">{prettyTime(d.time)} dose · {d.state === 'missed' ? 'Not recorded' : 'Not recorded yet'}</span>
                        </div>
                        <Button size="sm" variant="ghost" full={false} onClick={() => { setSelected(localLink(link)); window.scrollTo(0, 0); }}>View day</Button>
                      </li>
                    )))}
                  </ul>
                ) : (
                  <Card><p className="lead" style={{ margin: 0 }}>{list.length ? 'No doses are waiting for a record right now.' : 'Nobody to show yet.'}</p>
                    {list.length > 0 && <p className="muted" style={{ margin: '6px 0 0' }}>This reflects the last sync only.</p>}</Card>
                )}
                {list.length > 0 && (
                  <>
                    <h3 className="cg-h3">Phone alerts on this device</h3>
                    <ul className="rd-list">
                      {summaries.map(({ link, state }) => {
                        const on = state.data?.notifications?.push_enabled;
                        const known = !!state.data;
                        return (
                          <li key={link.id} className="cg-alert">
                            <span className="cg-alert__ic cg-alert__ic--plain" aria-hidden="true"><Icon name="bell" size={22} /></span>
                            <div className="cg-alert__main">
                              <span className="cg-alert__t" translate="no">{link.name}</span>
                              <span className="cg-alert__d">{!known ? 'Could not check' : on ? 'Signed up on this device. Delivery is not confirmed here.' : 'Off on this device'}</span>
                            </div>
                            <Button size="sm" variant="ghost" full={false} onClick={() => { setSelected(localLink(link)); window.scrollTo(0, 0); }}>{on ? 'Open' : 'Set up'}</Button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            )}

            {tab === 'more' && (
              <section className="stack" aria-labelledby="cg-more-t">
                <h2 className="cg-h" id="cg-more-t">More</h2>
                <ul className="rd-list">
                  <li><button type="button" className="rd-row" onClick={() => navigate('/')}>
                    <span className="rd-row__ic" aria-hidden="true"><Icon name="home" size={24} /></span>
                    <span className="rd-row__main"><span className="rd-row__t">Back to my own day</span><span className="rd-row__d">Your own medicines and appointments</span></span>
                    <Icon name="chevron" size={22} className="rd-row__chev" /></button></li>
                  <li><button type="button" className="rd-row" onClick={() => navigate('/profile?section=guardians')}>
                    <span className="rd-row__ic" aria-hidden="true"><Icon name="shield" size={24} /></span>
                    <span className="rd-row__main"><span className="rd-row__t">My own caregivers</span><span className="rd-row__d">Who can see my records</span></span>
                    <Icon name="chevron" size={22} className="rd-row__chev" /></button></li>
                </ul>
                <Card>
                  <h3 className="cg-h3">What view-only means</h3>
                  <ul className="cg-rules">
                    <li><Icon name="check" size={18} /> You can see today’s medicines and whether each has a record, appointments, and dose history.</li>
                    <li><Icon name="check" size={18} /> You can see diary notes only if the person chose to share them.</li>
                    <li><Icon name="close" size={18} /> You cannot record a dose, change a medicine or edit an appointment.</li>
                    <li><Icon name="close" size={18} /> You cannot see their health profile or health tracker.</li>
                    <li><Icon name="info" size={18} /> They can remove your access at any time.</li>
                  </ul>
                </Card>
              </section>
            )}
          </>
        )}
      </main>

      <nav className="cg-nav" aria-label="Caregiver navigation">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`cg-nav__item${tab === t.id ? ' is-active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setTab(t.id); window.scrollTo(0, 0); }}>
            <Icon name={t.icon} size={25} stroke={t.icon === 'more' ? 3 : 2.1} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function NobodyYet({ onAdd }) {
  return (
    <Card>
      <p className="lead" style={{ margin: 0 }}>You are not supporting anyone yet.</p>
      <p className="muted" style={{ margin: '6px 0 0' }}>Someone has to invite you from their own MyDay. You cannot add a person yourself.</p>
      {onAdd && <div style={{ marginTop: 12 }}><Button variant="ghost" icon="plus" onClick={onAdd}>Add someone with a code</Button></div>}
    </Card>
  );
}

// One person on the overview. Three honest states: loading, could not
// update (nothing is shown as confirmed), or the last synced summary.
function PersonCard({ link, state, sum, onView, onRetry }) {
  const first = String(link.name || '').split(' ')[0] || 'them';
  return (
    <article className="cg-card" aria-label={link.name}>
      <header className="cg-card__head">
        <Avatar name={link.name} color={colorFor(link.name)} size={48} />
        <div className="cg-card__who">
          <h3 className="cg-card__name" translate="no">{link.name}</h3>
          <span className="cg-chip"><Icon name="eye" size={15} stroke={2.4} /> View-only</span>
        </div>
      </header>
      {state.loading && !state.data ? (
        <p className="cg-card__line" role="status">Loading the latest records…</p>
      ) : !state.data ? (
        <div className="cg-card__stale" role="status">
          <Icon name="alert" size={20} />
          <span><b>Could not update.</b> {state.error} No records are shown, so nothing here is confirmed.
            {/revoked|removed|no longer|not authori/i.test(state.error || '') ? ` ${first} may have removed your access.` : ''}</span>
        </div>
      ) : (
        <>
          <div className={`cg-card__sum${sum.unrecorded.length ? ' is-attn' : sum.total && sum.settled === sum.total ? ' is-ok' : ''}`}>
            <Icon name={sum.unrecorded.length ? 'alert' : sum.total && sum.settled === sum.total ? 'check' : 'clock'} size={20} stroke={2.4} />
            <span>
              <b>{sum.total ? `${sum.settled} of ${sum.total} doses recorded` : 'No medicines scheduled today'}</b>
              {sum.unrecorded.slice(0, 2).map((d) => <span key={d.id} className="cg-card__sub">{prettyTime(d.time)} dose: {d.state === 'missed' ? 'not recorded' : 'not recorded yet'}</span>)}
              {sum.unrecorded.length > 2 && <span className="cg-card__sub">and {sum.unrecorded.length - 2} more</span>}
              {!sum.unrecorded.length && sum.open > 0 && <span className="cg-card__sub">{sum.open} still to come today</span>}
            </span>
          </div>
          <p className="cg-card__line"><Icon name="calendar" size={18} /> <span>{sum.nextAppointment
            ? <>Next appointment: <span translate="no">{sum.nextAppointment.who}</span>, {sum.nextAppointment.when}</>
            : 'No upcoming appointment on record'}</span></p>
          <p className="cg-card__sync"><Icon name="refresh" size={16} /> <span>Last synced {state.at ? prettyClock(new Date(state.at)) : 'earlier'}{state.error ? ' · could not update since' : ''}</span></p>
        </>
      )}
      <div className="cg-card__acts">
        {state.data ? <Button onClick={onView}>View day</Button> : <Button variant="ghost" icon="refresh" onClick={onRetry}>Try again</Button>}
      </div>
    </article>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
