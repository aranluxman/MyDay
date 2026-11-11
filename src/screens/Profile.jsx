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
import { ageFromBirthday, prettyClock, prettyDate, shortDate } from '../lib/format.js';
import { GENDERS, genderLabel, heightWords, weightWords, allergyState, validateBody, cmToFtIn, kgToLb } from '../lib/healthLogs.js';
import { listMedications } from '../lib/db.js';
import { listAccountGuardians } from '../lib/guardianAccount.js';
import { THEMES, TEXT_SIZES, MODES, modeOf, themeForMode, profileCompleteness, currentTheme } from '../lib/appearance.js';
import { CONTACT_TYPES, validPhone, telHref } from '../lib/contacts.js';
import { HowToGuide } from './HowTo.jsx';
import { AlertsSettings } from '../components/AlertsSettings.jsx';
import { InstallButton } from '../components/InstallButton.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { deliveryStatus } from '../lib/notifications.js';
import { pushSupported } from '../lib/push.js';
import { platformTag } from '../lib/guardian.js';


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

// `only` shows one section as a page of its own (Contacts has its own place
// in the navigation), with no way "back to Settings" because it isn't in it.
export default function Profile({ only = null }) {
  const { user, profile, theme, resolvedTheme, setTheme, textSize, setTextSize, signOut, updateProfile, reloadProfile } = useApp();
  const { settings, set: setSetting } = useSettings();
  const ui = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [contactTab, setContactTab] = useState('family');
  const [careTab, setCareTab] = useState('mine');
  // People who invited this account to see their records (view-only).
  const supporting = useAsync(() => listAccountGuardians().catch(() => []), []);
  const completeness = profileCompleteness(profile);
  const { installed } = useInstallPrompt();
  // Whether THIS device can show alerts at all; the saved preference is a
  // separate thing and is shown inside Alerts & reminders.
  const deviceAlerts = deliveryStatus({
    supported: pushSupported(), installed, platform: platformTag(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  });

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
  const page = only || (PAGE_IDS[section] ? section : null);
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
    if (location.state?.editProfile) { setEditProfile(true); window.history.replaceState({}, ''); }
    if (location.state?.add === 'contact') { if (MEDICAL_TYPES.has(location.state.contactType)) setContactTab('medical'); setEditContact({ type: location.state.contactType }); window.history.replaceState({}, ''); }
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

  // Contacts in two views: the medical team (prescribers, pharmacies, clinics,
  // insurance) and everyone else. Every saved contact is in exactly one.
  const shownContacts = (contacts.data || []).filter((c) => MEDICAL_TYPES.has(c.type) === (contactTab === 'medical'));

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
    : THEMES.find((t) => t.id === currentTheme(theme))?.name || 'Green';
  const sizeName = TEXT_SIZES.find((t) => t.id === textSize)?.name || 'Normal';
  const access = [settings.highContrast && 'More contrast', settings.bold && 'Bold', settings.bigButtons && 'Bigger buttons', settings.calmMotion && 'Calm'].filter(Boolean);
  const connected = (guardians.data || []).filter((g) => g.deviceCount > 0).length;

  // One settings home with a short list; each row opens its own page with a
  // back button, so nothing is ever more than one tap deep.
  const pages = {
    access: { title: 'Accessibility', desc: 'Make MyDay easier to see and use.' },
    alerts: { title: 'Alerts & reminders', desc: 'When MyDay reminds you, and how it sounds.' },
    guardians: { title: 'Care team', desc: 'Who can see your records, and the people you support.' },
    contacts: { title: 'My contacts', desc: 'Family, doctor and pharmacy, one tap away.' },
    language: { title: 'Language', desc: 'Show MyDay in your language.' },
    appearance: { title: 'Appearance', desc: 'Light or dark, and your colour theme.' },
    info: { title: 'My information', desc: 'Your details, health and goals.' },
    health: { title: 'Health profile', desc: 'Your details, as you entered them. Every field is optional.' },
    howto: { title: 'How to use MyDay', desc: 'A step-by-step guide.' },
  };
  const current = page && pages[page];
  const languageName = (LANGUAGES.concat(MORE_LANGUAGES).find((l) => l.code === currentLanguage())?.name) || 'English';
  const contrastLevel = !settings.highContrast ? 'default' : settings.extraContrast ? 'extra' : 'high';

  if (current) {
    return (
      <div className="stack settings-page">
        <div className="settings-page__head">
          {!only && (
            <button type="button" className="settings-back" aria-label="Back to Settings" onClick={() => openPage(null)}>
              <Icon name="back" size={24} />
            </button>
          )}
          <div>
            {/* On its own page (Contacts) the top bar already names it. */}
            {!only && <h2 className="settings-page__t">{current.title}</h2>}
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
              <ThemeGrid themes={THEMES} theme={theme} setTheme={setTheme} />
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

        {page === 'guardians' && (
          <SegmentedControl label="Care team" value={careTab} onChange={setCareTab} options={[
            { value: 'mine', label: 'My caregivers' },
            { value: 'support', label: 'People I support' },
          ]} />
        )}
        {page === 'guardians' && careTab === 'support' && (
          <>
            <h3 className="settings-group">People I support</h3>
            {supporting.loading ? <Spinner label="" /> : supporting.error ? (
              <Card><p style={{ margin: '0 0 10px' }}>Could not load the people you support.</p><Button variant="ghost" onClick={supporting.reload}>Try again</Button></Card>
            ) : supporting.data?.length ? (
              <ul className="rd-list">
                {supporting.data.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="rd-row" onClick={() => navigate('/guardian', { state: { linkId: p.id } })}>
                      <span className="rd-row__ic" aria-hidden="true"><Icon name="user" size={24} /></span>
                      <span className="rd-row__main"><span className="rd-row__t" translate="no">{p.name}</span><span className="rd-row__d">View-only · their medicine records and appointments</span></span>
                      <Icon name="chevron" size={22} className="rd-row__chev" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Card><p style={{ margin: 0 }}>You are not supporting anyone yet.</p></Card>}
            {supporting.data?.length > 0 && <Button icon="users" size="lg" onClick={() => navigate('/guardian')}>Open caregiver dashboard</Button>}
            <Button variant={supporting.data?.length ? 'ghost' : 'primary'} icon="plus" size="lg" onClick={() => navigate('/guardian')}>Add someone with their code</Button>
            <p className="settings-note settings-note--lock"><Icon name="lock" size={22} />
              <span><b>You cannot add a person yourself.</b> They invite you from their own MyDay and read you a 6-digit code.
              Your access is view-only: you cannot record a dose or change their medicines or appointments, and they can remove you at any time.</span></p>
          </>
        )}
        {page === 'guardians' && careTab === 'mine' && <>
        {guardians.data && !connected && (
          <p className="g-banner" role="status"><Icon name="shield" size={22} />
            <span><b>No one gets an alert yet when a dose has no record.</b><br />Add a family guardian to turn on safety alerts.</span></p>
        )}
        <FamilyPicture />
        <p className="g-lead">
          A guardian is someone in your family who can check on their own phone or tablet whether your doses
          have been recorded, and gets an alert when one has no record. They don't need an account. You choose who can see your information.
        </p>
        <Button icon="plus" size="lg" onClick={() => setInviteOpen(true)}>Invite a guardian</Button>
        <Button variant="soft" icon="user" size="lg" onClick={() => setCareTab('support')}>Become a guardian</Button>
        <p className="muted" style={{ margin: 0, fontSize: 16 }}>
          <b>Become a guardian</b> if a family member gave you their 6-digit code, so you can check on their medicines.
        </p>
        <p className="settings-note settings-note--lock"><Icon name="lock" size={22} />
          <span><b>Guardians can only look.</b> They can never change your medicines or appointments, and can never
          mark a dose as taken. MyDay never calls anyone for you.</span></p>
        {guardians.data?.length ? (
          <>
            <h3 className="settings-group">Your guardians</h3>
            <Card>
              <div className="guardian-list">
                {guardians.data.map((g) => (
                  <GuardianRow key={g.id} guardian={g}
                    onShowCode={() => newCode(g)}
                    onRevokeDevice={(d) => revokeDevice(g, d)}
                    onToggleDiary={(v) => toggleDiary(g, v)}
                    onRemove={() => removeGuardian(g)} />
                ))}
              </div>
            </Card>
          </>
        ) : null}
        </>}

        {page === 'contacts' && <>
        <SegmentedControl label="Which contacts" value={contactTab} onChange={setContactTab} options={[
          { value: 'family', label: 'Family' },
          { value: 'medical', label: 'Medical team' },
        ]} />
        <Card className="pref-list">
          {CONTACT_KINDS.filter((k) => k.group === contactTab).map((k) => (
            <button key={k.id} type="button" className="kind-row" onClick={() => setEditContact({ type: k.type, emergency: k.emergency })}>
              <span className={`kind-row__ic kind-row__ic--${k.tone}`} aria-hidden="true"><Icon name={k.icon} size={24} /></span>
              <span className="kind-row__main"><span className="kind-row__t">{k.title}</span><span className="kind-row__d">{k.desc}</span></span>
              <Icon name="chevron" size={22} />
            </button>
          ))}
        </Card>
        <Button icon="plus" size="lg" onClick={() => setEditContact({ type: contactTab === 'medical' ? 'provider' : 'other' })}>Add a contact</Button>
        {shownContacts.length > 0 && <h3 className="settings-group">{contactTab === 'medical' ? 'Saved medical team' : 'Saved family and others'}</h3>}
        <Card>
        {contacts.loading ? <Spinner label="" /> : !shownContacts.length ? (
          <EmptyState>{contactTab === 'medical'
            ? 'Add your prescriber, pharmacy and clinic so they are one tap away.'
            : 'Add family, an emergency contact and others so they are one tap away.'}</EmptyState>
        ) : (
          <ul className="stack contact-list">
            {[...shownContacts].sort((a, b) => Number(!!b.is_emergency) - Number(!!a.is_emergency)).map((c) => {
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
              </Card>
        </>}

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
            <Card className="pref-card">
              <div className="pref-card__head"><span className="pref-card__ic"><Icon name="sun" size={22} /></span>
                <div><h3 className="pref-card__t">Colour theme</h3><div className="pref-card__d">Every page uses the colour you pick.</div></div></div>
              <ThemeGrid themes={THEMES} theme={theme} setTheme={setTheme} />
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

        {page === 'health' && <HealthProfile profile={profile} age={age} onEdit={() => setEditProfile(true)} />}

        {page === 'info' && (
          <>
      {completeness.missing.length > 0 && (
        <Card>
          <div className="progress-card">
            <div className="progress-card__main">
              <div className="progress-card__t">{completeness.done} of {completeness.total} details entered</div>
              <div className="progress-card__d">These are optional. Add what you want MyDay to know.</div>
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
          <button type="button" className="me-card__edit" onClick={() => openPage('health')}>
            <Icon name="heart" size={18} /> View health profile
          </button>
        </div>
      </Card>

      <h2 className="rd-group">Personal</h2>
      <ul className="rd-list">
        <SettingsLink icon="heart" title="Health profile" desc="Name, birth date, height, weight, allergies" onClick={() => openPage('health')} />
        <SettingsLink icon="users" title="Dependants & caregivers"
          desc={!guardians.data ? 'Guardians and people you support' : !connected ? 'No guardian connected yet' : `${connected} guardian${connected === 1 ? '' : 's'} connected`}
          warn={!!guardians.data && !connected} onClick={() => openPage('guardians')} />
        <SettingsLink icon="phone" title="My contacts" desc={contacts.data?.length ? `${contacts.data.length} saved` : 'Family, doctor and pharmacy'} onClick={() => navigate('/contacts')} />
      </ul>

      <h2 className="rd-group">Preferences</h2>
      <ul className="rd-list">
        <SettingsLink icon="eye" title="Accessibility" desc="Text size, contrast, buttons" value={sizeName} onClick={() => openPage('access')} />
        <SettingsLink icon="bell" title="Alerts & reminders" desc={deviceAlerts.ok ? 'Notifications and sound' : 'Device setup needed'} warn={!deviceAlerts.ok} onClick={() => openPage('alerts')} />
        <SettingsLink icon="sun" title="Appearance" desc={`${themeName} theme`} onClick={() => openPage('appearance')} />
        <SettingsLink icon="globe" title="Language" desc="Show MyDay in your language" value={languageName} onClick={() => openPage('language')} />
      </ul>

      <h2 className="rd-group">Help</h2>
      <ul className="rd-list">
        <SettingsLink icon="help" title="How to use MyDay" desc="Step-by-step guide" onClick={() => openPage('howto')} />
      </ul>
      {/* Adding MyDay to the home screen lives here now, not in the top bar.
          The button shows only where this device can still install it. */}
      <InstallButton className="btn btn--soft btn--md btn--full" label="Add MyDay to this device" iconSize={20} />

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
        onSaved={async (patch) => { await updateProfile(patch); await reloadProfile(); setEditProfile(false); ui.toast('Saved. Your health profile is up to date.'); }} />}
      {editContact && <ContactForm contact={editContact.id ? editContact : null} initialType={editContact.type} initialEmergency={editContact.emergency} onClose={() => setEditContact(null)}
        onSaved={() => { setEditContact(null); contacts.reload(); }} />}
      </>
    );
  }
}

// Three generations around a bell: a grandparent, a parent and a grandchild.
// Drawn here rather than shipped as an image, so it suits every theme.
function FamilyPicture() {
  const face = '#f3c9a6';
  return (
    <svg className="family-pic" viewBox="0 0 320 170" role="img" aria-label="A grandparent, a parent and a grandchild together">
      <ellipse cx="160" cy="160" rx="150" ry="10" fill="var(--surface-2)" />
      {/* grandparent */}
      <path d="M40 165c0-40 18-58 50-58s50 18 50 58z" fill="#9db3c9" />
      <circle cx="90" cy="78" r="30" fill={face} />
      <path d="M60 74c0-22 14-34 30-34s30 12 30 34c-6-10-16-14-30-14s-24 4-30 14z" fill="#e8e8ea" />
      <circle cx="80" cy="80" r="7" fill="none" stroke="#4b5563" strokeWidth="2.5" /><circle cx="100" cy="80" r="7" fill="none" stroke="#4b5563" strokeWidth="2.5" />
      <path d="M87 80h6" stroke="#4b5563" strokeWidth="2.5" /><path d="M82 94q8 6 16 0" stroke="#7c4a2d" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* parent */}
      <path d="M110 165c0-48 20-68 50-68s50 20 50 68z" fill="var(--primary)" />
      <circle cx="160" cy="66" r="31" fill={face} />
      <path d="M127 70c-4-30 12-46 33-46s38 16 33 46c-2-16-12-26-33-26s-31 10-33 26z" fill="#1f2a44" />
      <circle cx="150" cy="70" r="3" fill="#1f2a44" /><circle cx="170" cy="70" r="3" fill="#1f2a44" />
      <path d="M151 82q9 7 18 0" stroke="#7c4a2d" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* grandchild */}
      <path d="M190 165c0-38 16-54 42-54s42 16 42 54z" fill="#2f9e6e" />
      <circle cx="232" cy="88" r="26" fill={face} />
      <path d="M206 86c0-18 11-28 26-28s26 10 26 28c-6-8-14-12-26-12s-20 4-26 12z" fill="#5b3a29" />
      <circle cx="224" cy="90" r="2.6" fill="#1f2a44" /><circle cx="240" cy="90" r="2.6" fill="#1f2a44" />
      <path d="M225 100q7 5 14 0" stroke="#7c4a2d" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* bell */}
      <circle cx="160" cy="138" r="22" fill="var(--surface)" stroke="var(--primary)" strokeWidth="3" />
      <path d="M152 145v-7a8 8 0 0116 0v7l3 3h-22zM157 151a3 3 0 006 0" fill="none" stroke="var(--primary)" strokeWidth="2.6" strokeLinejoin="round" />
    </svg>
  );
}

// The quick ways to add a contact, as on the My contacts page.
const MEDICAL_TYPES = new Set(['provider', 'pharmacy', 'clinic', 'insurance']);
const CONTACT_KINDS = [
  { id: 'family', group: 'family', title: 'Family', desc: 'Add family members', icon: 'user', tone: 'blue', type: 'other' },
  { id: 'sos', group: 'family', title: 'Emergency contact', desc: 'Add an emergency contact', icon: 'phone', tone: 'rose', type: 'other', emergency: true },
  { id: 'other', group: 'family', title: 'Other contact', desc: 'Add another contact', icon: 'more', tone: 'grey', type: 'other' },
  { id: 'doctor', group: 'medical', title: 'Prescribers', desc: 'Add your doctor or prescriber', icon: 'stethoscope', tone: 'teal', type: 'provider' },
  { id: 'pharmacy', group: 'medical', title: 'Pharmacies', desc: 'Add your pharmacy', icon: 'pill', tone: 'red', type: 'pharmacy' },
  { id: 'clinic', group: 'medical', title: 'Medical facilities', desc: 'Add a clinic or hospital', icon: 'building', tone: 'blue', type: 'clinic' },
];

// Health profile: what the person has entered, read back plainly. A blank is
// shown as "Not entered" (never guessed), and there is no percentage score:
// the count says how many of the listed details have an answer.
function HealthProfile({ profile, age, onEdit }) {
  const navigate = useNavigate();
  const meds = useAsync(() => listMedications(), []);
  const active = (meds.data || []).filter((m) => m.active !== false);
  const allergy = allergyState(profile);
  const rows = [
    { label: 'Name', value: profile?.full_name || null, keep: true },
    { label: 'Birth date', value: profile?.birthday ? `${prettyDate(profile.birthday)}${age != null ? ` (${age} years)` : ''}` : (age != null ? `Age ${age} (no birth date)` : null), answered: !!profile?.birthday },
    { label: 'Gender', value: genderLabel(profile?.gender) },
    { label: 'Height', value: heightWords(profile?.height_cm, profile?.height_unit) },
    { label: 'Weight', value: weightWords(profile?.weight_kg, profile?.weight_unit) },
    { label: 'Conditions', value: profile?.conditions || null },
    { label: 'Allergies', value: allergy.state === 'missing' ? null : allergy.text },
  ];
  const entered = rows.filter((r) => (r.answered ?? r.value != null)).length;
  return (
    <>
      <div className="hp-top">
        <p className="hp-count" role="status">{entered} of {rows.length} details entered</p>
        <Button variant="ghost" icon="edit" full={false} onClick={onEdit}>Edit</Button>
      </div>
      <dl className="rd-list hp-list">
        {rows.map((r) => (
          <div key={r.label} className="hp-row">
            <dt>{r.label}</dt>
            <dd className={r.value == null ? 'hp-row__none' : undefined} translate={r.keep ? 'no' : undefined}>{r.value ?? 'Not entered'}</dd>
          </div>
        ))}
      </dl>
      <ul className="rd-list">
        <SettingsLink icon="pill" title="Medicines"
          desc={meds.loading ? 'Loading…' : meds.error ? 'Could not load' : `${active.length} with a schedule in MyDay`}
          onClick={() => navigate('/medication')} />
        <SettingsLink icon="heartPulse" title="Health tracker" desc="Water, sleep and measurements" onClick={() => navigate('/health')} />
      </ul>
      {profile?.goal && (
        <Card><h3 className="hp-h">What I’m working toward</h3><p className="hp-p">{profile.goal}</p></Card>
      )}
      {profile?.on_treatment && (
        <Card><h3 className="hp-h">Other medicines &amp; supplements</h3><p className="hp-p">{profile.on_treatment}</p></Card>
      )}
      <p className="health-note"><Icon name="lock" size={20} />
        <span>Only you can see and change this. Guardians cannot see your health profile.</span></p>
    </>
  );
}

// One row of the Settings list: icon, title, a line of detail, and (where it
// helps) the current choice on the right.
function SettingsLink({ icon, title, desc, value, warn, onClick }) {
  return (
    <li>
      <button type="button" className="rd-row" onClick={onClick}>
        <span className="rd-row__ic" aria-hidden="true"><Icon name={icon} size={24} /></span>
        <span className="rd-row__main">
          <span className="rd-row__t">{title}</span>
          {desc && <span className={`rd-row__d${warn ? ' rd-row__d--warn' : ''}`}>{desc}</span>}
        </span>
        {value && <span className="rd-row__v">{value}</span>}
        <Icon name="chevron" size={22} className="rd-row__chev" />
      </button>
    </li>
  );
}

const PAGE_IDS = { health: 1, access: 1, alerts: 1, guardians: 1, contacts: 1, language: 1, appearance: 1, info: 1, howto: 1 };

// The three everyday themes as big pictures: a sunny sky, a night sky, a
// warm sunset. Easier to choose between than small colour swatches.
// The colour theme picker: a preview swatch per theme.
function ThemeGrid({ themes, theme, setTheme }) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Colour theme">
      {themes.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={currentTheme(theme) === t.id}
          className={`theme-swatch${currentTheme(theme) === t.id ? ' is-active' : ''}`} onClick={() => setTheme(t.id)}>
          <span className="theme-swatch__preview" style={{ background: t.bg, color: t.ink }} aria-hidden="true">
            <span className="theme-swatch__bar" style={{ background: t.ink, opacity: 0.18 }} />
            <span className="theme-swatch__bar theme-swatch__bar--short" style={{ background: t.ink, opacity: 0.12 }} />
            <span className="theme-swatch__btn" style={{ background: t.primary }} />
          </span>
          <span className="theme-swatch__name">{t.name}{currentTheme(theme) === t.id ? ' ✓' : ''}</span>
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
              ? <><Icon name="check" size={16} /> Accepted · {g.deviceCount} device{g.deviceCount === 1 ? '' : 's'} connected</>
              : <><Icon name="clock" size={16} /> Invitation pending · not connected yet</>}
          </div>
          <div className="guardian__seen">{connected ? 'Can view' : 'Will be able to view'}: medicine records and appointments{g.share_diary ? ', diary notes' : ''}. View-only.</div>
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
            <li className="g-can__yes"><Icon name="check" size={18} /> Today's medicines and whether each has been recorded</li>
            <li className="g-can__yes"><Icon name="check" size={18} /> Your upcoming appointments</li>
            <li className="g-can__yes"><Icon name="check" size={18} /> Your history of recorded and unrecorded doses</li>
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
  const [age, setAge] = useState(() => {
    if (profile?.age != null) return String(profile.age);
    const a = ageFromBirthday(profile?.birthday);
    return a != null ? String(a) : '';
  });
  const [for_whom, setForWhom] = useState(profile?.for_whom || '');
  const [on_treatment, setOn] = useState(profile?.on_treatment || '');
  const [goal, setGoal] = useState(profile?.goal || '');
  const [gender, setGender] = useState(profile?.gender || '');
  const [heightUnit, setHeightUnit] = useState(profile?.height_unit === 'ft_in' ? 'ft_in' : 'cm');
  const [weightUnit, setWeightUnit] = useState(profile?.weight_unit === 'lb' ? 'lb' : 'kg');
  const startFt = profile?.height_cm != null ? cmToFtIn(Number(profile.height_cm)) : null;
  const [heightCm, setHeightCm] = useState(profile?.height_cm != null ? String(Number(profile.height_cm)) : '');
  const [heightFt, setHeightFt] = useState(startFt ? String(startFt.ft) : '');
  const [heightIn, setHeightIn] = useState(startFt ? String(startFt.inches) : '');
  const [weight, setWeight] = useState(profile?.weight_kg != null
    ? String(profile?.weight_unit === 'lb' ? kgToLb(Number(profile.weight_kg)) : Number(profile.weight_kg)) : '');
  const [conditions, setConditions] = useState(profile?.conditions || '');
  const [allergies, setAllergies] = useState(profile?.allergies || '');
  const [allergiesNone, setAllergiesNone] = useState(!!profile?.allergies_none);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    const next = {};
    if (birthday && (birthday > today || birthday < '1900-01-01')) next.birthday = 'Please check the birth date. It cannot be in the future.';
    const body = validateBody({ heightUnit, heightCm, heightFt, heightIn, weightUnit, weight });
    Object.assign(next, body.errors);
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(next.birthday ? 'hp-birthday' : next.height ? 'hp-height' : 'hp-weight')?.focus();
      return;
    }
    setBusy(true);
    // Age comes from the birth date whenever there is one.
    const derived = ageFromBirthday(birthday);
    const patch = {
      full_name: full_name.trim() || null,
      birthday: birthday || null,
      age: derived != null ? derived : age ? Math.max(0, Math.min(130, parseInt(age, 10) || 0)) : null,
      for_whom: for_whom || null,
      on_treatment: on_treatment.trim() || null,
      goal: goal.trim() || null,
      gender: gender || null,
      height_cm: body.values.height_cm,
      weight_kg: body.values.weight_kg,
      height_unit: heightUnit,
      weight_unit: weightUnit,
      conditions: conditions.trim() || null,
      // "No known allergies" is an answer; a list replaces it.
      allergies: allergiesNone ? null : allergies.trim() || null,
      allergies_none: allergiesNone,
    };
    try { await onSaved(patch); }
    catch (e) { ui.toast(e?.message || 'Could not save. Your changes were not saved.', 'bad'); setBusy(false); }
  }

  // Medicines are kept as one comma-separated line, shown as chips.
  const meds = on_treatment.split(',').map((m) => m.trim()).filter(Boolean);
  const [adding, setAdding] = useState('');
  function addMed() {
    const m = adding.trim();
    if (!m) return;
    setOn([...meds, m].join(', '));
    setAdding('');
  }
  function onBirthday(v) {
    setBirthday(v);
    const a = ageFromBirthday(v);
    if (a != null) setAge(String(a));
  }

  return (
    <Modal title="Edit health profile" onClose={onClose}
      footer={(
        <div className="btn-row">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} icon={busy ? 'clock' : undefined} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}>
      <p className="muted" style={{ margin: '0 0 14px' }}>Every field is optional. Leave anything blank that you would rather not enter.</p>
      <div className="about-rows">
        <label className="about-row"><span className="about-row__l"><Icon name="user" size={22} /> Name</span>
          <Input value={full_name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" /></label>
        <label className="about-row"><span className="about-row__l"><Icon name="calendar" size={22} /> Birth date</span>
          <span className="about-row__age"><Input id="hp-birthday" type="date" value={birthday} max={today} onChange={(e) => onBirthday(e.target.value)}
            aria-invalid={errors.birthday ? 'true' : undefined} aria-describedby={errors.birthday ? 'hp-birthday-err' : undefined} />
            {errors.birthday && <span className="field__err" id="hp-birthday-err" role="alert">{errors.birthday}</span>}</span></label>
        {birthday ? (
          <p className="about-row about-row--static"><span className="about-row__l"><Icon name="clock" size={22} /> Age</span>
            <span>{ageFromBirthday(birthday) != null ? `${ageFromBirthday(birthday)} years, from your birth date` : 'Check the birth date'}</span></p>
        ) : (
          <label className="about-row"><span className="about-row__l"><Icon name="clock" size={22} /> Age</span>
            <span className="about-row__age"><Input type="number" min="0" max="130" value={age} onChange={(e) => setAge(e.target.value)} />
              <small className="muted">Add a birth date and MyDay works this out for you.</small></span></label>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="hp-gender">Gender</label>
        <select id="hp-gender" className="input input--select" value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Not entered</option>
          {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </div>

      <div className="field">
        <span className="field__label" id="hp-height-l">Height</span>
        <SegmentedControl label="Height unit" value={heightUnit} onChange={setHeightUnit} options={[{ value: 'cm', label: 'cm' }, { value: 'ft_in', label: 'ft and in' }]} />
        {heightUnit === 'cm' ? (
          <Input id="hp-height" inputMode="decimal" aria-label="Height in centimetres" value={heightCm} onChange={(e) => setHeightCm(e.target.value)}
            aria-invalid={errors.height ? 'true' : undefined} aria-describedby={errors.height ? 'hp-height-err' : undefined} placeholder="for example 165" />
        ) : (
          <div className="hl-pair">
            <Input id="hp-height" inputMode="numeric" aria-label="Height, feet" value={heightFt} onChange={(e) => setHeightFt(e.target.value)}
              aria-invalid={errors.height ? 'true' : undefined} aria-describedby={errors.height ? 'hp-height-err' : undefined} placeholder="feet" />
            <Input inputMode="numeric" aria-label="Height, inches" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} placeholder="inches" />
          </div>
        )}
        {errors.height && <span className="field__err" id="hp-height-err" role="alert">{errors.height}</span>}
      </div>

      <div className="field">
        <span className="field__label" id="hp-weight-l">Weight</span>
        <SegmentedControl label="Weight unit" value={weightUnit} onChange={setWeightUnit} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
        <Input id="hp-weight" inputMode="decimal" aria-label={`Weight in ${weightUnit === 'lb' ? 'pounds' : 'kilograms'}`} value={weight} onChange={(e) => setWeight(e.target.value)}
          aria-invalid={errors.weight ? 'true' : undefined} aria-describedby={errors.weight ? 'hp-weight-err' : undefined} placeholder={weightUnit === 'lb' ? 'for example 150' : 'for example 68'} />
        {errors.weight && <span className="field__err" id="hp-weight-err" role="alert">{errors.weight}</span>}
      </div>

      <Field label="Health conditions" hint="For example: high blood pressure, diabetes. Leave blank if you prefer.">
        <Textarea rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} maxLength={500} /></Field>

      <div className="field">
        <label className="field__label" htmlFor="hp-allergies">Allergies</label>
        <label className="rep-check">
          <input type="checkbox" checked={allergiesNone} onChange={(e) => setAllergiesNone(e.target.checked)} />
          <span>No known allergies</span>
        </label>
        {!allergiesNone && (
          <Textarea id="hp-allergies" rows={2} value={allergies} onChange={(e) => setAllergies(e.target.value)} maxLength={500}
            placeholder="For example: penicillin, peanuts" />
        )}
        <span className="field__hint">Blank means “Not entered”, which is different from “No known allergies”.</span>
      </div>
      <p className="about-h" id="about-whom">Who is MyDay for?</p>
      <div className="about-whom" role="radiogroup" aria-labelledby="about-whom">
        {WHOM_OPTS.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={for_whom === o.value}
            className={`about-whom__b${for_whom === o.value ? ' is-on' : ''}`} onClick={() => setForWhom(o.value)}>{o.label}</button>
        ))}
      </div>
      <p className="about-h" id="about-meds">Other medicines &amp; supplements</p>
      <p className="muted" style={{ margin: '-4px 0 8px', fontSize: 16 }}>A plain list for your own reference. Medicines with reminders are on the Medicines page.</p>
      <div className="about-chips" aria-labelledby="about-meds">
        {meds.map((m, i) => (
          <span key={`${m}-${i}`} className="about-chip">{m}
            <button type="button" aria-label={`Remove ${m}`} onClick={() => setOn(meds.filter((_, k) => k !== i).join(', '))}>×</button></span>
        ))}
        <span className="about-add">
          <input className="about-add__in" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Type a medicine"
            aria-label="Add a medicine or supplement" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMed(); } }} maxLength={60} />
          <button type="button" className="about-add__b" onClick={addMed}><Icon name="plus" size={18} /> Add</button>
        </span>
      </div>
      <Field label="What I'm working toward" hint="Your health goals."><Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} /></Field>
    </Modal>
  );
}

function ContactForm({ contact, initialType, initialEmergency, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!contact;
  const [type, setType] = useState(contact?.type || initialType || 'pharmacy');
  const [name, setName] = useState(contact?.name || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [address, setAddress] = useState(contact?.address || '');
  const [notes, setNotes] = useState(contact?.notes || '');
  const [relationship, setRelationship] = useState(contact?.relationship || '');
  const [emergency, setEmergency] = useState(!!(contact?.is_emergency ?? initialEmergency));
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
