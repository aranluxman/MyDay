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
      'Look at the bottom of the screen. There are six buttons.',
      'Home shows your day. Updates is your health diary. Medicine is your pill list. Visits are your appointments. Games are brain games. Profile is your settings.',
      'The button that is lit up blue is the room you are in now.',
    ],
    go: '/',
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
    go: '/',
  },
  {
    id: 'add', icon: 'plus', title: 'Adding a medicine',
    like: 'The blue + button is like a “new” drawer — everything you can add is inside.',
    steps: [
      'Tap the round blue + button near the bottom right.',
      'A small menu opens. Tap “Add a medicine”.',
      'Answer one question at a time: its name, how much, what time, how often.',
      'Tip: on the Medicine page you can tap “Add from a photo” and take a picture of the box — MyDay fills it in for you to check.',
      'Tap Save on the last step.',
    ],
    go: '/medication',
  },
  {
    id: 'notes', icon: 'pulse', title: 'Writing how you feel',
    like: 'Your health diary is like a notebook you bring to the doctor — so you never forget what happened.',
    steps: [
      'Open Updates at the bottom.',
      'Tap a quick button like “Headache” or “Tired”, or tap “Add a health note”.',
      'Write what happened, then tap “Save note”.',
      'Something feels serious? Don’t write it down first — call 911.',
    ],
    go: '/updates',
  },
  {
    id: 'visits', icon: 'calendar', title: 'Doctor visits',
    like: 'Like the calendar on your fridge, but it reminds you before you need to leave.',
    steps: [
      'Tap the + button, then “Add a visit” — or open Visits at the bottom.',
      'Type who you are seeing, the day and the time.',
      'MyDay reminds you before the visit.',
    ],
    go: '/appointments',
  },
  {
    id: 'guardian', icon: 'user', title: 'Letting family keep an eye out',
    like: 'A guardian is like a neighbour who checks your porch light is on — they can look, but never touch.',
    steps: [
      'Open Profile. “Guardians” is near the top.',
      'Tap “Invite a guardian” and type their name.',
      'Read them the 6-digit code. On their phone they open myday-1rn.pages.dev/guardian and type it in.',
      'They will see if you took your medicines and get an alert if you miss one. They can never change anything.',
    ],
    go: '/profile',
  },
  {
    id: 'alerts', icon: 'bell', title: 'Turning on reminders',
    like: 'Like setting an alarm clock — MyDay rings when it is time for a pill.',
    steps: [
      'Open Profile, then “Notification settings”.',
      'First add MyDay to your home screen when it asks — then the alerts show as MyDay.',
      'Tap “Turn on alerts on this device”, then “Allow”.',
      'Tap “Send a test alert” to check it works.',
    ],
    go: '/profile/notifications',
  },
  {
    id: 'lang', icon: 'globe', title: 'Changing the language',
    like: 'Like switching the TV to a channel in your language.',
    steps: [
      'Open Profile.',
      'Find “Language” near the top and tap the box.',
      'Pick your language. The screen reloads once and everything is in your language.',
    ],
    go: '/profile',
  },
  {
    id: 'see', icon: 'eye', title: 'Making it easier to see',
    like: 'Like putting on reading glasses — bigger words, clearer lines.',
    steps: [
      'Open Profile and scroll down to “Accessibility”.',
      'Under “Text size” tap a bigger size.',
      'Turn on “More contrast”, “Bold text” or “Bigger buttons” if they help.',
      'The moon button at the top right switches to a dark screen for night-time.',
    ],
    go: '/profile',
  },
  {
    id: 'games', icon: 'brain', title: 'Brain games',
    like: 'Like a daily crossword — a few minutes that keep the mind sharp.',
    steps: [
      'Open Games at the bottom.',
      'Pick any game and follow the words on screen.',
      'Try one a day. Your progress is saved.',
    ],
    go: '/games',
  },
];

export default function HowTo() {
  const navigate = useNavigate();
  const [open, setOpen] = useState('bar');

  return (
    <div className="stack">
      <Card className="howto-hero">
        <span className="howto-hero__ic"><Icon name="info" size={30} /></span>
        <div>
          <h2 className="howto-hero__t">New to MyDay? Start here.</h2>
          <p className="muted" style={{ margin: 0 }}>Tap any topic to see simple steps. You can’t break anything — every change can be undone.</p>
        </div>
      </Card>

      {TOPICS.map((t, i) => {
        const isOpen = open === t.id;
        return (
          <Card key={t.id} className={`howto${isOpen ? ' is-open' : ''}`}>
            <button className="howto__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.id)}>
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
                <Button icon="chevron" onClick={() => navigate(t.go)}>Show me</Button>
              </div>
            )}
          </Card>
        );
      })}

      <Card>
        <div className="section-title"><span className="section-title__l"><Icon name="shield" size={22} /> <span>About MyDay</span></span></div>
        <p className="muted" style={{ margin: 0 }}>
          MyDay keeps your medicines, visits and health notes in one simple place, reminds you when it
          is time, and lets the family you choose know if a dose is missed.
          Stuck? Ask a family member to open this guide with you.
        </p>
      </Card>
    </div>
  );
}
