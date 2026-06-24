import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { Modal, Button } from './ui.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// "Download now" button. Triggers the real PWA install when the browser allows
// it, otherwise shows simple Add-to-Home-Screen steps. Hides once installed.
export function InstallButton({ className = 'install-btn', label = 'Download now', style }) {
  const { installed, canPrompt, install } = useInstallPrompt();
  const [help, setHelp] = useState(false);
  if (installed) return null;

  async function onClick() {
    if (canPrompt && (await install())) return;
    setHelp(true);
  }

  return (
    <>
      <button className={className} style={style} onClick={onClick}><Icon name="download" size={18} /> {label}</button>
      {help && (
        <Modal title="Add MyDay to your phone" onClose={() => setHelp(false)}>
          <p className="dialog-msg" style={{ marginBottom: 14 }}>
            MyDay installs to your home screen and opens like a real app — no app store needed.
          </p>
          <div className="install-steps">
            <div className="install-step">
              <span className="ic-badge"><Icon name="share" size={20} /></span>
              <div><b>{isIOS() ? 'On your iPhone or iPad' : 'On iPhone (Safari)'}</b>
                <p>Tap the <b>Share</b> button, then choose <b>Add to Home Screen</b>.</p></div>
            </div>
            <div className="install-step">
              <span className="ic-badge"><Icon name="download" size={20} /></span>
              <div><b>On Android or computer (Chrome / Edge)</b>
                <p>Open the <b>menu</b>, then tap <b>Install app</b> or <b>Add to Home screen</b>.</p></div>
            </div>
          </div>
          <Button onClick={() => setHelp(false)} style={{ marginTop: 14 }}>Got it</Button>
        </Modal>
      )}
    </>
  );
}
