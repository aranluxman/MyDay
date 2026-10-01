import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Spinner } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { useUI } from '../context/UIContext.jsx';
import { scanMedicinePhotos, MAX_SCAN_PHOTOS } from '../lib/ai.js';
import { uploadMedPhoto, deleteMedPhoto } from '../lib/db.js';
import { normaliseScan } from '../lib/aiParse.js';

// "Add from a photo": take up to three pictures of the box or bottle — front,
// back, pharmacy label — and the AI reads them together to fill in the Add
// Medicine form. The front alone often has the name but not the directions.
// Nothing is saved here: the result opens the wizard on its review step, so the
// person checks it against the label first.
//
// The first photo is kept as the medicine's picture, so the list shows the box
// they actually have. If that upload fails the scan still counts.
export function MedicinePhotoScan({ onResult, variant = 'primary', label = 'Add from a photo' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon="camera" onClick={() => setOpen(true)}>{label}</Button>
      {open && <MedicinePhotoTray onClose={() => setOpen(false)}
        onResult={(scan) => { setOpen(false); onResult(scan); }} />}
    </>
  );
}

const SLOT_HINTS = ['Front of the box', 'Back or side', 'Pharmacy label'];

// The sheet itself, so other screens (the "how do you want to add it?" choice)
// can open it straight away.
export function MedicinePhotoTray({ onResult, onClose }) {
  const ui = useUI();
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const run = useRef(0);
  const [photos, setPhotos] = useState([]); // { file, url }
  const [busy, setBusy] = useState(false);
  const [notMedicine, setNotMedicine] = useState(null);
  const room = MAX_SCAN_PHOTOS - photos.length;

  // Preview URLs hold the whole photo in memory until released.
  const urls = useRef(new Set());
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  function add(e) {
    const picked = [...(e.target.files || [])];
    e.target.value = '';
    if (!picked.length) return;
    const images = picked.filter((f) => f.type.startsWith('image/'));
    if (images.length < picked.length) ui.toast('Please choose photos only.', 'bad');
    if (images.length > room) ui.toast(`Up to ${MAX_SCAN_PHOTOS} photos — we kept the first ${room || 'ones'}.`, 'info');
    const next = images.slice(0, room).map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return { file, url };
    });
    if (next.length) { setNotMedicine(null); setPhotos((p) => [...p, ...next].slice(0, MAX_SCAN_PHOTOS)); }
  }

  function remove(i) {
    setPhotos((p) => {
      const gone = p[i];
      if (gone) { URL.revokeObjectURL(gone.url); urls.current.delete(gone.url); }
      return p.filter((_, j) => j !== i);
    });
  }

  async function read() {
    if (!photos.length || busy) return;
    const id = ++run.current;
    setBusy(true);
    setNotMedicine(null);
    try {
      const files = photos.map((p) => p.file);
      const [scanned, upload] = await Promise.allSettled([scanMedicinePhotos(files), uploadMedPhoto(files[0])]);
      const photo = upload.status === 'fulfilled' ? upload.value : null;
      // A photo is only worth keeping if it becomes a medicine's picture.
      const discard = () => { if (photo) deleteMedPhoto(photo).catch(() => {}); };
      if (id !== run.current) { discard(); return; } // cancelled while reading
      if (scanned.status === 'rejected') { discard(); throw scanned.reason; }
      const scan = normaliseScan(scanned.value);
      if (!scan.isMedicine || !scan.form.name) {
        discard();
        setNotMedicine(scan.warnings[0] || 'We could not find a medicine name in those photos.');
        return;
      }
      onResult({ ...scan, photoCount: files.length, form: { ...scan.form, photo_path: photo } });
    } catch (err) {
      if (id === run.current) ui.toast(err.message || 'Could not read those photos.', 'bad');
    } finally {
      if (id === run.current) setBusy(false);
    }
  }

  // Closing while reading cancels the read; its result is thrown away.
  function close() { run.current++; onClose(); }

  return (
    <Modal title={busy ? 'Reading your label' : 'Photos of your medicine'} onClose={close}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={add} style={{ display: 'none' }} />
      <input ref={libraryRef} type="file" accept="image/*" multiple onChange={add} style={{ display: 'none' }} />

      {busy ? (
        <>
          <Spinner label={photos.length > 1 ? `Reading all ${photos.length} photos…` : 'Looking for the name, dose and directions…'} />
          <p className="muted" style={{ textAlign: 'center' }}>
            This takes a few seconds. You'll check everything before it's saved.
          </p>
        </>
      ) : (
        <div className="phototray">
          <p className="muted phototray__lead">
            Add up to {MAX_SCAN_PHOTOS} photos of the <b>same</b> medicine. More sides means MyDay can
            read the dose and directions too, not just the name.
          </p>

          <div className="phototray__slots">
            {Array.from({ length: MAX_SCAN_PHOTOS }, (_, i) => {
              const p = photos[i];
              if (p) {
                return (
                  <div key={p.url} className="phototray__slot phototray__slot--full">
                    <img src={p.url} alt={`Photo ${i + 1}`} />
                    <button type="button" className="phototray__x" aria-label={`Remove photo ${i + 1}`}
                      onClick={() => remove(i)}><Icon name="close" size={16} stroke={2.8} /></button>
                  </div>
                );
              }
              const next = i === photos.length;
              return (
                <button key={`empty-${i}`} type="button" disabled={!next}
                  className={`phototray__slot phototray__slot--empty${next ? ' is-next' : ''}`}
                  onClick={() => cameraRef.current?.click()} aria-label={`Take photo ${i + 1}: ${SLOT_HINTS[i]}`}>
                  <Icon name={next ? 'camera' : 'plus'} size={26} />
                  <span>{SLOT_HINTS[i]}</span>
                </button>
              );
            })}
          </div>

          {notMedicine && (
            <div className="aiscan-note aiscan-note--warn" role="alert">
              <Icon name="info" size={20} />
              <div>
                <b>{notMedicine}</b>
                <div>Tips: fill the frame with the label, use good light, and hold the phone steady.</div>
              </div>
            </div>
          )}

          {room > 0 && (
            <div className="btn-row">
              <Button variant={photos.length ? 'ghost' : 'primary'} icon="camera" onClick={() => cameraRef.current?.click()}>
                {photos.length ? 'Take another' : 'Take a photo'}
              </Button>
              <Button variant="ghost" icon="image" onClick={() => libraryRef.current?.click()}>
                My photos
              </Button>
            </div>
          )}

          {!!photos.length && (
            <Button size="lg" icon="sparkle" onClick={read}>
              {photos.length === 1 ? 'Read this photo' : `Read these ${photos.length} photos`}
            </Button>
          )}
          <PhotoPrivacyNote />
        </div>
      )}
    </Modal>
  );
}

// Shown under the photo button: the picture goes to OpenAI to be read.
export function PhotoPrivacyNote() {
  return (
    <p className="muted aiscan-privacy">
      Your photos are sent securely to our AI partner (OpenAI) only to read the label.
    </p>
  );
}
