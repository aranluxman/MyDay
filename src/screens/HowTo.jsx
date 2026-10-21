import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

// "How to use MyDay": the whole app explained one part at a time, for someone
// who has never used an app like it. Each part opens to a picture-in-words
// ("it works like…"), numbered steps, and a button that goes straight there.
const TOPICS = [
  {
    id: 'bar', icon: 'home', title: 'Getting around',
    like: 'The bar at the bottom is like the rooms in a house — tap one to walk into it.',
    steps: [
      'On a phone, look at the bottom of the screen. There are five buttons. On a computer or tablet, the buttons are down the left side.',
      'Home shows your day. Medicine is your pill list. Updates is your health diary. Games are brain games. On a phone, More opens Visits (your appointments), Profile (your settings), My cards and Alerts. On a computer they are all in the side bar.',
      'The glass bubble shows the room you are in now. You can tap a button, or slide your finger along the bar and let go on the one you want.',
    ],
    go: '/', goLabel: 'Go to Home',
  },
  {
    id: 'dose', icon: 'check', title: 'Taking today’s medicine',
    like: 'Like ticking a box on a paper chart — but MyDay keeps the chart for you.',
    steps: [
      'Open Home. When it is time, a big card says “Time for your medicine”.',
      'Take your medicine.',
      'Tap the green button “Done – I took it”. That’s it.',
      'If you forget, MyDay can remind you, and let your family know.',
    ],
    go: '/', goLabel: 'Go to Home',
  },
  {
    id: 'add', icon: 'plus', title: 'Adding a medicine',
    like: 'The blue + button is like a “new” drawer — everything you can add is inside.',
    steps: [
      'Tap the blue “Add” button near the bottom right.',
      'A small menu opens. Tap “Add a medicine”.',
      'Answer one question at a time: its name, how much, what time, how often.',
      'Tip: on the Medicine page you can tap “Add from a photo” and take up to 3 pictures of the box (front, back and the pharmacy label) — MyDay reads them all and fills it in for you to check.',
      'Tap Save on the last step.',
    ],
    go: '/medication', state: { add: 'med' }, goLabel: 'Add a medicine now',
  },
  {
    id: 'notes', icon: 'pulse', title: 'Writing how you feel',
    like: 'Your health diary is like a notebook you bring to the doctor — so you never forget what happened.',
    steps: [
      'Open Updates at the bottom.',
      'Tap a quick button like “Headache” or “Tired”, or tap “Add a health note”.',
      'Write what happened, then tap “Save note”.',
      'Tap “Chat with MyDay” on any note. A friendly helper cheers you on and asks a few simple questions to help you understand how you feel.',
      'The helper is not a doctor. Something feels serious? Don’t write it down first — call 911.',
    ],
    go: '/updates', state: { add: 'diary' }, goLabel: 'Write a note now',
  },
  {
    id: 'visits', icon: 'calendar', title: 'Doctor visits',
    like: 'Like the calendar on your fridge, but it reminds you before you need to leave.',
    steps: [
      'Tap the + button, then “Add a visit” — or tap More at the bottom, then Visits.',
      'Type who you are seeing, the day and the time.',
      'MyDay reminds you before the visit.',
    ],
    go: '/appointments', state: { add: 'appt' }, goLabel: 'Add a visit now',
  },
  {
    id: 'guardian', icon: 'user', title: 'Letting family keep an eye out',
    like: 'A guardian is like a neighbour who checks your porch light is on — they can look, but never touch.',
    steps: [
      'Open Profile. “Guardians” is the first part under “Safety & care”.',
      'Tap “Invite a guardian” and type their name.',
      'Read them the 6-digit code. On their phone they open myday-1rn.pages.dev/guardian and type it in.',
      'They will see if you took your medicines and get an alert if you miss one. They can never change anything.',
    ],
    go: '/profile', state: { open: 'guardians' }, goLabel: 'Open Guardians',
  },
  {
    id: 'alerts', icon: 'bell', title: 'Turning on reminders',
    like: 'Like setting an alarm clock — MyDay rings when it is time for a pill.',
    steps: [
      'Open Profile and tap “Alerts & reminders” — or tap Alerts in More (on a phone) or in the side bar (on a computer).',
      'First add MyDay to your home screen when it asks — then the alerts show as MyDay.',
      'Tap “Turn on alerts on this device”, then “Allow”.',
      'Tap “Send a test alert” to check it works.',
    ],
    go: '/profile/notifications', goLabel: 'Open Alerts',
  },
  {
    id: 'lang', icon: 'globe', title: 'Changing the language',
    like: 'Like switching the TV to a channel in your language.',
    steps: [
      'Open Profile.',
      'Under “App settings”, tap “Language”, then tap the box.',
      'Pick your language. The screen reloads once and everything is in your language.',
    ],
    go: '/profile', state: { open: 'language' }, goLabel: 'Open Language',
  },
  {
    id: 'see', icon: 'eye', title: 'Making it easier to see',
    like: 'Like putting on reading glasses — bigger words, clearer lines.',
    steps: [
      'Open Profile. “Accessibility” is the first section, right under your name.',
      'Under “Text size” tap a bigger size.',
      'Turn on “More contrast”, “Bold text” or “Bigger buttons” if they help.',
      'The button at the top right switches between System (matches your device), Light and Dark. More colours are in Profile → Appearance.',
    ],
    go: '/profile', state: { open: 'access' }, goLabel: 'Open Accessibility',
  },
  {
    id: 'games', icon: 'brain', title: 'Brain games',
    like: 'Like a daily crossword — a few minutes that keep the mind sharp.',
    steps: [
      'Open Games at the bottom.',
      'Pick any game and follow the words on screen.',
      'Try one a day. Your progress is saved.',
    ],
    go: '/games', goLabel: 'Open Brain Games',
  },
];

// Lives at the bottom of Settings (Profile), inside its own fold — it does not
// need a page of its own. Every topic starts closed; tap one to open it.
export function HowToGuide() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Tap any topic to see simple steps. You can’t break anything — every change can be undone.</p>

      {TOPICS.map((t, i) => {
        const isOpen = open === t.id;
        return (
          <Card key={t.id} className={`howto${isOpen ? ' is-open' : ''}`}>
            <button type="button" className="howto__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.id)}>
              <span className="howto__n">{i + 1}</span>
              <span className="howto__ic"><Icon name={t.icon} size={24} /></span>
              <span className="howto__t">{t.title}</span>
              <Icon name="chevron" size={22} className="howto__chev" />
            </button>
            {isOpen && (
              <div className="howto__body">
                <p className="howto__like"><Icon name="sparkle" size={18} /> <span>{t.like}</span></p>
                <ol className="howto__steps">
                  {t.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <Button icon="chevron" onClick={() => navigate(t.go, t.state ? { state: t.state } : undefined)}>{t.goLabel || 'Show me'}</Button>
              </div>
            )}
          </Card>
        );
      })}

      <p className="muted" style={{ margin: 0 }}>
        MyDay keeps your medicines, visits and health notes in one simple place, reminds you when it
        is time, and lets the family you choose know if a dose is missed.
        Stuck? Ask a family member to open this guide with you.
      </p>
    </div>
  );
}
