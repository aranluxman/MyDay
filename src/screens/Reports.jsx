import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { doseHistory, listHealthLogs, listDiary } from '../lib/db.js';
import { buildReport, medicineHeadline, rangeDates, RANGES } from '../lib/report.js';
import { formatLog } from '../lib/healthLogs.js';
import { localDateStr, prettyClock, prettyDate, present } from '../lib/format.js';

const dayOf = (iso) => localDateStr(undefined, new Date(iso));
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// Reports: the person's own records for a period, as they are. The page is
// the preview; "Save as PDF or print" hands that same page to the device's
// print dialog. Nothing is sent anywhere: sharing is something the person
// does themselves, afterwards, with the file or the paper.
//
// A report is always about the signed-in person. Reports about someone a
// caregiver supports need a server-side permission check and are not offered
// here, rather than being faked by hiding a button.
export default function Reports() {
  const { profile } = useApp();
  const [range, setRange] = useState('7');
  const [include, setInclude] = useState({ medicines: true, health: true, diary: false });
  const days = RANGES.find((r) => r.id === range).days;
  const { from, to } = rangeDates(days, localDateStr());
  const windowMinutes = profile?.alert_window_minutes ?? 60;

  const { data, loading, error, reload } = useAsync(async () => {
    const fromTs = new Date(`${from}T00:00:00`).toISOString();
    const [doses, logs, diary] = await Promise.all([doseHistory(from, to), listHealthLogs({ fromIso: fromTs }), listDiary(400)]);
    return { doses, logs, diary };
  }, [from, to]);

  const generated = new Date();
  const report = data ? buildReport({ ...data, from, to, dayOf, opts: { windowMinutes } }) : null;
  const m = report?.medicines;
  const nothingChosen = !include.medicines && !include.health && !include.diary;
  const toggle = (key) => setInclude((v) => ({ ...v, [key]: !v[key] }));

  return (
    <div className="stack reports">
      <div className="report-controls no-print stack">
        <p className="page-intro">Review your own records, choose what to include, then save or print the page.</p>
        <div className="field">
          <label className="field__label" htmlFor="rep-range">Period</label>
          <select id="rep-range" className="input input--select" value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <fieldset className="rep-include">
          <legend>Include in report</legend>
          {[['medicines', 'Medicines'], ['health', 'Health logs'], ['diary', 'Diary notes']].map(([key, label]) => (
            <label key={key} className="rep-check">
              <input type="checkbox" checked={include[key]} onChange={() => toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
          <p className="rep-include__hint">Diary notes are personal, so they are left out unless you tick them.</p>
        </fieldset>
        <Button icon="download" size="lg" disabled={!report || nothingChosen} onClick={() => window.print()}>Save as PDF or print</Button>
        <p className="health-note"><Icon name="lock" size={20} />
          <span>Nothing is sent automatically. In the print window, choose “Save as PDF” to keep a file, then share it yourself if you want to.</span></p>
      </div>

      {loading && <SkeletonCard lines={4} />}
      {error && <Card className="center"><p className="lead">We could not load your records.</p><Button onClick={reload}>Try again</Button></Card>}

      {report && (
        <article className="report" aria-labelledby="rep-title">
          <header className="report__head">
            <h2 className="report__title" id="rep-title">Report preview</h2>
            <dl className="report__meta">
              <div><dt>Person</dt><dd translate="no">{profile?.full_name || 'Name not entered'}</dd></div>
              <div><dt>Period</dt><dd>{prettyDate(from)} to {prettyDate(to)} ({report.days} days)</dd></div>
              <div><dt>Created</dt><dd>{prettyDate(localDateStr())}, {prettyClock(generated)}</dd></div>
            </dl>
            <p className="report__disclaimer">This is a record of what was entered in MyDay. It is not a medical assessment.</p>
          </header>

          {nothingChosen && <p className="report__gap">Nothing is selected. Tick at least one item above.</p>}

          {include.medicines && (
            <section className="report__sec" aria-labelledby="rep-med">
              <h3 id="rep-med">Medication records</h3>
              <p className="report__big">{medicineHeadline(m)}</p>
              {m.scheduled > 0 && (
                <>
                  <ul className="report__counts">
                    <li><b>{m.taken}</b> recorded as taken</li>
                    <li><b>{m.skipped}</b> marked “Not today”</li>
                    <li><b>{m.notRecorded}</b> not recorded</li>
                  </ul>
                  <p className="report__fine">
                    Counted: the {m.scheduled} scheduled dose{m.scheduled === 1 ? '' : 's'} in this period whose time has passed.
                    “Not recorded” means MyDay has no record for that dose; it does not mean the dose was not taken.
                    {m.open > 0 && ` ${m.open} dose${m.open === 1 ? ' is' : 's are'} still open today and not counted.`}
                    {m.asNeeded > 0 && ` ${m.asNeeded} “when needed” dose${m.asNeeded === 1 ? ' was' : 's were'} logged and ${m.asNeeded === 1 ? 'is' : 'are'} not part of the count.`}
                  </p>
                  <div className="report__scroll">
                    <table className="report__table">
                      <caption>By medicine</caption>
                      <thead><tr><th scope="col">Medicine</th><th scope="col">Taken</th><th scope="col">Not today</th><th scope="col">Not recorded</th><th scope="col">Scheduled</th></tr></thead>
                      <tbody>
                        {m.perMedicine.filter((x) => x.scheduled > 0).map((x) => (
                          <tr key={x.name}><th scope="row" translate="no">{x.name}</th><td>{x.taken}</td><td>{x.skipped}</td><td>{x.notRecorded}</td><td>{x.scheduled}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="report__scroll">
                    <table className="report__table">
                      <caption>By day</caption>
                      <thead><tr><th scope="col">Day</th><th scope="col">Taken</th><th scope="col">Not today</th><th scope="col">Not recorded</th></tr></thead>
                      <tbody>
                        {m.perDay.map((d) => {
                          const any = d.taken + d.skipped + d.notRecorded + d.open > 0;
                          return (
                            <tr key={d.day}><th scope="row">{shortDay(d.day)}</th>
                              {any ? <><td>{d.taken}</td><td>{d.skipped}</td><td>{d.notRecorded}{d.open ? ` (+${d.open} open)` : ''}</td></>
                                : <td colSpan={3} className="report__none">No scheduled doses</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {include.health && (
            <section className="report__sec" aria-labelledby="rep-health">
              <h3 id="rep-health">Health logs</h3>
              <div className="report__scroll">
                <table className="report__table">
                  <thead><tr><th scope="col">Measurement</th><th scope="col">Days logged</th><th scope="col">Summary</th><th scope="col">Latest</th></tr></thead>
                  <tbody>
                    {report.health.map((h) => (
                      <tr key={h.kind}><th scope="row">{h.label}</th>
                        {h.count ? (
                          <><td>{h.daysLogged} of {h.totalDays}</td><td>{h.summary}</td>
                            <td>{formatLog(h.latest, { weightUnit: h.kind === 'weight' ? 'kg' : undefined })}<br /><small>{shortDay(dayOf(h.latest.logged_at))}</small></td></>
                        ) : <td colSpan={3} className="report__none">No entries in this period</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="report__fine">Units: water in glasses or ml as entered, sleep in hours and minutes, weight in kg, blood pressure in mmHg, heart rate in beats per minute (bpm). Days without an entry are left empty; nothing is estimated.</p>
              {report.health.some((h) => h.count) && (
                <div className="report__scroll">
                  <table className="report__table">
                    <caption>Every entry</caption>
                    <thead><tr><th scope="col">When</th><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Note</th></tr></thead>
                    <tbody>
                      {report.health.flatMap((h) => h.rows.map((r) => ({ ...r, label: h.label })))
                        .sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at)).map((r) => (
                          <tr key={r.id}><th scope="row">{shortDay(dayOf(r.logged_at))}, {prettyClock(new Date(r.logged_at))}</th>
                            <td>{r.label}</td><td>{formatLog(r, { weightUnit: r.kind === 'weight' ? 'kg' : undefined })}</td><td>{r.note || ''}</td></tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {include.diary && (
            <section className="report__sec" aria-labelledby="rep-diary">
              <h3 id="rep-diary">Diary notes</h3>
              {report.notes.length ? (
                <ul className="report__notes">
                  {report.notes.map((n) => (
                    <li key={n.id}>
                      <b>{shortDay(dayOf(n.entry_at))}, {prettyClock(new Date(n.entry_at))}{present(n.title) ? ` · ${present(n.title)}` : ''}</b>
                      {present(n.body) && <p>{present(n.body)}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="report__none">No diary notes in this period.</p>}
            </section>
          )}
        </article>
      )}
    </div>
  );
}
