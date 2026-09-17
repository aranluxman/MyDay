import { Icon } from './Icon.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

// Add-to-Home-Screen guidance, with a screenshot-style illustration of the
// button the person is looking for on their own device.
//
// This is not decoration. On iOS and iPadOS the operating system refuses web
// push entirely until the app is on the home screen, and everywhere else it
// attributes the notification to the browser rather than to MyDay. A guardian
// who skips this step gets alerts that look like they came from Safari, or no
// alerts at all — so the instructions have to match the exact device in their
// hands, and they have to be believable enough to follow.

export function detectDevice() {
  const ua = navigator.userAgent || '';
  // An iPad on iPadOS 13+ reports itself as a Mac, so touch points are the tell.
  const iPad = /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iPad) return 'ipad';
  if (/iphone|ipod/i.test(ua)) return 'iphone';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

const DEVICE_NAME = { ipad: 'iPad', iphone: 'iPhone', android: 'Android', desktop: 'computer' };

// Where the Share button actually sits differs between iPhone (bottom toolbar)
// and iPad (top toolbar), and getting that wrong sends people hunting.
const STEPS = {
  ipad: [
    { icon: 'share', text: 'In Safari, tap the Share button at the top right of the screen.', art: 'toolbar-top' },
    { icon: 'plus', text: 'Scroll down the list and tap "Add to Home Screen".', art: 'sheet-row' },
    { icon: 'check', text: 'Tap "Add" in the top corner.', art: 'add-btn' },
    { icon: 'home', text: 'Open MyDay from the new icon on your home screen. Alerts only work when you start it from there.', art: 'home-icon' },
  ],
  iphone: [
    { icon: 'share', text: 'In Safari, tap the Share button at the bottom of the screen.', art: 'toolbar-bottom' },
    { icon: 'plus', text: 'Scroll down and tap "Add to Home Screen".', art: 'sheet-row' },
    { icon: 'check', text: 'Tap "Add" in the top corner.', art: 'add-btn' },
    { icon: 'home', text: 'Open MyDay from the new icon on your home screen. Alerts only work when you start it from there.', art: 'home-icon' },
  ],
  android: [
    { icon: 'dots', text: 'Tap the menu (⋮) at the top right of your browser.', art: 'toolbar-top' },
    { icon: 'download', text: 'Choose "Install app" or "Add to Home screen".', art: 'sheet-row' },
    { icon: 'check', text: 'Confirm. MyDay appears with your other apps.', art: 'home-icon' },
  ],
  desktop: [
    { icon: 'download', text: 'Click the install icon on the right of the address bar.', art: 'toolbar-top' },
    { icon: 'plus', text: 'Or open the browser menu and choose "Install MyDay".', art: 'sheet-row' },
    { icon: 'check', text: 'MyDay opens in its own window, like an app.', art: 'home-icon' },
  ],
};

// Small, theme-coloured mock of the chrome the step refers to. Drawn with CSS
// variables so it stays correct in all eight themes, and hidden from screen
// readers because the step text already says everything.
function StepArt({ kind }) {
  if (kind === 'toolbar-top' || kind === 'toolbar-bottom') {
    return (
      <span className={`ia ia--bar ia--${kind}`} aria-hidden="true">
        <span className="ia__bar">
          <span className="ia__dot" /><span className="ia__url" />
          <span className="ia__target"><Icon name="share" size={13} /></span>
        </span>
      </span>
    );
  }
  if (kind === 'sheet-row') {
    return (
      <span className="ia ia--sheet" aria-hidden="true">
        <span className="ia__row" />
        <span className="ia__row ia__row--target"><Icon name="plus" size={13} /></span>
        <span className="ia__row" />
      </span>
    );
  }
  if (kind === 'add-btn') {
    return (
      <span className="ia ia--add" aria-hidden="true">
        <span className="ia__addbar"><span className="ia__addbtn">Add</span></span>
      </span>
    );
  }
  return (
    <span className="ia ia--home" aria-hidden="true">
      <span className="ia__app"><Icon name="pulse" size={14} /></span>
      <span className="ia__appname">MyDay</span>
    </span>
  );
}

/**
 * @param why      One sentence on why installing matters, in this context.
 * @param onDone   Optional: called when the app reports itself installed.
 */
export function InstallCard({ why, compact }) {
  const { canInstall, install, installed } = useInstallPrompt();
  const device = detectDevice();
  const steps = STEPS[device];

  if (installed) {
    return (
      <div className="install-card install-card--ok">
        <span className="install-card__okic"><Icon name="check" size={22} /></span>
        <div>
          <div className="install-card__t">MyDay is installed on this {DEVICE_NAME[device]}</div>
          <p className="install-card__d">Alerts will arrive as MyDay. Nothing else to do.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="install-card">
      <div className="install-card__head">
        <span className="install-card__ic"><Icon name="download" size={22} /></span>
        <div>
          <div className="install-card__t">Add MyDay to this {DEVICE_NAME[device]}</div>
          <p className="install-card__d">{why}</p>
        </div>
      </div>

      {/* Chrome and Edge can just do it. Safari cannot, so it gets the steps. */}
      {canInstall && (
        <button type="button" className="btn btn--primary btn--md btn--full" onClick={install}>
          <Icon name="download" size={20} /><span>Add MyDay now</span>
        </button>
      )}

      {!canInstall && !compact && (
        <ol className="install-steps install-steps--art">
          {steps.map((s, i) => (
            <li key={i} className="install-step">
              <span className="install-step__n">{i + 1}</span>
              <span className="install-step__body">
                <span className="install-step__txt">{s.text}</span>
                <StepArt kind={s.art} />
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* The app re-checks on its own: useInstallPrompt watches display-mode,
          so coming back from the home screen flips this card without a reload. */}
      <p className="install-card__recheck">
        Once it is on your home screen, open MyDay from there and this will update by itself.
      </p>
    </div>
  );
}
