import { useState } from 'react';
import { Card, Button, SkeletonCard } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { analyzeMedicines } from '../lib/ai.js';
import { medsSignature } from '../lib/aiParse.js';

// "How your medicines work together": what each one is for, its benefits, and
// how the list serves shared goals (heart, bones, blood sugar…).
//
// Only runs when asked — each run costs money — and the answer is kept on this
// device until the medicine list changes, so reopening the tab is free.
const KEY = 'myday_med_insights';

function loadCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c?.userId === userId ? c : null;
  } catch { return null; }
}

export function MedicineInsights({ meds }) {
  const { user, profile } = useApp();
  const ui = useUI();
  const [cache, setCache] = useState(() => loadCache(user?.id));
  const [busy, setBusy] = useState(false);
  const [openMed, setOpenMed] = useState(null);

  if (!meds?.length) return null;
  const sig = medsSignature(meds);
  const result = cache?.result;
  const stale = !!result && cache.sig !== sig;

  async function run() {
    setBusy(true);
    try {
      const r = await analyzeMedicines(meds, profile?.goal);
      const next = { userId: user?.id, sig, at: Date.now(), result: r };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      setCache(next);
      setOpenMed(null);
    } catch (e) {
      ui.toast(e.message || 'Could not explain your medicines right now.', 'bad');
    }
    setBusy(false);
  }

  return (
    <Card className="insights">
      <div className="section-title">
        <span className="section-title__l"><Icon name="sparkle" size={22} /> <span>How your medicines work together</span></span>
      </div>

      {busy ? (
        <div className="stack" aria-live="polite">
          <p className="muted" style={{ margin: 0 }}>Looking at your {meds.length} medicine{meds.length === 1 ? '' : 's'}…</p>
          <SkeletonCard lines={3} />
        </div>
      ) : !result ? (
        <>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            See what each medicine is for, its benefits, and how they team up to help you — in plain words.
          </p>
          <Button icon="sparkle" onClick={run}>Explain my medicines</Button>
        </>
      ) : (
        <div className="stack">
          {stale && (
            <div className="insights__stale" role="status">
              <Icon name="info" size={18} />
              <span>Your medicine list has changed since this was written.</span>
              <Button variant="ghost" size="sm" full={false} icon="refresh" onClick={run}>Update</Button>
            </div>
          )}

          {result.overview && <p className="insights__overview">{result.overview}</p>}

          {!!result.together?.goals?.length && (
            <section>
              <h3 className="subsection">Working as a team</h3>
              {result.together.summary && <p className="muted" style={{ marginTop: 0 }}>{result.together.summary}</p>}
              <ul className="insights__goals">
                {result.together.goals.map((g) => (
                  <li key={g.goal} className="insights__goal">
                    <div className="insights__goalt">{g.goal}</div>
                    <div className="chips">
                      {(g.medicines || []).map((n) => <span key={n} className="chip is-on chip--static">{n}</span>)}
                    </div>
                    <p className="insights__how">{g.how}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="subsection">Each medicine</h3>
            <ul className="insights__meds">
              {(result.medicines || []).map((m, i) => {
                const open = openMed === i;
                return (
                  <li key={`${m.name}-${i}`} className="insights__med">
                    <button type="button" className="insights__medhead" aria-expanded={open}
                      onClick={() => setOpenMed(open ? null : i)}>
                      <span className="insights__medname">{m.name}</span>
                      <span className="insights__medsub">{m.what_it_is}</span>
                      <Icon name="chevron" size={20} style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
                    </button>
                    {open && (
                      <div className="insights__medbody">
                        {!!m.helps_with?.length && (
                          <>
                            <div className="insights__label">Helps with</div>
                            <div className="chips">
                              {m.helps_with.map((h) => <span key={h} className="chip chip--static">{h}</span>)}
                            </div>
                          </>
                        )}
                        {!!m.benefits?.length && (
                          <>
                            <div className="insights__label">Benefits</div>
                            <ul className="insights__benefits">
                              {m.benefits.map((b) => <li key={b}><Icon name="check" size={16} /> {b}</li>)}
                            </ul>
                          </>
                        )}
                        {m.tip && <p className="insights__tip"><Icon name="star" size={16} /> {m.tip}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {!!result.ask_pharmacist?.length && (
            <section className="insights__ask">
              <h3 className="subsection"><Icon name="info" size={18} /> Worth asking your pharmacist</h3>
              <ul>
                {result.ask_pharmacist.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </section>
          )}

          <p className="insights__disclaimer">
            {result.disclaimer || 'This is general information, not medical advice. Always check with your doctor or pharmacist before changing how you take any medicine.'}
          </p>
          {!stale && (
            <Button variant="ghost" size="sm" icon="refresh" onClick={run}>Explain again</Button>
          )}
        </div>
      )}
    </Card>
  );
}
