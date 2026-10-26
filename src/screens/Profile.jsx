import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, Modal, Field, Input, Textarea, EmptyState, SegmentedControl, Avatar, Toggle } from '../components/ui.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { listContacts, saveContact, deleteContact, uploadAvatar,
  createGuardianInvite, listGuardians, deleteGuardian, formatGuardianCode, issueGuardianCode, revokeGuardianDevice, setGuardianShareDiary } from '../lib/db.js';
import { LANGUAGES, MORE_LANGUAGES, currentLanguage, setLanguage } from '../lib/translate.js';
import { ageFromBirthday, prettyClock, shortDate } from '../lib/format.js';
import { THEMES, TEXT_SIZES, MODES, modeOf, themeForMode, profileCompleteness } from '../lib/appearance.js';
import { CONTACT_TYPES, validPhone, telHref } from '../lib/contacts.js';
import { HowToGuide } from './HowTo.jsx';
import { AlertsSettings } from '../components/AlertsSettings.jsx';


// A linking code now lives for 15 minutes, not 14 days, so it is counted in
// minutes. "Works for 12 more minutes" is also a useful nudge to read it out
// now rather than leave it on screen.
function codeLife(iso) {
  const mins = Math.ceil((new Date(iso).getTime() - Date.now()) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  if (mins === 1) return '1 more minute';
  return `${mins} more minutes`;
}

// When a guardian last opened their dashboard, in words.
function lastSeenWords(iso) {
  if (!iso) return 'Has not opened it yet';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 120000) return 'Looking at it now';
  if (diff < 3600000) return `Opened ${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `Opened at ${prettyClock(d)}`;
  if (diff < 172800000) return 'Opened yesterday';
  return `Opened ${shortDate(d.toISOString().slice(0, 10))}`;
}


const typeMeta = (t) => CONTACT_TYPES.find((x) => x.value === t) || CONTACT_TYPES[5];

// Friendly labels for the profile-completeness checklist.
const FIELD_LABELS = {
  full_name: 'Add your name',
  avatar_url: 'Add a profile photo',
  birthday: 'Add your birthday',
  for_whom: 'Tell us who MyDay is for',
  on_treatment: 'List your medications',
  goal: 'Add a health goal',
};

export default function Profile() {
  const { user, profile, theme, resolvedTheme, setTheme, textSize, setTextSize, signOut, updateProfile, reloadProfile } = useApp();
  const { settings, set: setSetting } = useSettings();
  const ui = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const completeness = profileCompleteness(profile);

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { ui.toast('Please choose an image under 6 MB.', 'bad'); return; }
    setUploading(true);
    try {
      const url = await uploadAvatar(user.id, file);
      await updateProfile({ avatar_url: url });
      ui.toast('Photo updated.');
    } catch { ui.toast('Could not upload the photo.', 'bad'); }
    setUploading(false);
  }
  const contacts = useAsync(() => listContacts(), []);
  const guardians = useAsync(() => listGuardians(), []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [busyInvite, setBusyInvite] = useState(false);

  const [reveal, setReveal] = useState(null);
  // The open page lives in the address (?section=access), so the phone's back
  // button and a reload both behave.
  const section = new URLSearchParams(location.search).get('section');
  const page = PAGE_IDS[section] ? section : null;
  const [showAllThemes, setShowAllThemes] = useState(false);
  function openPage(id, replace = false) {
    navigate(id ? `/profile?section=${id}` : '/profile', { replace });
    window.scrollTo(0, 0);
  }
  // "Show me" links (How to use MyDay, Home's banners) open their page.
  useEffect(() => { if (reveal?.id && PAGE_IDS[reveal.id]) openPage(reveal.id, true); }, [reveal]);
  useEffect(() => {
    const open = location.state?.open;
    if (open) { setReveal((r) => ({ id: open, n: (r?.n || 0) + 1 })); window.history.replaceState({}, ''); }
  }, [location.key]);
  useEffect(() => {
    // Home's quick-call tiles send the kind of contact they need (doctor, pharmacy…).
    if (location.state?.add === 'contact') { setEditContact({ type: location.state.contactType }); window.history.replaceState({}, ''); }
    if (location.state?.add === 'guardian' && !location.state.guardianId) { setInviteOpen(true); window.history.replaceState({}, ''); }
  }, [location.key]);
  // From Home's "Finish connecting…": put that guardian's fresh code on screen
  // once the list has loaded.
  const handledGuardianLink = useRef(null);
  useEffect(() => {
    const id = location.state?.guardianId;
    if (!id || !guardians.data || handledGuardianLink.current === location.key) return;
    handledGuardianLink.current = location.key;
    window.history.replaceState({}, '');
    const g = guardians.data.find((x) => x.id === id);
    if (g) newCode(g); else setInviteOpen(true);
  }, [location.key, guardians.data]);

  const age = profile?.age ?? ageFromBirthday(profile?.birthday);

  // Checklist item tap: photo opens the file picker; everything else opens the form.
  function fixField(field) {
    if (field === 'avatar_url') fileRef.current?.click();
    else setEditProfile(true);
  }

  async function onSignOut() {
    const ok = await ui.confirm({ title: 'Sign out', message: 'Sign out of MyDay on this phone?', confirmLabel: 'Sign out' });
    if (ok) {
      try { await signOut(); }
      catch { ui.toast('Could not sign out. Check your connection and try again.', 'bad'); }
    }
  }
  async function removeContact(c) {
    const ok = await ui.confirm({ title: 'Remove contact', message: `Remove ${c.name}?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { await deleteContact(c.id); ui.toast('Removed.', 'info'); contacts.reload(); } catch { ui.toast('Could not remove.', 'bad'); }
  }
  async function createInvite() {
    if (!inviteName.trim()) { ui.toast('Please enter a name.', 'bad'); return; }
    setBusyInvite(true);
    try {
      const g = await createGuardianInvite(inviteName.trim());
      setCreatedInvite(g);
      guardians.reload();
    } catch { ui.toast('Could not create the invite.', 'bad'); }
    setBusyInvite(false);
  }
  function closeInvite() { setInviteOpen(false); setCreatedInvite(null); setInviteName(''); }
  async function removeGuardian(g) {
    const ok = await ui.confirm({ title: 'Remove guardian', message: `Remove ${g.name}? They will stop getting alerts.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { await deleteGuardian(g.id); ui.toast('Removed.', 'info'); guardians.reload(); }
    catch { ui.toast('Could not remove.', 'bad'); }
  }
  // Mints a fresh 15-minute code (invalidating the old one) and puts it back on
  // screen, which is what someone reaching for "new code" actually wants to see.
  async function newCode(g) {
    try {
      const fresh = await issueGuardianCode(g.id);
      const updated = { ...g, ...fresh };
      guardians.reload();
      setCreatedInvite(updated);
      setInviteOpen(true);
    } catch { ui.toast('Could not make a new code.', 'bad'); }
  }
  // Kills one device's token. Takes effect on that device's next request.
  async function revokeDevice(g, device) {
    const ok = await ui.confirm({
      title: 'Disconnect this device?',
      message: `${device.label || 'This device'} will stop showing your information and stop getting alerts. ${g.name} can connect again with a new code.`,
      confirmLabel: 'Disconnect', danger: true,
    });
    if (!ok) return;
    try { await revokeGuardianDevice(device.id); ui.toast('Device disconnected.', 'info'); guardians.reload(); }
    catch { ui.toast('Could not disconnect that device.', 'bad'); }
  }
  async function toggleDiary(g, share) {
    try { await setGuardianShareDiary(g.id, share); guardians.reload(); }
    catch { ui.toast('Could not save.', 'bad'); }
  }

  // Every section below is one line with a summary; tap it to open it, tap
  // again to close it. Each remembers its own state on this device.
  const mode = modeOf(theme);
  const themeName = theme === 'system'
    ? `System (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})`
    : THEMES.find((t) => t.id === theme)?.name || 'Light';
  const sizeName = TEXT_SIZES.find((t) => t.id === textSize)?.name || 'Normal';
  const access = [settings.highContrast && 'More contrast', settings.bold && 'Bold', settings.bigButtons && 'Bigger buttons', settings.calmMotion && 'Calm'].filter(Boolean);
  const connected = (guardians.data || []).filter((g) => g.deviceCount > 0).length;

  // One settings home with a short list; each row opens its own page with a
  // back button, so nothing is ever more than one tap deep.
  const pages = {
    access: { title: 'Accessibility', desc: 'Make MyDay easier to see and use.' },
    alerts: { title: 'Alerts & reminders', desc: 'When MyDay reminds you, and how it sounds.' },
    guardians: { title: 'Guardians', desc: 'Family who are told if you miss a medicine.' },
    contacts: { title: 'My contacts', desc: 'Family, doctor and pharmacy, one tap away.' },
    language: { title: 'Language', desc: 'Show MyDay in your language.' },
    appearance: { title: 'Appearance', desc: 'Light or dark, and your colour theme.' },
    info: { title: 'My information', desc: 'Your details, health and goals.' },
    howto: { title: 'How to use MyDay', desc: 'A step-by-step guide.' },
  };
  const current = page && pages[page];
  const languageName = (LANGUAGES.concat(MORE_LANGUAGES).find((l) => l.code === currentLanguage())?.name) || 'English';
  const contrastLevel = !settings.highContrast ? 'default' : settings.extraContrast ? 'extra' : 'high';

  if (current) {
    return (
      <div className="stack settings-page">
        <div className="settings-page__head">
          <button type="button" className="settings-back" aria-label="Back to Settings" onClick={() => openPage(null)}>
            <Icon name="back" size={24} />
          </button>
          <div>
            <h2 className="settings-page__t">{current.title}</h2>
            <p className="settings-page__d">{current.desc}</p>
          </div>
        </div>

        {page === 'access' && (
          <>
            <Card className="pref-card">
              <div className="pref-card__head"><span className="pref-card__ic pref-card__ic--violet"><b aria-hidden="true">Aa</b></span>
                <div><div className="pref-card__t">Text size</div><div className="pref-card__d">Adjust the size of text in the app.</div></div></div>
              <div className="choice-tiles" role="radiogroup" aria-label="Text size">
                {TEXT_SIZES.map((t, i) => (
                  <button key={t.id} type="button" role="radio" aria-checked={textSize === t.id}
                    className={`choice-tile${textSize === t.id ? ' is-active' : ''}`} onClick={() => setTextSize(t.id)}>
                    <span className="choice-tile__aa" style={{ fontSize: 18 + i * 5 }} aria-hidden="true">Aa</span>
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="pref-card">
              <div className="pref-card__head"><span className="pref-card__ic pref-card__ic--orange"><Icon name="sun" size={22} /></span>
                <div><div className="pref-card__t">Display contrast</div><div className="pref-card__d">Make text and buttons easier to see.</div></div></div>
              <div className="choice-tiles" role="radiogroup" aria-label="Display contrast">
                {[
                  { id: 'default', name: 'Default', patch: { highContrast: false, extraContrast: false } },
                  { id: 'high', name: 'High contrast', patch: { highContrast: true, extraContrast: false } },
                  { id: 'extra', name: 'Extra high', patch: { highContrast: true, extraContrast: true } },
                ].map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={contrastLevel === c.id}
                    className={`choice-tile${contrastLevel === c.id ? ' is-active' : ''}`} onClick={() => setSetting(c.patch)}>
                    <span className={`contrast-sample contrast-sample--${c.id}`} aria-hidden="true"><i /><i /></span>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="pref-card">
              <div className="pref-card__head"><span className="pref-card__ic pref-card__ic--orange"><Icon name="sun" size={22} /></span>
                <div><div className="pref-card__t">Theme</div><div className="pref-card__d">Choose a look you like.</div></div></div>
              {showAllThemes ? <ThemeGrid themes={THEMES} theme={theme} setTheme={setTheme} /> : <ThemePictures theme={theme} setTheme={setTheme} />}
              <Button variant="ghost" size="sm" onClick={() => setShowAllThemes((v) => !v)}>
                {showAllThemes ? 'Show fewer themes' : `More themes (${THEMES.length})`}
              </Button>
            </Card>

            <Card className="pref-card pref-list">
              <MenuRow icon="bell" title="Sound & vibration" desc="Control alert sounds and vibration" onClick={() => openPage('alerts')} />
              <SettingRow icon="plus" title="Larger touch targets" desc="Bigger buttons, easier to tap.">
                <Toggle checked={settings.bigButtons} onChange={(v) => setSetting({ bigButtons: v })} label="Larger touch targets" />
              </SettingRow>
              <SettingRow icon="edit" title="Bold text" desc="Thicker letters that are easier to read.">
                <Toggle checked={settings.bold} onChange={(v) => setSetting({ bold: v })} label="Bold text" />
              </SettingRow>
              <SettingRow icon="moon" title="Calm screen" desc="Turns off moving animations.">
                <Toggle checked={settings.calmMotion} onChange={(v) => setSetting({ calmMotion: v })} label="Calm screen" />
              </SettingRow>
            </Card>

            <p className="settings-note"><Icon name="info" size={22} /> These settings help make MyDay simpler and easier to use.</p>
          </>
        )}

        {page === 'alerts' && <AlertsSettings reveal={reveal?.id === 'alerts' ? reveal.n : null} />}

        {page === 'guardians' && <Card>
        {guardians.data && !connected && (
          <p className="fold__alert"><Icon name="shield" size={20} /> No one gets an alert yet if you miss a medicine. Add a family guardian to turn on safety alerts.</p>
        )}
        <p className="muted" style={{ margin: '0 0 12px' }}>
          A guardian is someone in your family who can check on their own phone or tablet whether you have
          taken your medicines, and gets an alert if you miss one. Tap <b>Show code</b> and read them the
          6-digit code — it works for 15 minutes and once only. They don't need an account.
        </p>
        {/* Two ways in, side by side: someone can watch over you, or you can
            watch over someone who invited you. */}
        <p style={{ margin: '0 0 10px', fontWeight: 700 }}>You can invite a guardian, or become a guardian for someone else.</p>
        <div className="guardian-choice">
          <Button icon="plus" onClick={() => setInviteOpen(true)}>Invite a guardian</Button>
          <Button variant="ghost" icon="user" onClick={() => navigate('/guardian')}>Become a guardian</Button>
        </div>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          <b>Become a guardian</b> if a family member gave you their 6-digit code, so you can check on their medicines.
        </p>
        <p className="muted" style={{ margin: '12px 0' }}>
          They can only <b>look</b>. A guardian can never change your medicines or appointments, and can never
          mark a dose as taken. A guardian is not an emergency service: nobody is called or alerted for you
          except the missed-dose alerts you turn on.
        </p>
        {guardians.data?.length ? (
          <div className="guardian-list">
            {guardians.data.map((g) => (
              <GuardianRow key={g.id} guardian={g}
                onShowCode={() => newCode(g)}
                onRevokeDevice={(d) => revokeDevice(g, d)}
                onToggleDiary={(v) => toggleDiary(g, v)}
                onRemove={() => removeGuardian(g)} />
            ))}
          </div>
        ) : null}
              </Card>}

        {page === 'contacts' && <Card>
        <Button variant="ghost" icon="plus" onClick={() => setEditContact({})}>Add a contact</Button>
        <div style={{ height: 10 }} />
        {contacts.loading ? <Spinner label="" /> : !contacts.data?.length ? (
          <EmptyState>Add your pharmacy, doctor, an emergency contact and more so they're one tap away.</EmptyState>
        ) : (
          <ul className="stack contact-list">
            {[...contacts.data].sort((a, b) => Number(!!b.is_emergency) - Number(!!a.is_emergency)).map((c) => {
              const m = typeMeta(c.type);
              const tel = telHref(c.phone);
              return (
                <li key={c.id} className="contact">
                  <span className="contact__icon" aria-hidden="true"><Icon name={c.is_emergency ? 'alert' : m.icon} size={22} /></span>
                  <div className="contact__main">
                    <div className="contact__name">{c.name}</div>
                    <div className="contact__tags">
                      <span className="contact__type">{m.label}</span>
                      {c.is_emergency && <span className="contact__type contact__type--sos">Emergency contact</span>}
                      {c.relationship && <span className="contact__type">{c.relationship}</span>}
                    </div>
                    {c.email && <div className="contact__line">{c.email}</div>}
                    {c.address && <div className="contact__line">{c.address}</div>}
                    {c.notes && <div className="contact__line muted">{c.notes}</div>}
                    {tel && (
                      <a className="btn btn--good btn--sm contact__call" href={tel} aria-label={`Call ${c.name}, ${m.label}, ${c.phone}`}>
                        <Icon name="phone" size={18} /> <span>Call {c.phone}</span>
                      </a>
                    )}
                  </div>
                  <div className="contact__actions">
                    <button type="button" className="icon-btn" aria-label={`Edit ${c.name}`} onClick={() => setEditContact(c)}><Icon name="edit" size={20} /></button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${c.name}`} onClick={() => removeContact(c)}><Icon name="trash" size={20} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 15 }}>
          In an emergency, call 911. MyDay never calls or messages anyone for you.
        </p>
              </Card>}

        {page === 'language' && <Card>
        <label className="muted" htmlFor="lang-select" style={{ display: 'block', margin: '0 0 10px' }}>Show MyDay in your language. The page reloads once.</label>
        <select id="lang-select" className="lang-select notranslate input input--select" translate="no" value={currentLanguage()}
          onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.en ? `${l.name} — ${l.en}` : l.name}</option>)}
          <optgroup label="More languages">
            {MORE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{`${l.name} — ${l.en}`}</option>)}
          </optgroup>
        </select>
              </Card>}

        {page === 'appearance' && (
          <>
            <ThemePictures theme={theme} setTheme={setTheme} />
            <Card className="pref-list">
              <MenuRow icon="star" title={`More themes (${THEMES.length})`} desc="Lavender, Mint, Sunshine, Forest night and more"
                onClick={() => setShowAllThemes((v) => !v)} />
              {showAllThemes && <div style={{ padding: '4px 14px 14px' }}><ThemeGrid themes={THEMES} theme={theme} setTheme={setTheme} /></div>}
            </Card>
            <Card className="pref-list">
              <MenuRow icon="bell" title="Sound & vibration" desc="Control alert sounds and vibration" onClick={() => openPage('alerts')} />
              <SettingRow icon="plus" title="Larger touch targets" desc="Bigger buttons, easier to tap.">
                <Toggle checked={settings.bigButtons} onChange={(v) => setSetting({ bigButtons: v })} label="Larger touch targets" />
              </SettingRow>
              <SettingRow icon="edit" title="Bold text" desc="Thicker letters that are easier to read.">
                <Toggle checked={settings.bold} onChange={(v) => setSetting({ bold: v })} label="Bold text" />
              </SettingRow>
              <SettingRow icon="moon" title="Calm screen" desc="Turns off moving animations.">
                <Toggle checked={settings.calmMotion} onChange={(v) => setSetting({ calmMotion: v })} label="Calm screen" />
              </SettingRow>
            </Card>
          </>
        )}

        {page === 'info' && (
          <>
      {completeness.pct < 100 && (
        <Card>
          <div className="progress-card">
            <div className="progress-card__ring" style={{ '--p': completeness.pct }} aria-hidden="true"><b>{completeness.pct}%</b></div>
            <div className="progress-card__main">
              <div className="progress-card__t">Profile progress: {completeness.pct}%</div>
              <div className="progress-card__d">Complete your profile to personalise your experience.</div>
            </div>
          </div>
          <ul className="checklist">
            {completeness.missing.map((f) => (
              <li key={f}>
                <button type="button" className="checklist__item" onClick={() => fixField(f)}>
                  <span className="checklist__box" aria-hidden="true"><Icon name="plus" size={16} /></span>
                  <span>{FIELD_LABELS[f] || f}</span>
                  <Icon name="chevron" size={20} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

            <Card>
        <div className="menu-list">
          <MenuRow icon="user" title="About me" desc="Your name, birthday, health and goals — all on one page" onClick={() => setEditProfile(true)} />
        </div>
            </Card>
          </>
        )}

        {page === 'howto' && <Card><HowToGuide /></Card>}

        {renderOverlays()}
      </div>
    );
  }

  return (
    <div className="stack settings-home">
      {/* identity */}
      <Card className="me-card">
        <div className="avatar-edit">
          <Avatar name={profile?.full_name} color={profile?.avatar_color} size={84} src={profile?.avatar_url} />
          <button type="button" className="avatar-edit__btn" aria-label="Change profile photo" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Icon name={uploading ? 'clock' : 'plus'} size={16} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
        </div>
        <div className="me-card__main">
          <div className="me-card__name">{profile?.full_name || 'Your profile'}</div>
          {age != null && <div className="me-card__sub">{age} years old</div>}
          <button type="button" className="me-card__edit" onClick={() => setEditProfile(true)}>
            <Icon name="user" size={18} /> Edit profile
          </button>
        </div>
      </Card>

      <div>
        <h2 className="settings-group">Safety &amp; Support</h2>
        <p className="settings-group__d">Add family or trusted contacts for extra support.</p>
      </div>
      <div className="safety-tiles">
        <button type="button" className={`safety-tile${guardians.data && !connected ? ' needs-attention' : ''}`} onClick={() => openPage('guardians')}>
          <span className="safety-tile__ic safety-tile__ic--orange"><Icon name="user" size={26} /></span>
          <span className="safety-tile__t">Guardians</span>
          <span className="safety-tile__d">{!guardians.data ? '' : !connected ? 'Add a family guardian to enable safety alerts' : `${connected} connected`}</span>
        </button>
        <button type="button" className="safety-tile" onClick={() => openPage('contacts')}>
          <span className="safety-tile__ic safety-tile__ic--green"><Icon name="phone" size={26} /></span>
          <span className="safety-tile__t">My contacts</span>
          <span className="safety-tile__d">{contacts.data?.length ? `${contacts.data.length} saved` : 'Family, doctor and pharmacy'}</span>
        </button>
      </div>

      <h2 className="settings-group">Health &amp; App Preferences</h2>
      <Card className="pref-list">
        <MenuRow icon="eye" title="Accessibility" desc="Text size, contrast, buttons" onClick={() => openPage('access')} />
        <MenuRow icon="bell" title="Alerts & reminders" desc="Notifications and sound" onClick={() => openPage('alerts')} />
        <MenuRow icon="globe" title="Language" desc={languageName} onClick={() => openPage('language')} />
        <MenuRow icon="sun" title="Appearance" desc={`${themeName} theme`} onClick={() => openPage('appearance')} />
        <MenuRow icon="cross" title="My information" desc={completeness.pct < 100 ? `Profile ${completeness.pct}% complete` : 'Name, birthday, health and goals'} onClick={() => setEditProfile(true)} />
      </Card>

      <h2 className="settings-group">Help &amp; Information</h2>
      <Card className="pref-list">
        <MenuRow icon="info" title="How to use MyDay" desc="Step-by-step guide" onClick={() => openPage('howto')} />
      </Card>

      <Button variant="danger" icon="logout" onClick={onSignOut}>Sign out</Button>
      {renderOverlays()}
    </div>
  );

  function renderOverlays() {
    return (
      <>
      {inviteOpen && (
        <Modal title={createdInvite ? `${createdInvite.name}'s code` : 'Invite a guardian'} onClose={closeInvite}>
          {createdInvite ? (
            <>
              <p className="dialog-msg">
                Read this code out to {createdInvite.name}. On their own phone or tablet they open
                <b> myday-1rn.pages.dev/guardian</b> and type it in.
              </p>
              <div className="big-code" aria-label={`Code ${String(createdInvite.code || '').split('').join(' ')}`}>
                {formatGuardianCode(createdInvite.code)}
              </div>
              <p className="muted" style={{ textAlign: 'center', margin: '0 0 16px' }}>
                {codeLife(createdInvite.code_expires_at)
                  ? <>Works for {codeLife(createdInvite.code_expires_at)}, and only once.</>
                  : <>This code has expired — tap “Make a new code”.</>}
                <br />Only share it with someone you trust.
              </p>
              <Button icon="plus" variant="ghost" onClick={() => newCode(createdInvite)}>Make a new code</Button>
              <div style={{ height: 8 }} />
              <Button onClick={closeInvite}>Done</Button>
            </>
          ) : (
            <>
              <p className="dialog-msg">Who are you inviting? You'll get a 6-digit code to read out to them.</p>
              <Field label="Guardian's name">
                <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="e.g. Sarah" autoComplete="name" />
              </Field>
              <div style={{ height: 8 }} />
              <Button icon="plus" onClick={createInvite} disabled={busyInvite}>{busyInvite ? 'Creating…' : 'Get my code'}</Button>
            </>
          )}
        </Modal>
      )}

      {editProfile && <ProfileForm profile={profile} onClose={() => setEditProfile(false)}
        onSaved={async (patch) => { await updateProfile(patch); await reloadProfile(); setEditProfile(false); ui.toast('Saved.'); }} />}
      {editContact && <ContactForm contact={editContact.id ? editContact : null} initialType={editContact.type} onClose={() => setEditContact(null)}
        onSaved={() => { setEditContact(null); contacts.reload(); }} />}
      </>
    );
  }
}

const PAGE_IDS = { access: 1, alerts: 1, guardians: 1, contacts: 1, language: 1, appearance: 1, info: 1, howto: 1 };

// The three everyday themes as big pictures: a sunny sky, a night sky, a
// warm sunset. Easier to choose between than small colour swatches.
const PICTURES = [
  { id: 'light', name: 'Light', icon: 'sun' },
  { id: 'dark', name: 'Dark', icon: 'moon' },
  { id: 'warm', name: 'Warm', icon: 'sun' },
];
function ThemePictures({ theme, setTheme }) {
  return (
    <div className="theme-pics" role="radiogroup" aria-label="Theme">
      {PICTURES.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={theme === t.id}
          className={`theme-pic theme-pic--${t.id}${theme === t.id ? ' is-active' : ''}`} onClick={() => setTheme(t.id)}>
          <span className="theme-pic__art" aria-hidden="true"><Icon name={t.icon} size={40} /></span>
          <span className="theme-pic__name">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

// The colour theme picker: a preview swatch per theme.
function ThemeGrid({ themes, theme, setTheme }) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Colour theme">
      {themes.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={theme === t.id}
          className={`theme-swatch${theme === t.id ? ' is-active' : ''}`} onClick={() => setTheme(t.id)}>
          <span className="theme-swatch__preview" style={{ background: t.bg, color: t.ink }} aria-hidden="true">
            <span className="theme-swatch__bar" style={{ background: t.ink, opacity: 0.18 }} />
            <span className="theme-swatch__bar theme-swatch__bar--short" style={{ background: t.ink, opacity: 0.12 }} />
            <span className="theme-swatch__btn" style={{ background: t.primary }} />
          </span>
          <span className="theme-swatch__name">{t.name}{theme === t.id ? ' ✓' : ''}</span>
        </button>
      ))}
    </div>
  );
}

// One settings line: icon, name + plain-words description, and the control
// (a switch on the right, or a full-width segmented picker underneath).
// One guardian, with every device they have connected, when each last opened
// the dashboard, and a Revoke button per device. The senior has to be able to
// see exactly who is watching and cut any of them off in one tap — that is the
// other half of letting a guardian in at all.
function GuardianRow({ guardian: g, onShowCode, onRevokeDevice, onToggleDiary, onRemove }) {
  const [open, setOpen] = useState(false);
  const connected = g.deviceCount > 0;

  return (
    <div className={`guardian${connected ? ' guardian--on' : ''}`}>
      <div className="guardian__head">
        <span className="guardian__ic"><Icon name="user" size={22} /></span>
        <div className="guardian__main">
          <div className="guardian__name">{g.name}</div>
          <div className={`guardian__state${connected ? ' guardian__state--on' : ''}`}>
            {connected
              ? <><Icon name="check" size={16} /> {g.deviceCount} device{g.deviceCount === 1 ? '' : 's'} connected</>
              : <><Icon name="clock" size={16} /> Not connected yet</>}
          </div>
          {connected && <div className="guardian__seen">{lastSeenWords(g.lastSeenAt)}</div>}
        </div>
        <button className="icon-btn" aria-label={`Remove ${g.name}`} onClick={onRemove}>
          <Icon name="trash" size={20} />
        </button>
      </div>

      {connected && (
        <ul className="guardian__devices">
          {g.devices.map((d) => (
            <li key={d.id} className="gdev">
              <span className="gdev__ic"><Icon name={d.push_enabled ? 'bell' : 'eye'} size={18} /></span>
              <span className="gdev__main">
                <span className="gdev__label">{d.label || 'Their device'}</span>
                <span className="gdev__meta">
                  {lastSeenWords(d.last_seen_at)}
                  {d.push_enabled ? ' · alerts on' : ' · alerts off'}
                </span>
              </span>
              <button type="button" className="gdev__revoke" onClick={() => onRevokeDevice(d)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}

      <div className="guardian__actions">
        <Button variant="ghost" size="sm" icon="share" full={false} onClick={onShowCode}>
          {connected ? 'Add another device' : 'Show code'}
        </Button>
        <Button variant="ghost" size="sm" icon="dots" full={false} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'What they see'}
        </Button>
      </div>

      {open && (
        <div className="guardian__perms">
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 15 }}>
            {g.name} can see, and cannot change:
          </p>
          <ul className="g-can">
            <li className="g-can__yes"><Icon name="check" size={18} /> Today's medicines and whether each was taken</li>
            <li className="g-can__yes"><Icon name="check" size={18} /> Your upcoming appointments</li>
            <li className="g-can__yes"><Icon name="check" size={18} /> Your taken and missed dose history</li>
            <li className="g-can__yes"><Icon name="check" size={18} /> The phone numbers of your saved contacts</li>
            <li className="g-can__no"><Icon name="close" size={18} /> They cannot change or add anything</li>
            <li className="g-can__no"><Icon name="close" size={18} /> They cannot mark a dose as taken</li>
          </ul>
          <SettingRow icon="notes" title="Share my health notes"
            desc="Off by default. Lets them read your recent diary entries.">
            <Toggle checked={!!g.share_diary} onChange={onToggleDiary} label={`Share health notes with ${g.name}`} />
          </SettingRow>
        </div>
      )}
    </div>
  );
}

function SettingRow({ icon, title, desc, children, stacked }) {
  return (
    <div className={`setting-row${stacked ? ' setting-row--stack' : ''}`}>
      <span className="setting-row__ic"><Icon name={icon} size={22} /></span>
      <div className="setting-row__main">
        <div className="setting-row__t">{title}</div>
        {desc && <div className="setting-row__d">{desc}</div>}
      </div>
      {stacked ? <div className="setting-row__ctl">{children}</div> : children}
    </div>
  );
}

function SectionTitle({ icon, title, action }) {
  return (
    <div className="section-title">
      <span className="section-title__l"><Icon name={icon} size={22} /> <span>{title}</span></span>
      {action}
    </div>
  );
}

// One tappable menu row: icon tile, title + plain-words description, chevron.
function MenuRow({ icon, title, desc, onClick }) {
  return (
    <button className="menu-row" onClick={onClick}>
      <span className="menu-row__ic"><Icon name={icon} size={22} /></span>
      <span className="menu-row__main">
        <span className="menu-row__t">{title}</span>
        {desc && <span className="menu-row__d" style={{ display: 'block' }}>{desc}</span>}
      </span>
      <Icon name="chevron" size={22} />
    </button>
  );
}

// These MUST match the myday_profiles.for_whom CHECK constraint ('self' | 'other').
// They previously read 'myself' / 'loved_one', which made every profile save fail.
const WHOM_OPTS = [{ value: 'self', label: 'Myself' }, { value: 'other', label: 'A loved one' }];

function ProfileForm({ profile, onClose, onSaved }) {
  const ui = useUI();
  const [full_name, setName] = useState(profile?.full_name || '');
  const [birthday, setBirthday] = useState(profile?.birthday || '');
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [for_whom, setForWhom] = useState(profile?.for_whom || '');
  const [on_treatment, setOn] = useState(profile?.on_treatment || '');
  const [goal, setGoal] = useState(profile?.goal || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const patch = {
      full_name: full_name.trim() || null,
      birthday: birthday || null,
      age: age ? Math.max(0, Math.min(130, parseInt(age, 10) || 0)) : null,
      for_whom: for_whom || null,
      on_treatment: on_treatment.trim() || null,
      goal: goal.trim() || null,
    };
    try { await onSaved(patch); }
    catch (e) { ui.toast(e?.message || 'Could not save.', 'bad'); setBusy(false); }
  }

  return (
    <Modal title="About me" onClose={onClose}>
      <Field label="Name"><Input value={full_name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
      <Field label="Birthday"><Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></Field>
      <Field label="Age" hint="Optional - filled in from your birthday if set."><Input type="number" min="0" max="130" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
      <Field label="Who is MyDay for?"><SegmentedControl value={for_whom} onChange={setForWhom} options={WHOM_OPTS} /></Field>
      <Field label="Medications & supplements" hint="Current treatments, medicines, or conditions."><Textarea rows={2} value={on_treatment} onChange={(e) => setOn(e.target.value)} maxLength={300} /></Field>
      <Field label="What I'm working toward" hint="Your health goals."><Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} /></Field>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} icon={busy ? 'clock' : undefined} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

function ContactForm({ contact, initialType, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!contact;
  const [type, setType] = useState(contact?.type || initialType || 'pharmacy');
  const [name, setName] = useState(contact?.name || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [address, setAddress] = useState(contact?.address || '');
  const [notes, setNotes] = useState(contact?.notes || '');
  const [relationship, setRelationship] = useState(contact?.relationship || '');
  const [emergency, setEmergency] = useState(!!contact?.is_emergency);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const typeRefs = useRef([]);

  async function save() {
    const next = {};
    if (!name.trim()) next.name = 'Please enter a name.';
    if (!validPhone(phone)) next.phone = 'That phone number does not look right. Use 7 to 15 digits, like (555) 123-4567.';
    if (emergency && !phone.trim()) next.phone = 'An emergency contact needs a phone number.';
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(next.name ? 'contact-name' : 'contact-phone')?.focus();
      return;
    }
    setBusy(true);
    try {
      await saveContact({
        id: contact?.id, existing: contact, type, name: name.trim(), phone: phone.trim(), email: email.trim(),
        address: address.trim(), notes: notes.trim(), relationship: relationship.trim(), is_emergency: emergency,
      });
      ui.toast(editing ? 'Contact updated.' : 'Contact added.');
      onSaved();
    } catch { ui.toast('Could not save. Your details are still here.', 'bad'); setBusy(false); }
  }

  // A radio group, not six loose buttons inside a <label> — which is why a
  // screen reader announced "Type Provider Clinic Insurance Merchant Other"
  // for the Pharmacy button.
  const idx = Math.max(0, CONTACT_TYPES.findIndex((t) => t.value === type));
  function onTypeKey(e) {
    const n = CONTACT_TYPES.length;
    let nx = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nx = (idx + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nx = (idx - 1 + n) % n;
    if (nx == null) return;
    e.preventDefault();
    setType(CONTACT_TYPES[nx].value);
    typeRefs.current[nx]?.focus();
  }

  return (
    <Modal title={editing ? `Edit ${contact.name}` : 'Add a contact'} onClose={onClose}
      footer={(
        <div className="btn-row">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} icon={busy ? 'clock' : undefined} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add contact'}</Button>
        </div>
      )}>
      <fieldset className="fieldset">
        <legend className="field__label" id="contact-type-label">Type</legend>
        <div className="type-grid" role="radiogroup" aria-labelledby="contact-type-label" onKeyDown={onTypeKey}>
          {CONTACT_TYPES.map((t, i) => (
            <button key={t.value} type="button" role="radio" aria-checked={type === t.value} tabIndex={type === t.value ? 0 : -1}
              ref={(el) => { typeRefs.current[i] = el; }}
              className={`type-chip${type === t.value ? ' is-active' : ''}`} onClick={() => setType(t.value)}>
              <Icon name={t.icon} size={22} /><span>{t.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Name" error={errors.name} id="contact-name">
        <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Pharmacy" maxLength={80}
          aria-invalid={!!errors.name} aria-describedby={errors.name ? 'contact-name-err' : undefined} />
      </Field>
      <Field label="Phone" error={errors.phone} id="contact-phone">
        <Input id="contact-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567" maxLength={40}
          aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'contact-phone-err' : undefined} />
      </Field>
      <div className="setting-row">
        <span className="setting-row__ic" aria-hidden="true"><Icon name="alert" size={22} /></span>
        <div className="setting-row__main">
          <div className="setting-row__t" id="contact-sos-label">Emergency contact</div>
          <div className="setting-row__d" id="contact-sos-desc">Shown first, with a big Call button. Nobody is contacted automatically.</div>
        </div>
        <Toggle checked={emergency} onChange={setEmergency} labelledBy="contact-sos-label" describedBy="contact-sos-desc" />
      </div>
      <Field label="Relationship (optional)" hint="For example: daughter, neighbour, family doctor.">
        <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} maxLength={40} />
      </Field>
      <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={80} /></Field>
      <Field label="Address"><Input autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} /></Field>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} /></Field>
    </Modal>
  );
}
