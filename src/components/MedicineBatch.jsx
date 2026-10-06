import { useEffect, useState } from 'react';
import { Button, Modal } from './ui.jsx';
import { MedicineWizard } from './MedicineWizard.jsx';
import { MedicinePhotoTray } from './MedicinePhotoScan.jsx';
import { useUI } from '../context/UIContext.jsx';
import { saveMedicationsBulk, refreshDoses, deleteMedPhoto } from '../lib/db.js';
import { readMedicineBatch, writeMedicineBatch, clearMedicineBatch } from '../lib/medicineBatch.js';
import { toMedicationPayload } from '../lib/medicationPayload.js';
import { describeSchedule } from '../lib/schedule.js';
import { prettyTime } from '../lib/format.js';

export function MedicineBatch({ userId, onClose, onSaved }) {
  const ui = useUI();
  const [initial] = useState(() => readMedicineBatch(userId));
  const [items, setItems] = useState(initial.items);
  const [working, setWorking] = useState(initial.working);
  const [showWizard, setShowWizard] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { writeMedicineBatch(userId, { items, working }); }, [userId, items, working]);

  function startHand() {
    setWorking({ form: null, step: 0, scan: null, index: null });
    setShowWizard(true);
  }

  function startPhoto() { setShowPhoto(true); }

  function scanned(scan) {
    setShowPhoto(false);
    setWorking({ form: scan.form, step: 5, scan, index: null });
    setShowWizard(true);
  }

  function edit(index) {
    const item = items[index];
    setWorking({ form: item.form, step: 5, scan: item.scan || null, index });
    setShowWizard(true);
  }

  function stage(form) {
    const next = { form, scan: working?.scan || null };
    if (working?.index != null) {
      setItems((prev) => prev.map((item, index) => index === working.index ? { ...item, ...next } : item));
    } else {
      setItems((prev) => [...prev, { id: crypto.randomUUID(), ...next }]);
    }
    setWorking(null);
    setShowWizard(false);
    ui.toast('Added to review. Save all when you are ready.');
  }

  function deleteUnusedPhoto(path, exceptIndex = -1) {
    if (path && !items.some((item, index) => index !== exceptIndex && item.form.photo_path === path)) {
      deleteMedPhoto(path).catch(() => {});
    }
  }

  function discardWorking() {
    const path = working?.form?.photo_path;
    if (working?.index == null || path !== items[working.index]?.form.photo_path) deleteUnusedPhoto(path);
    setWorking(null);
    setShowWizard(false);
  }

  function remove(index) {
    deleteUnusedPhoto(items[index]?.form.photo_path, index);
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function discardBatch() {
    const ok = await ui.confirm({
      title: 'Discard these medicines?',
      message: 'The medicines in this review have not been saved to your list.',
      confirmLabel: 'Discard draft', danger: true,
    });
    if (!ok) return;
    const paths = new Set([...items.map((item) => item.form.photo_path), working?.form?.photo_path].filter(Boolean));
    paths.forEach((path) => deleteMedPhoto(path).catch(() => {}));
    clearMedicineBatch(userId);
    setItems([]);
    setWorking(null);
    onClose();
  }

  async function saveAll() {
    if (!items.length || working || busy) return;
    setBusy(true);
    try {
      await saveMedicationsBulk(items);
      clearMedicineBatch(userId);
      setItems([]);
      setWorking(null);
      try { await refreshDoses(); }
      catch { ui.toast('Medicines saved. Today’s doses may take a moment to appear.', 'info'); }
      ui.toast(`${items.length} ${items.length === 1 ? 'medicine' : 'medicines'} added.`);
      onSaved();
    } catch (error) {
      ui.toast(error.message || 'Could not save. Your review is still here — please try again.', 'bad');
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title="Add medicines" onClose={onClose} wide>
        <div className="medbatch">
          <p className="medbatch__intro">Add each medicine, check the list, then save them together.</p>
          {!!items.length && (
            <div className="medbatch__review" role="list" aria-label="Medicines to save">
              {items.map((item, index) => {
                const m = toMedicationPayload(item.form);
                return (
                  <div className="medbatch__item" role="listitem" key={item.id}>
                    <div className="medbatch__itemmain">
                      <b translate="no">{m.name}</b>
                      <span>{m.dose} · {describeSchedule(m, { prettyTime })}</span>
                    </div>
                    <div className="medbatch__itemactions">
                      <Button size="sm" variant="ghost" full={false} onClick={() => edit(index)} disabled={!!working || busy}>Edit</Button>
                      <Button size="sm" variant="danger" full={false} onClick={() => remove(index)} disabled={!!working || busy}>Remove</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!items.length && !working && <p className="medbatch__empty">No medicines in this review yet.</p>}
          {working ? (
            <div className="medbatch__unfinished">
              <p>A medicine is unfinished. Continue it or discard that draft before saving.</p>
              <div className="btn-row">
                <Button variant="ghost" onClick={() => setShowWizard(true)}>Continue medicine</Button>
                <Button variant="danger" onClick={discardWorking}>Discard unfinished</Button>
              </div>
            </div>
          ) : (
            <div className="medbatch__add">
              <Button icon="plus" variant="ghost" onClick={startHand} disabled={busy}>Type a medicine</Button>
              <Button icon="camera" variant="ghost" onClick={startPhoto} disabled={busy}>Scan a label</Button>
            </div>
          )}
          <Button size="lg" icon="check" onClick={saveAll} disabled={!items.length || !!working || busy}>
            {busy ? 'Saving medicines…' : `Save all ${items.length || ''} ${items.length === 1 ? 'medicine' : 'medicines'}`}
          </Button>
          {(!!items.length || !!working) && <p className="medbatch__saved">Your review is kept on this device if you close it.</p>}
          {(!!items.length || !!working) && <Button variant="danger" onClick={discardBatch} disabled={busy}>Discard this review</Button>}
        </div>
      </Modal>
      {showPhoto && <MedicinePhotoTray onClose={() => setShowPhoto(false)} onResult={scanned} />}
      {showWizard && working && <MedicineWizard key={working.index ?? 'new'} stageDraft={working}
        prefill={working.scan} onDraftChange={(progress) => setWorking((w) => w ? { ...w, ...progress } : w)}
        onStage={stage} onClose={() => setShowWizard(false)} />}
    </>
  );
}
