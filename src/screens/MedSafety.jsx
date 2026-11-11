import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { MedicineInsights } from '../components/MedicineInsights.jsx';
import { listMedications, listContacts } from '../lib/db.js';
import { SAFETY_CHECKS, runSafetyCheck, statusWords, medicineLine } from '../lib/medSafety.js';
import { telHref } from '../lib/contacts.js';
import { prettyTime, prettyDate, prettyClock, localDateStr } from '../lib/format.js';

// Medication safety. MyDay is not connected to a verified clinical database,
// so this page does two honest things: it says plainly that nothing has been
// checked (and that this is not an all-clear), and it makes the real check —
// a pharmacist looking at the full list — as easy as possible.
//
// Nothing here changes a schedule, a dose or the spacing between doses.
export default function MedSafety() {
  const navigate = useNavigate();
  const { profile } = useApp();
  const { data, loading, error, reload } = useAsync(async () => {
    const [meds, contacts] = await Promise.all([listMedications(), listContacts().catch(() => [])]);
    return { meds: meds.filter((m) => m.active !== false), contacts };
  }, []);
  const [results, setResults] = useState({});
  useEffect(() => {
    if (!data) return;
    let live = true;
    Promise.all(SAFETY_CHECKS.map(async (c) => [c.id, await runSafetyCheck(c.id, data.meds)]))
      .then((pairs) => { if (live) setResults(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [data]);

  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={3} /></div>;
  if (error) return <Card className="center"><p className="lead">We could not load your medicines.</p><Button onClick={reload}>Try again</Button></Card>;

  const { meds, contacts } = data;
  const pharmacy = contacts.find((c) => c.type === 'pharmacy' && telHref(c.phone));

  return (
    <div className="stack safety">
      <p className="safety-banner no-print" role="note"><Icon name="info" size={22} />
        <span><b>Information, not medical advice.</b> MyDay never changes your medicines, doses or times. For questions about your medicines, ask your pharmacist or doctor.</span></p>

      <div className="stack no-print">
        {SAFETY_CHECKS.map((c) => {
          const r = results[c.id] || { state: 'not_connected' };
          const words = statusWords(r);
          return (
            <section key={c.id} className="card safety-card" aria-labelledby={`safety-${c.id}`}>
              <div className="safety-card__head">
                <span className="rd-row__ic" aria-hidden="true"><Icon name={c.icon} size={24} /></span>
                <div>
                  <h2 className="safety-card__t" id={`safety-${c.id}`}>{c.title}</h2>
                  <span className={`qs__status qs__status--${words.tone}`}><Icon name={words.tone === 'warn' ? 'alert' : 'info'} size={16} stroke={2.6} /> {words.label}</span>
                </div>
              </div>
              <p className="safety-card__d">{c.what}</p>
              {r.state === 'not_connected' && (
                <p className="safety-card__d">
                  MyDay is not connected to a verified source for this, so <b>your medicines have not been checked</b>.
                  That is not the same as finding nothing. Your pharmacist can check your full list.
                </p>
              )}
              {r.state === 'nothing_to_check' && <p className="safety-card__d">Add your medicines and this can be checked.</p>}
              {r.state === 'error' && <p className="safety-card__d">{r.message}</p>}
              {r.state === 'checked' && (
                <>
                  {r.findings.length ? (
                    <ul className="safety-findings">{r.findings.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
                  ) : <p className="safety-card__d">{r.source} lists nothing for these medicines. This is not a guarantee; ask your pharmacist to review your list.</p>}
                  <p className="safety-card__src">Source: {r.source}. Data updated {prettyDate(r.updated)}. Checked {prettyDate(localDateStr(undefined, new Date(r.checkedAt)))}.</p>
                </>
              )}
            </section>
          );
        })}
      </div>

      <section className="card safety-list" aria-labelledby="safety-list-t">
        <h2 className="safety-card__t" id="safety-list-t">Medicine list for your pharmacist</h2>
        <p className="safety-card__d">
          <span translate="no">{profile?.full_name || 'Name not entered'}</span> · {prettyDate(localDateStr())}, {prettyClock(new Date())}.
          The medicines saved in MyDay, exactly as entered. It may not include everything you take.
        </p>
        {meds.length ? (
          <div className="report__scroll">
            <table className="report__table">
              <thead><tr><th scope="col">Medicine</th><th scope="col">Amount</th><th scope="col">When</th></tr></thead>
              <tbody>
                {meds.map((m) => {
                  const l = medicineLine(m, prettyTime);
                  return (
                    <tr key={m.id}>
                      <th scope="row"><span translate="no">{l.name}</span>{l.strength ? <><br /><small>{l.strength} strength</small></> : null}</th>
                      <td>{l.amount || 'Not entered'}</td>
                      <td>{l.when}{l.instructions ? <><br /><small>{l.instructions}</small></> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="safety-card__d">No medicines are saved in MyDay yet.</p>}
        <div className="btn-row no-print" style={{ marginTop: 12 }}>
          <Button variant="ghost" icon="download" disabled={!meds.length} onClick={() => window.print()}>Print or save this list</Button>
          {pharmacy && (
            <a className="btn btn--primary btn--md btn--full" href={telHref(pharmacy.phone)} aria-label={`Call ${pharmacy.name}, pharmacy, ${pharmacy.phone}`}>
              <Icon name="phone" size={20} /> <span>Call <span translate="no">{pharmacy.name}</span></span>
            </a>
          )}
        </div>
        {!pharmacy && (
          <button type="button" className="chat-link no-print" style={{ marginTop: 10 }} onClick={() => navigate('/contacts', { state: { add: 'contact', contactType: 'pharmacy' } })}>
            <Icon name="plus" size={22} /> <span>Add your pharmacy’s phone number</span> <Icon name="chevron" size={20} />
          </button>
        )}
      </section>

      <section className="stack no-print" aria-labelledby="safety-ai-t">
        <h2 className="settings-group" id="safety-ai-t">General information</h2>
        <p className="page-intro" style={{ margin: 0 }}>Written by an AI helper from general knowledge. It is not a safety check and has not reviewed how your medicines act together.</p>
        <MedicineInsights meds={meds} />
        <button type="button" className="rd-row rd-row--card" onClick={() => navigate('/medication/ask')}>
          <span className="rd-row__ic" aria-hidden="true"><Icon name="chat" size={24} /></span>
          <span className="rd-row__main"><span className="rd-row__t">Ask about your medicines</span><span className="rd-row__d">General questions; dosing questions go to your pharmacist</span></span>
          <Icon name="chevron" size={22} className="rd-row__chev" />
        </button>
      </section>
    </div>
  );
}
