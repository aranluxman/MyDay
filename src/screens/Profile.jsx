import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Spinner, Modal, Field, Input, Textarea, EmptyState, SegmentedControl, Avatar } from '../components/ui.jsx';
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

export default function Profile() {
  const { user, profile, theme, setTheme, textSize, setTextSize, signOut, updateProfile, reloadProfile } = useApp();
  const ui = useUI();
  const location = useLocation();
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
  const devices = useAsync(() => (pushSupported() ? listFamilyDevices() : Promise.resolve([])), []);

  useEffect(() => {
    if (location.state?.add === 'contact') { setEditContact({}); window.history.replaceState({}, ''); }
  }, [location.key]);

  const age = profile?.age ?? ageFromBirthday(profile?.birthday);

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
      {/* identity */}
      <Card className="profile-head">
        <div className="avatar-edit">
          <Avatar name={profile?.full_name} color={profile?.avatar_color} size={72} src={profile?.avatar_url} />
          <button className="avatar-edit__btn" aria-label="Change photo" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Icon name={uploading ? 'clock' : 'plus'} size={16} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
        </div>
        <div>
          <div className="profile-head__name">{profile?.full_name || 'Your profile'}</div>
          {age != null && <div className="muted">{age} years old</div>}
        </div>
      </Card>

      {completeness.pct < 100 && (
        <Card className="complete">
          <div className="complete__ring" style={{ '--p': completeness.pct }}><b>{completeness.pct}%</b></div>
          <div>
            <div className="complete__t">Your profile is {completeness.pct}% complete</div>
            <div className="muted">Add a few more details to finish it.</div>
          </div>
        </Card>
      )}

      {/* about me */}
      <Card>
        <SectionTitle icon="user" title="About me" action={<Button variant="ghost" size="sm" full={false} icon="edit" onClick={() => setEditProfile(true)}>Edit</Button>} />
        <InfoRow label="Name" value={profile?.full_name} />
        <InfoRow label="Birthday" value={profile?.birthday} />
        <InfoRow label="Age" value={age != null ? String(age) : ''} />
        <InfoRow label="What I'm on" value={profile?.on_treatment} />
        <InfoRow label="What I'm working toward" value={profile?.goal} />
      </Card>

      {/* contacts */}
      <Card>
        <SectionTitle icon="phone" title="My contacts" action={<Button variant="ghost" size="sm" full={false} icon="plus" onClick={() => setEditContact({})}>Add</Button>} />
        {contacts.loading ? <Spinner label="" /> : !contacts.data?.length ? (
          <EmptyState>Add your pharmacy, doctor, insurance, and more.</EmptyState>
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
                    <button className="icon-btn" aria-label="Edit" onClick={() => setEditContact(c)}><Icon name="edit" size={20} /></button>
                    <button className="icon-btn" aria-label="Remove" onClick={() => removeContact(c)}><Icon name="trash" size={20} /></button>
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
            <button key={t.id} className={`theme-swatch${theme === t.id ? ' is-active' : ''}`} onClick={() => setTheme(t.id)}>
              <span className="theme-swatch__c" style={{ background: t.bg }}><i style={{ background: t.primary }} /></span>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
        <p className="muted" style={{ margin: '18px 0 8px' }}>Display size</p>
        <SegmentedControl value={textSize} onChange={setTextSize} options={TEXT_SIZES.map((s) => ({ value: s.id, label: s.name }))} />
      </Card>

      {/* alerts */}
      <Card>
        <SectionTitle icon="bell" title="Missed-dose alerts" />
        <p className="muted" style={{ margin: '0 0 10px' }}>Get a notification on this phone if a dose is not taken within an hour of being due.</p>
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

      <Button variant="danger" icon="logout" onClick={onSignOut}>Sign out</Button>

      {editProfile && <ProfileForm profile={profile} onClose={() => setEditProfile(false)}
        onSaved={async (patch) => { await updateProfile(patch); await reloadProfile(); setEditProfile(false); ui.toast('Saved.'); }} />}
      {editContact && <ContactForm contact={editContact.id ? editContact : null} onClose={() => setEditContact(null)}
        onSaved={() => { setEditContact(null); contacts.reload(); }} />}
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
function InfoRow({ label, value }) {
  return (
    <div className="info-row">
      <span className="info-row__l">{label}</span>
      <span className="info-row__v">{value || <span className="muted">Not set</span>}</span>
    </div>
  );
}

function ProfileForm({ profile, onClose, onSaved }) {
  const ui = useUI();
  const [full_name, setName] = useState(profile?.full_name || '');
  const [birthday, setBirthday] = useState(profile?.birthday || '');
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [on_treatment, setOn] = useState(profile?.on_treatment || '');
  const [goal, setGoal] = useState(profile?.goal || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const patch = {
      full_name: full_name.trim() || null,
      birthday: birthday || null,
      age: age ? Math.max(0, Math.min(130, parseInt(age, 10) || 0)) : null,
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
      <Field label="What I'm on" hint="Current treatments, medicines, or conditions."><Textarea rows={2} value={on_treatment} onChange={(e) => setOn(e.target.value)} maxLength={300} /></Field>
      <Field label="What I'm working toward" hint="Your health goals."><Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} /></Field>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>Save</Button>
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
            <button key={t.value} type="button" className={`type-chip${type === t.value ? ' is-active' : ''}`} onClick={() => setType(t.value)}>
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
        <Button disabled={busy} onClick={save}>{editing ? 'Save changes' : 'Add contact'}</Button>
      </div>
    </Modal>
  );
}
