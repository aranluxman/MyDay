import { useRef, useState } from 'react';
import { Button, Modal, Spinner } from './ui.jsx';
import { useUI } from '../context/UIContext.jsx';
import { scanMedicinePhoto } from '../lib/ai.js';
import { uploadMedPhoto, deleteMedPhoto } from '../lib/db.js';
import { normaliseScan } from '../lib/aiParse.js';

// "Add from a photo": take a picture of the box or bottle and the AI fills in
// the Add Medicine form. Nothing is saved here — the result opens the wizard on
// its review step, so the person checks it against the label first.
//
// The same photo is kept as the medicine's picture, so the list shows the box
// they actually have. If that upload fails the scan still counts.
export function MedicinePhotoScan({ onResult, variant = 'primary', label = 'Add from a photo' }) {
  const ui = useUI();
  const fileRef = useRef(null);
  const run = useRef(0);
  const [busy, setBusy] = useState(false);
  const [notMedicine, setNotMedicine] = useState(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { ui.toast('Please choose a photo.', 'bad'); return; }
    const id = ++run.current;
    setBusy(true);
    try {
      const [read, upload] = await Promise.allSettled([scanMedicinePhoto(file), uploadMedPhoto(file)]);
      const photo = upload.status === 'fulfilled' ? upload.value : null;
      // A photo is only worth keeping if it becomes a medicine's picture.
      const discard = () => { if (photo) deleteMedPhoto(photo).catch(() => {}); };
      if (id !== run.current) { discard(); return; } // cancelled while reading
      if (read.status === 'rejected') { discard(); throw read.reason; }
      const scan = normaliseScan(read.value);
      if (!scan.isMedicine || !scan.form.name) {
        discard();
        setNotMedicine(scan.warnings[0] || 'We could not find a medicine name in that photo.');
        return;
      }
      onResult({ ...scan, form: { ...scan.form, photo_path: photo } });
    } catch (err) {
      if (id === run.current) ui.toast(err.message || 'Could not read that photo.', 'bad');
    } finally {
      if (id === run.current) setBusy(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pick} style={{ display: 'none' }} />
      <Button variant={variant} icon="sparkle" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Reading the label…' : label}
      </Button>

      {busy && (
        <Modal title="Reading your label" onClose={() => { run.current++; setBusy(false); }}>
          <Spinner label="Looking for the name, dose and directions…" />
          <p className="muted" style={{ textAlign: 'center' }}>
            This takes a few seconds. You'll check everything before it's saved.
          </p>
        </Modal>
      )}

      {notMedicine && (
        <Modal title="Let's try that again" onClose={() => setNotMedicine(null)}>
          <p className="dialog-msg">{notMedicine}</p>
          <p className="muted">
            Tips: fill the frame with the label, use good light, and hold the phone steady.
          </p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setNotMedicine(null)}>Close</Button>
            <Button icon="sparkle" onClick={() => { setNotMedicine(null); fileRef.current?.click(); }}>Try another photo</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

// Shown under the photo button: the picture goes to OpenAI to be read.
export function PhotoPrivacyNote() {
  return (
    <p className="muted aiscan-privacy">
      Your photo is sent securely to our AI partner (OpenAI) only to read the label.
    </p>
  );
}
