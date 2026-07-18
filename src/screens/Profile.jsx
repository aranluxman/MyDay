import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, Modal, Field, Input, Textarea, EmptyState, SegmentedControl, Avatar, Toggle } from '../components/ui.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { listContacts, saveContact, deleteContact, listFamilyDevices, saveFamilyDevice, uploadAvatar } from '../lib/db.js';
import { supabase } from '../lib/supabase.js';
import { pushSupported, enablePush } from '../lib/push.js';
import { ageFromBirthday } from '../lib/format.js';
import { THEMES, TEXT_SIZES, profileCompleteness } from '../lib/appearance.js';

const CONTACT_TYPES = [
  { value: 'pharmacy', label: 'Pharmacy', icon: 'cross' },
  { value: 'provider', label: 'Provider', icon: 'user' },
  { value: 'clinic', label: 'Clinic', icon: 'building' },
  { value: 'insurance', label: 'Insurance', icon: 'shield' },
  { value: 'merchant', label: 'Merchant', icon: 'cart' },
  { value: 'other', label: 'Other', icon: 'star' },
];
const typeMeta = (t) => CONTACT_TYPES.find((x) => x.value === t) || CONTACT_TYPES[5];

// Friendly labels for the profile-completeness checklist.
const FIELD_LABELS = {
  full_name: 'Add your name',
  avatar_url: 'Add a profile photo',
  birthday: 'Add your birthday',
  sex: 'Add your sex',
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
  const [aboutOpen, setAboutOpen] = useState(false);
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

  useEffect(() => {
    if (location.state?.add === 'contact') { setEditContact({}); window.history.replaceState({}, ''); }
  }, [location.key]);

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
      await saveFamilyDevice('This phone', sub);
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

  return (
    <div className="stack">
      {/* identity — tap to view and edit your details */}
      <Card>
        <div className="account-card">
          <div className="avatar-edit">
            <Avatar name={profile?.full_name} color={profile?.avatar_color} size={64} src={profile?.avatar_url} />
            <button className="avatar-edit__btn" aria-label="Change profile photo" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Icon name={uploading ? 'clock' : 'plus'} size={16} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
          </div>
          <button className="account-card__main" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit' }}
            onClick={() => setEditProfile(true)}>
            <div className="account-card__name">{profile?.full_name || 'Your profile'}</div>
            <div className="account-card__sub">{age != null ? `${age} years old — tap to view and edit` : 'View and manage your profile'}</div>
          </button>
          <Icon name="chevron" size={24} />
        </div>
      </Card>

      {completeness.pct < 100 && (
        <Card>
          <div className="progress-card">
            <div className="progress-card__ring" style={{ '--p': completeness.pct }}><b>{completeness.pct}%</b></div>
            <div className="progress-card__main">
              <div className="progress-card__t">Profile progress</div>
              <div className="progress-card__d">You're making progress! Complete your profile to personalise your experience.</div>
            </div>
          </div>
          <ul className="checklist">
            {completeness.missing.map((f) => (
              <li key={f}>
                <button className="checklist__item" onClick={() => fixField(f)} aria-label={FIELD_LABELS[f] || f}>
                  <span className="checklist__box"><Icon name="plus" size={16} /></span>
                  <span>{FIELD_LABELS[f] || f}</span>
                  <Icon name="chevron" size={20} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* my details — menu rows in the style of the reference design */}
      <Card>
        <div className="menu-list">
          <MenuRow icon="user" title="Personal information" desc="Your name, birthday, sex and more" onClick={() => setEditProfile(true)} />
          <MenuRow icon="cross" title="Health information" desc="Medications, supplements and conditions" onClick={() => setEditProfile(true)} />
          <MenuRow icon="pill" title="My medicines" desc="Manage your medicines and times" onClick={() => navigate('/medication', { state: { view: 'medicines' } })} />
          <MenuRow icon="star" title="Health goals" desc="Set and track what you're working toward" onClick={() => setEditProfile(true)} />
          <MenuRow icon="brain" title="Brain Games" desc="Play games and see your progress" onClick={() => navigate('/games')} />
          <MenuRow icon="shield" title="About MyDay" desc="Learn more about the app" onClick={() => setAboutOpen(true)} />
        </div>
      </Card>

      {/* contacts — vertical list, never scrolls sideways */}
      <Card>
        <SectionTitle icon="phone" title="My contacts" action={<Button variant="ghost" size="sm" full={false} icon="plus" onClick={() => setEditContact({})}>Add</Button>} />
        {contacts.loading ? <Spinner label="" /> : !contacts.data?.length ? (
          <EmptyState>Add your pharmacy, doctor, insurance, and more so they're one tap away.</EmptyState>
        ) : (
          <div className="stack">
            {contacts.data.map((c) => {
              const m = typeMeta(c.type);
              return (
                <div key={c.id} className="contact">
                  <span className="contact__icon"><Icon name={m.icon} size={22} /></span>
                  <div className="contact__main">
                    <div className="contact__name">{c.name} <span className="contact__type">{m.label}</span></div>
                    {c.phone && <a className="contact__line" href={`tel:${c.phone}`}>{c.phone}</a>}
                    {c.email && <div className="contact__line">{c.email}</div>}
                    {c.address && <div className="contact__line">{c.address}</div>}
                    {c.notes && <div className="contact__line muted">{c.notes}</div>}
                  </div>
                  <div className="contact__actions">
                    <button className="icon-btn" aria-label={`Edit ${c.name}`} onClick={() => setEditContact(c)}><Icon name="edit" size={20} /></button>
                    <button className="icon-btn" aria-label={`Remove ${c.name}`} onClick={() => removeContact(c)}><Icon name="trash" size={20} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* appearance */}
      <Card>
        <SectionTitle icon="sun" title="Appearance" />
        <p className="muted" style={{ margin: '0 0 12px' }}>Pick a look that's comfortable for you.</p>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-swatch${theme === t.id ? ' is-active' : ''}`} onClick={() => setTheme(t.id)}
              aria-label={`${t.name} theme`} aria-pressed={theme === t.id}>
              <span className="theme-swatch__preview" style={{ background: t.bg, color: t.ink }}>
                <span className="theme-swatch__bar" style={{ background: t.ink, opacity: 0.18 }} />
                <span className="theme-swatch__bar theme-swatch__bar--short" style={{ background: t.ink, opacity: 0.12 }} />
                <span className="theme-swatch__btn" style={{ background: t.primary }} />
              </span>
              <span>{t.name}{theme === t.id ? ' ✓' : ''}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* accessibility — bigger text, more contrast, easier reading */}
      <Card>
        <SectionTitle icon="eye" title="Accessibility" />
        <p className="muted" style={{ margin: '0 0 4px' }}>Make MyDay easier to see and use — changes apply straight away.</p>
        <SettingRow icon="notes" title="Text size" desc="Make everything on screen bigger." stacked>
          <SegmentedControl value={textSize} onChange={setTextSize} options={TEXT_SIZES.map((s) => ({ value: s.id, label: s.name }))} />
          <p className="size-preview">Sample: today's medicine is ready.</p>
        </SettingRow>
        <SettingRow icon="sun" title="More contrast" desc="Stronger text and outlines, in any theme.">
          <Toggle checked={settings.highContrast} onChange={(v) => setSetting({ highContrast: v })} label="More contrast" />
        </SettingRow>
        <SettingRow icon="edit" title="Bold text" desc="Thicker letters that are easier to read.">
          <Toggle checked={settings.bold} onChange={(v) => setSetting({ bold: v })} label="Bold text" />
        </SettingRow>
        <SettingRow icon="plus" title="Bigger buttons" desc="Larger tap targets for steadier pressing.">
          <Toggle checked={settings.bigButtons} onChange={(v) => setSetting({ bigButtons: v })} label="Bigger buttons" />
        </SettingRow>
        <SettingRow icon="moon" title="Calm screen" desc="Turns off moving animations.">
          <Toggle checked={settings.calmMotion} onChange={(v) => setSetting({ calmMotion: v })} label="Calm screen" />
        </SettingRow>
      </Card>

      {/* other preferences */}
      <Card>
        <SectionTitle icon="star" title="More options" />
        <SettingRow icon="clock" title="Time format" desc="How times are shown, like 2:30 PM or 14:30." stacked>
          <SegmentedControl value={settings.clock} onChange={(v) => setSetting({ clock: v })}
            options={[{ value: '12', label: '2:30 PM' }, { value: '24', label: '14:30' }]} />
        </SettingRow>
        <SettingRow icon="calendar" title="Week starts on" desc="First day shown in calendars." stacked>
          <SegmentedControl value={settings.weekStart} onChange={(v) => setSetting({ weekStart: v })}
            options={[{ value: 'sun', label: 'Sunday' }, { value: 'mon', label: 'Monday' }]} />
        </SettingRow>
        <SettingRow icon="calendar" title="Calendar on Home" desc="Show this month's medicine calendar on the Home screen.">
          <Toggle checked={settings.homeCalendar} onChange={(v) => setSetting({ homeCalendar: v })} label="Calendar on Home" />
        </SettingRow>
        <SettingRow icon="brain" title="Brain games on Home" desc="Show the games card and daily reminder.">
          <Toggle checked={settings.homeGames} onChange={(v) => setSetting({ homeGames: v })} label="Brain games on Home" />
        </SettingRow>
      </Card>

      {/* alerts */}
      <Card>
        <SectionTitle icon="bell" title="Missed-dose alerts" />
        <p className="muted" style={{ margin: '0 0 10px' }}>If a dose isn't marked as taken within the chosen time, a notification goes to the phones receiving alerts.</p>
        <p className="muted" style={{ margin: '0 0 6px', fontWeight: 600 }}>Alert me after a dose is</p>
        <SegmentedControl value={alertWindow} onChange={savingWindow ? () => {} : setAlertWindow}
          options={ALERT_WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
        <div style={{ height: 14 }} />
        {pushSupported() ? (
          <>
            <Button icon="bell" onClick={enableAlerts}>Turn on alerts on this phone</Button>
            {devices.data?.length ? (
              <div style={{ marginTop: 10 }}>
                <div className="muted">{devices.data.length} phone(s) receiving alerts.</div>
                <Button variant="ghost" size="sm" full={false} onClick={testAlert} style={{ marginTop: 8 }}>Send a test alert</Button>
              </div>
            ) : null}
          </>
        ) : <p className="muted">On iPhone, add MyDay to the Home Screen first, then open it to enable alerts.</p>}
      </Card>

      {/* privacy / storage note */}
      <Card className="storage-note">
        <span className="storage-note__ic"><Icon name="shield" size={22} /></span>
        <p className="muted" style={{ margin: 0 }}>
          Your health information is stored securely in your own private MyDay account and synced across your devices.
          Only you — and the family phones you choose for alerts — can see it.
        </p>
      </Card>

      <Button variant="danger" icon="logout" onClick={onSignOut}>Sign out</Button>

      {aboutOpen && (
        <Modal title="About MyDay" onClose={() => setAboutOpen(false)}>
          <p className="dialog-msg">
            MyDay helps you keep track of your medicines, appointments, and health notes — all in one
            simple place. Play brain games to stay sharp, and let family phones receive an alert if a
            dose is missed.
          </p>
          <p className="muted">Your information is private: only you and the family phones you choose can see it.</p>
          <Button onClick={() => setAboutOpen(false)}>Close</Button>
        </Modal>
      )}

      {editProfile && <ProfileForm profile={profile} onClose={() => setEditProfile(false)}
        onSaved={async (patch) => { await updateProfile(patch); await reloadProfile(); setEditProfile(false); ui.toast('Saved.'); }} />}
      {editContact && <ContactForm contact={editContact.id ? editContact : null} onClose={() => setEditContact(null)}
        onSaved={() => { setEditContact(null); contacts.reload(); }} />}
    </div>
  );
}

// One settings line: icon, name + plain-words description, and the control
// (a switch on the right, or a full-width segmented picker underneath).
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

const SEX_OPTS = [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }];
const WHOM_OPTS = [{ value: 'myself', label: 'Myself' }, { value: 'loved_one', label: 'A loved one' }];

function ProfileForm({ profile, onClose, onSaved }) {
  const ui = useUI();
  const [full_name, setName] = useState(profile?.full_name || '');
  const [birthday, setBirthday] = useState(profile?.birthday || '');
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [sex, setSex] = useState(profile?.sex || '');
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
      sex: sex || null,
      for_whom: for_whom || null,
      on_treatment: on_treatment.trim() || null,
      goal: goal.trim() || null,
    };
    try { await onSaved(patch); } catch { ui.toast('Could not save.', 'bad'); setBusy(false); }
  }

  return (
    <Modal title="About me" onClose={onClose}>
      <Field label="Name"><Input value={full_name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
      <Field label="Birthday"><Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></Field>
      <Field label="Age" hint="Optional - filled in from your birthday if set."><Input type="number" min="0" max="130" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
      <Field label="Sex"><SegmentedControl value={sex} onChange={setSex} options={SEX_OPTS} /></Field>
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
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) { ui.toast('Please enter a name.', 'bad'); return; }
    setBusy(true);
    try {
      await saveContact({ id: contact?.id, type, name: name.trim(), phone: phone.trim(), email: email.trim(), address: address.trim(), notes: notes.trim() });
      ui.toast(editing ? 'Contact updated.' : 'Contact added.');
      onSaved();
    } catch { ui.toast('Could not save.', 'bad'); setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Edit contact' : 'Add a contact'} onClose={onClose}>
      <Field label="Type">
        <div className="type-grid">
          {CONTACT_TYPES.map((t) => (
            <button key={t.value} type="button" className={`type-chip${type === t.value ? ' is-active' : ''}`} aria-pressed={type === t.value} onClick={() => setType(t.value)}>
              <Icon name={t.icon} size={22} /><span>{t.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Pharmacy" maxLength={80} /></Field>
      <Field label="Phone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" maxLength={40} /></Field>
      <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={80} /></Field>
      <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} /></Field>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} /></Field>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} icon={busy ? 'clock' : undefined} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add contact'}</Button>
      </div>
    </Modal>
  );
}
