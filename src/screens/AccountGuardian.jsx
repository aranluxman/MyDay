import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { addAccountGuardianDevice, clearAccountGuardianToken, getAccountGuardianToken, listAccountGuardians, linkAccountWithCode, unlinkAccountGuardian } from '../lib/guardianAccount.js';
import { CodeEntry, Dashboard } from './Guardian.jsx';

export default function AccountGuardian() {
  const { profile, user } = useApp();
  const ui = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState(location.state?.linkId || null);
  const [name, setName] = useState(profile?.full_name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const links = useAsync(() => listAccountGuardians(), []);
  const [deviceBusy, setDeviceBusy] = useState(false);

  function localLink(link) {
    return link.device_ids?.find((id) => getAccountGuardianToken(user?.id, id)) || link.id;
  }

  useEffect(() => {
    if (!selected || !links.data?.length) return;
    const link = links.data.find((item) => item.id === selected || item.device_ids?.includes(selected));
    if (link) {
      const local = localLink(link);
      if (local !== selected) setSelected(local);
    }
  }, [selected, links.data, user?.id]);

  async function setupThisDevice() {
    setDeviceBusy(true);
    try {
      const id = await addAccountGuardianDevice(selected);
      setSelected(id);
      links.reload();
    } catch (e) { ui.toast(e.message || 'Could not set up alerts on this device.', 'bad'); }
    finally { setDeviceBusy(false); }
  }

  const backToList = useCallback(() => { setSelected(null); links.reload(); }, [links.reload]);

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
      title: `Stop watching ${link.name}?`,
      message: 'This will disconnect your access to their medicine updates. They can invite you again later.',
      confirmLabel: 'Disconnect', danger: true,
    });
    if (!ok) return;
    try {
      await unlinkAccountGuardian(link.id);
      link.device_ids?.forEach((id) => clearAccountGuardianToken(user?.id, id));
      links.reload();
    }
    catch (e) { ui.toast(e.message || 'Could not disconnect.', 'bad'); }
  }

  if (selected) {
    const token = getAccountGuardianToken(user?.id, selected);
    return (
      <div>
        <div className="g-account-switch">
          <button type="button" onClick={backToList}><Icon name="back" size={20} /> All people I watch</button>
        </div>
        {!token && <Card className="g-account-device">
          <p>Set up alerts on this device to hear when this person misses a medicine.</p>
          <Button onClick={setupThisDevice} disabled={deviceBusy}>{deviceBusy ? 'Setting up…' : 'Set up alerts on this device'}</Button>
        </Card>}
        <Dashboard key={selected} accountLinkId={selected} accountToken={token} onUnlinked={backToList} />
      </div>
    );
  }

  return (
    <div className="g-account-page">
      <header className="g-account-head">
        <button type="button" className="g-account-back" onClick={() => navigate('/')}><Icon name="back" size={20} /> My day</button>
        <h1>People I watch</h1>
        <p>Your medicines stay in your own account. You can also check on someone who invited you.</p>
      </header>

      {links.loading ? <SkeletonCard lines={3} /> : links.error ? (
        <Card><p>Could not load your connections.</p><Button onClick={links.reload}>Try again</Button></Card>
      ) : !!links.data?.length ? (
        <div className="g-account-list">
          {links.data.map((link) => (
            <Card key={link.id}>
              <div className="g-account-person">
                <div><b>{link.name}</b><span>Read-only medicine updates</span></div>
                <Button full={false} onClick={() => setSelected(localLink(link))}>Check on {link.name}</Button>
              </div>
              <button type="button" className="g-account-remove" onClick={() => stopWatching(link)}>Stop watching</button>
            </Card>
          ))}
        </div>
      ) : <Card><p>You are not watching anyone yet. Ask them to invite you from their Profile page.</p></Card>}

      <Card className="g-account-join">
        <h2>Add someone with a code</h2>
        <p>Ask them to open Profile → Invite a guardian and read you their 6-digit code.</p>
        {error && <p className="ob__err" role="alert">{error}</p>}
        <label className="g-account-label" htmlFor="account-guardian-name">Your name</label>
        <input id="account-guardian-name" className="input" maxLength={60} autoComplete="name"
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Name they will see" />
        <CodeEntry error={error} busy={busy} onSubmit={submit} />
      </Card>
    </div>
  );
}
