import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, Modal, Field, Input, Textarea, EmptyState, SegmentedControl, Avatar, Toggle, Collapsible } from '../components/ui.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { listContacts, saveContact, deleteContact, listFamilyDevices, saveFamilyDevice, uploadAvatar,
  createGuardianInvite, listGuardians, deleteGuardian, formatGuardianCode, issueGuardianCode, revokeGuardianDevice, setGuardianShareDiary } from '../lib/db.js';
import { supabase } from '../lib/supabase.js';
import { deviceLabel } from '../lib/guardian.js';
import { pushSupported, enablePush } from '../lib/push.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { InstallButton } from '../components/InstallButton.jsx';
import { LANGUAGES, MORE_LANGUAGES, currentLanguage, setLanguage } from '../lib/translate.js';
import { ageFromBirthday, prettyClock, shortDate } from '../lib/format.js';
import { THEMES, TEXT_SIZES, profileCompleteness } from '../lib/appearance.js';
import { CONTACT_TYPES, validPhone, telHref } from '../lib/contacts.js';


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

const SECTION_IDS = ['guardians', 'language', 'alerts', 'info', 'health', 'explore', 'contacts', 'appearance', 'access', 'more'];

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
const ALERT_WINDOWS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
];

export default function Profile() {
  const { user, profile, theme, setTheme, textSize, setTextSize, signOut, updateProfile, reloadProfile } = useApp();
  const { settings, set: setSetting } = useSettings();
  const ui = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [savingWindow, setSavingWindow] = useState(false);
  const completeness = profileCompleteness(profile);
  const alertWindow = profile?.alert_window_minutes ?? 60;

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
  const devices = useAsync(() => (pushSupported() ? listFamilyDevices() : Promise.resolve([])), []);
  const guardians = useAsync(() => listGuardians(), []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [busyInvite, setBusyInvite] = useState(false);

  useEffect(() => {
    if (location.state?.add === 'contact') { setEditContact({}); window.history.replaceState({}, ''); }
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

  async function setAlertWindow(minutes) {
    setSavingWindow(true);
    try { await updateProfile({ alert_window_minutes: minutes }); ui.toast('Alert timing saved.'); }
    catch { ui.toast('Could not save the setting.', 'bad'); }
    setSavingWindow(false);
  }
  async function onSignOut() {
    const ok = await ui.confirm({ title: 'Sign out', message: 'Sign out of MyDay on this phone?', confirmLabel: 'Sign out' });
    if (ok) await signOut();
  }
  async function removeContact(c) {
    const ok = await ui.confirm({ title: 'Remove contact', message: `Remove ${c.name}?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { await deleteContact(c.id); ui.toast('Removed.', 'info'); contacts.reload(); } catch { ui.toast('Could not remove.', 'bad'); }
  }
  async function enableAlerts() {
    try {
      const sub = await enablePush();
      await saveFamilyDevice(deviceLabel(), sub);
      ui.toast('Alerts are on for this phone.');
      devices.reload();
    } catch (e) { ui.toast(e.message || 'Could not turn on alerts.', 'bad'); }
  }
  async function testAlert() {
    try {
      const { data, error } = await supabase.functions.invoke('missed-dose-check', { body: { test: true } });
      if (error || data?.error) throw new Error();
      ui.toast('Test alert sent.', 'info');
    } catch { ui.toast('Could not send a test alert.', 'bad'); }
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

  // Folding: every section below can shrink to one line with a summary. Once
  // the profile is complete they start folded, and "Minimize all" / "Show
  // all" folds or opens them in one tap. Each remembers its own state.
  const setUp = completeness.pct === 100;
  const [foldKey, setFoldKey] = useState(0);
  const [allOpen, setAllOpen] = useState(() => {
    try { return SECTION_IDS.some((id) => localStorage.getItem(`myday_section_${id}`) === '1'); } catch { return !setUp; }
  });
  function foldAll(open) {
    try { SECTION_IDS.forEach((id) => localStorage.setItem(`myday_section_${id}`, open ? '1' : '0')); } catch {}
    setAllOpen(open);
    setFoldKey((k) => k + 1);
  }
  const themeName = THEMES.find((t) => t.id === theme)?.name || 'Light';
  const sizeName = TEXT_SIZES.find((t) => t.id === textSize)?.name || 'Normal';
  const access = [settings.highContrast && 'More contrast', settings.bold && 'Bold', settings.bigButtons && 'Bigger buttons', settings.calmMotion && 'Calm'].filter(Boolean);
  const connected = (guardians.data || []).filter((g) => g.deviceCount > 0).length;
  const fold = { defaultOpen: !setUp, onToggle: (open) => open && setAllOpen(true) };

  return (
    <div className="stack">
      {/* identity — tap to view and edit your details */}
      <Card>
        <div className="account-card">
          <div className="avatar-edit">
            <Avatar name={profile?.full_name} color={profile?.avatar_color} size={64} src={profile?.avatar_url} />
            <button type="button" className="avatar-edit__btn" aria-label="Change profile photo" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Icon name={uploading ? 'clock' : 'plus'} size={16} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
          </div>
          <button type="button" className="account-card__main account-card__btn" onClick={() => setEditProfile(true)}>
            <span className="account-card__name">{profile?.full_name || 'Your profile'}</span>
            <span className="account-card__sub">{age != null ? `${age} years old — tap to view and edit` : 'View and manage your profile'}</span>
          </button>
          <Icon name="chevron" size={24} />
        </div>
      </Card>

      <div className="fold-bar">
        <span className="fold-bar__t">{allOpen ? 'Settings' : 'Settings — tap a section to open it'}</span>
        <Button variant="ghost" size="sm" full={false} icon={allOpen ? 'minus' : 'plus'} onClick={() => foldAll(!allOpen)}>
          {allOpen ? 'Minimize all' : 'Show all'}
        </Button>
      </div>

      <div className="stack" key={foldKey}>
      {/* guardians — high up: the family link is what keeps someone safe */}
      <Collapsible id="guardians" icon="user" title="Guardians" {...fold}
        summary={guardians.data?.length ? `${guardians.data.length} added · ${connected} connected` : 'No guardian yet'}>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          A guardian is someone in your family who can check on their own phone or tablet whether you have
          taken your medicines, and gets an alert if you miss one. Tap <b>Show code</b> and read them the
          6-digit code — it works for 15 minutes and once only. They don't need an account.
        </p>
        <Button icon="plus" onClick={() => setInviteOpen(true)}>Invite a guardian</Button>
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
      </Collapsible>

      {/* language — near the top, because someone who can't read English
          can't go looking for it further down */}
      <Collapsible id="language" icon="globe" title="Language" {...fold}
        summary={(LANGUAGES.concat(MORE_LANGUAGES).find((l) => l.code === currentLanguage())?.name) || 'English'}>
        <label className="muted" htmlFor="lang-select" style={{ display: 'block', margin: '0 0 10px' }}>Show MyDay in your language. The page reloads once.</label>
        <select id="lang-select" className="lang-select notranslate input input--select" translate="no" value={currentLanguage()}
          onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.en ? `${l.name} — ${l.en}` : l.name}</option>)}
          <optgroup label="More languages">
            {MORE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{`${l.name} — ${l.en}`}</option>)}
          </optgroup>
        </select>
      </Collapsible>

      {/* alerts */}
      <Collapsible id="alerts" icon="bell" title="Alerts and reminders" {...fold}
        summary={`Missed after ${ALERT_WINDOWS.find((w) => w.value === alertWindow)?.label || `${alertWindow} min`}${devices.data?.length ? ` · ${devices.data.length} device${devices.data.length === 1 ? '' : 's'}` : ''}`}>
        <MenuRow icon="bell" title="Notification settings"
          desc="Turn alerts on, choose what you are told about, and set quiet hours"
          onClick={() => navigate('/profile/notifications')} />
        <div style={{ height: 10 }} />
        <p className="muted" id="alert-window-label" style={{ margin: '0 0 6px', fontWeight: 600 }}>Alert me after a dose is late by</p>
        <SegmentedControl label="Alert me after a dose is late by" value={alertWindow} onChange={savingWindow ? () => {} : setAlertWindow}
          options={ALERT_WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
        <div style={{ height: 14 }} />
        <AlertsEnabler devices={devices} onEnable={enableAlerts} onTest={testAlert} />
      </Collapsible>

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

      {/* Three named groups rather than one list of seven. */}
      <Collapsible id="info" icon="user" title="My information" {...fold} summary="Name, birthday, health and goals">
        <div className="menu-list">
          <MenuRow icon="user" title="Personal information" desc="Your name, birthday and more" onClick={() => setEditProfile(true)} />
          <MenuRow icon="cross" title="Health information" desc="Medications, supplements and conditions" onClick={() => setEditProfile(true)} />
          <MenuRow icon="star" title="Health goals" desc="Set and track what you're working toward" onClick={() => setEditProfile(true)} />
        </div>
      </Collapsible>

      <Collapsible id="health" icon="pill" title="My health" {...fold} summary="Medicines and cards">
        <div className="menu-list">
          <MenuRow icon="pill" title="My medicines" desc="Manage your medicines and times" onClick={() => navigate('/medication', { state: { view: 'medicines' } })} />
          <MenuRow icon="cross" title="My cards" desc="Health card, insurance and other cards" onClick={() => navigate('/cards')} />
        </div>
      </Collapsible>

      <Collapsible id="explore" icon="star" title="Explore" {...fold} summary="Guide and brain games">
        <div className="menu-list">
          <MenuRow icon="info" title="How to use MyDay" desc="A simple step-by-step guide to every part of the app" onClick={() => navigate('/help')} />
          <MenuRow icon="brain" title="Brain Games" desc="Play games and see your progress" onClick={() => navigate('/games')} />
        </div>
      </Collapsible>

      {/* contacts — vertical list, never scrolls sideways */}
      <Collapsible id="contacts" icon="phone" title="My contacts" {...fold}
        summary={contacts.data?.length ? `${contacts.data.length} saved${contacts.data.some((c) => c.is_emergency) ? ' · emergency contact set' : ''}` : 'None yet'}>
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
      </Collapsible>

      {/* appearance */}
      <Collapsible id="appearance" icon="sun" title="Appearance" {...fold} summary={`${themeName} theme`}>
        <p className="muted" id="theme-label" style={{ margin: '0 0 12px' }}>Pick a look that's comfortable for you.</p>
        <div className="theme-grid" role="radiogroup" aria-labelledby="theme-label">
          {THEMES.map((t) => (
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
      </Collapsible>

      {/* accessibility — bigger text, more contrast, easier reading */}
      <Collapsible id="access" icon="eye" title="Accessibility" {...fold} summary={[`${sizeName} text`, ...access].join(' · ')}>
        <p className="muted" style={{ margin: '0 0 4px' }}>Make MyDay easier to see and use — changes apply straight away.</p>
        <SettingRow icon="notes" title="Text size" desc="Make everything on screen bigger." stacked>
          <SegmentedControl label="Text size" value={textSize} onChange={setTextSize} options={TEXT_SIZES.map((s) => ({ value: s.id, label: s.name }))} />
          <p className="size-preview">Sample: today's medicine is ready.</p>
        </SettingRow>
        <SettingRow icon="sun" title="More contrast" desc="Stronger text and outlines, in any theme.">
          <Toggle checked={settings.highContrast} onChange={(v) => setSetting({ highContrast: v })} label="More contrast" />
        </SettingRow>
        <SettingRow icon="edit" title="Bold text" desc="Thicker letters that are easier to read.">
          <Toggle checked={settings.bold} onChange={(v) => setSetting({ bold: v })} label="Bold text" />
        </SettingRow>
        <SettingRow icon="plus" title="Bigger buttons" desc="Even larger tap targets for steadier pressing.">
          <Toggle checked={settings.bigButtons} onChange={(v) => setSetting({ bigButtons: v })} label="Bigger buttons" />
        </SettingRow>
        <SettingRow icon="moon" title="Calm screen" desc="Turns off moving animations.">
          <Toggle checked={settings.calmMotion} onChange={(v) => setSetting({ calmMotion: v })} label="Calm screen" />
        </SettingRow>
      </Collapsible>

      {/* other preferences */}
      <Collapsible id="more" icon="star" title="More options" {...fold}
        summary={settings.clock === '24' ? '24-hour clock' : '12-hour clock (AM/PM)'}>
        <SettingRow icon="clock" title="Time format" desc="How times are shown, like 2:30 PM or 14:30." stacked>
          <SegmentedControl label="Time format" value={settings.clock} onChange={(v) => setSetting({ clock: v })}
            options={[{ value: '12', label: '2:30 PM' }, { value: '24', label: '14:30' }]} />
        </SettingRow>
        <SettingRow icon="calendar" title="Calendar on Home" desc="Show this month's medicine calendar on the Home screen.">
          <Toggle checked={settings.homeCalendar} onChange={(v) => setSetting({ homeCalendar: v })} label="Calendar on Home" />
        </SettingRow>
        <SettingRow icon="brain" title="Brain games on Home" desc="Show the games card and daily reminder.">
          <Toggle checked={settings.homeGames} onChange={(v) => setSetting({ homeGames: v })} label="Brain games on Home" />
        </SettingRow>
      </Collapsible>
      </div>

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

      <Button variant="danger" icon="logout" onClick={onSignOut}>Sign out</Button>

      {editProfile && <ProfileForm profile={profile} onClose={() => setEditProfile(false)}
        onSaved={async (patch) => { await updateProfile(patch); await reloadProfile(); setEditProfile(false); ui.toast('Saved.'); }} />}
      {editContact && <ContactForm contact={editContact.id ? editContact : null} onClose={() => setEditContact(null)}
        onSaved={() => { setEditContact(null); contacts.reload(); }} />}
    </div>
  );
}

// Turning on alerts, gated on MyDay being installed.
//
// This gate is the fix for "don't make it a Chrome notification". A web page's
// notifications are attributed by the operating system to whatever app owns the
// page: in a browser tab that is Chrome or Safari, and nothing the page does can
// change it. Installed to the home screen, the same notification is attributed
// to MyDay, with the MyDay icon. iPadOS goes further and refuses web push
// entirely until the app is on the home screen. So installing first is the
// difference between a proper MyDay alert and no alert at all.
function AlertsEnabler({ devices, onEnable, onTest }) {
  const { installed } = useInstallPrompt();
  const [override, setOverride] = useState(false);

  if (!pushSupported()) {
    return (
      <p className="muted">
        This browser can't show alerts. On an iPad or iPhone, tap the Share button in Safari, choose
        “Add to Home Screen”, then open MyDay from your home screen.
      </p>
    );
  }

  return (
    <>
      {installed ? (
        <p className="join-ok"><Icon name="check" size={20} /> MyDay is installed — alerts will show as MyDay.</p>
      ) : (
        <div className="join-gate">
          <div className="join-gate__t"><Icon name="download" size={20} /> Add MyDay to this device first</div>
          <p className="join-gate__d">
            Until MyDay is on the home screen, your device labels these alerts with the name of your web browser —
            and an iPad won't send them at all. Adding MyDay takes about ten seconds and fixes both.
          </p>
          <InstallButton className="btn btn--primary btn--md btn--full" label="Add MyDay to this device" iconSize={20} />
          <button type="button" className="join-gate__skip" onClick={() => setOverride(true)}>
            I can't do this — turn on alerts in the browser anyway
          </button>
        </div>
      )}
      <div style={{ height: 10 }} />
      <Button icon="bell" onClick={onEnable} disabled={!installed && !override}>Turn on alerts on this device</Button>
      {devices.data?.length ? (
        <div style={{ marginTop: 10 }}>
          <div className="muted">{devices.data.length} device{devices.data.length === 1 ? '' : 's'} receiving alerts.</div>
          <Button variant="ghost" size="sm" full={false} onClick={onTest} style={{ marginTop: 8 }}>Send a test alert</Button>
        </div>
      ) : null}
    </>
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
            <li className="g-can__no"><Icon name="close" size={18} /> They cannot see your health cards</li>
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

function ContactForm({ contact, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!contact;
  const [type, setType] = useState(contact?.type || 'pharmacy');
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
