import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { Modal } from './ui.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

// Detects the broad platform so the manual instructions match the user's browser.
function platform() {
  const ua = navigator.userAgent || '';
  const iOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

// "Download now" button that works everywhere:
//   - Chrome / Edge / Android -> fires the native install prompt.
//   - iOS / anything else      -> opens clear "Add to Home Screen" steps.
// Hidden once the app is already installed (running standalone).
export function InstallButton({ className = 'install-btn', label = 'Download now', iconSize = 18, style }) {
  const { canInstall, install, installed } = useInstallPrompt();
  const [help, setHelp] = useState(false);
  if (installed) return null;

  function onClick() {
    if (canInstall) { install(); return; }
    setHelp(true);
  }

  return (
    <>
      <button type="button" className={className} style={style} onClick={onClick} aria-label={label}>
        <Icon name="download" size={iconSize} /> <span>{label}</span>
      </button>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </>
  );
}

function InstallHelp({ onClose }) {
  const steps = {
    ios: [
      { icon: 'share', text: 'Tap the Share button in Safari’s toolbar.' },
      { icon: 'plus', text: 'Choose “Add to Home Screen”.' },
      { icon: 'check', text: 'Tap “Add” — MyDay now opens like a normal app.' },
    ],
    android: [
      { icon: 'dots', text: 'Tap the menu (⋮) in your browser’s top corner.' },
      { icon: 'download', text: 'Choose “Install app” or “Add to Home screen”.' },
      { icon: 'check', text: 'Confirm — MyDay appears with your other apps.' },
    ],
    desktop: [
      { icon: 'download', text: 'Click the install icon in the address bar (right-hand side).' },
      { icon: 'plus', text: 'Or open the browser menu and choose “Install MyDay”.' },
      { icon: 'check', text: 'MyDay opens in its own window, just like an app.' },
    ],
  }[platform()];

  return (
    <Modal title="Add MyDay to your phone" onClose={onClose}>
      <p className="dialog-msg">MyDay installs to your home screen and opens like a real app — full-screen, faster, and no app store needed.</p>
      <ol className="install-steps">
        {steps.map((s, i) => (
          <li key={i} className="install-step">
            <span className="install-step__n">{i + 1}</span>
            <span className="install-step__ic"><Icon name={s.icon} size={20} /></span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
