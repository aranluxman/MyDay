import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon.jsx';
import { Card, Button, Input, Modal, HeroEmpty, SkeletonCard } from '../components/ui.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import {
  CARD_TYPES, cardTypeLabel, listCards, saveCard, deleteCard, persistOrder,
  uploadCardImage, removeCardImage, cardImageUrl, offlineCardImage,
  cacheCardsOffline, maskCardNumber, expiryLabel, isExpired, sortCards, reorder,
} from '../lib/cards.js';

// "My cards" — the wallet.
//
// The job is narrow and the constraints are the interesting part: a photo of a
// health card is the most sensitive thing in MyDay, so images live in a
// private bucket behind short-lived signed URLs, nothing is ever OCR'd or sent
// anywhere, numbers are masked until deliberately revealed, and guardians
// cannot see any of it.
//
// The one performance-shaped requirement is really a usability one: a card has
// to open with no signal, because the moment you need it is at a clinic desk
// in a basement. So images are cached by the service worker on every visit.

export default function Cards() {
  const ui = useUI();
  const state = useAsync(() => listCards(), []);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [order, setOrder] = useState(null);

  const cards = order || sortCards(state.data || []);

  // Keep every card readable offline. Runs on each load, so a newly added card
  // is cached before the person ever needs it.
  useEffect(() => {
    if (state.data?.length) cacheCardsOffline(state.data).catch(() => {});
  }, [state.data]);

  useEffect(() => { setOrder(null); }, [state.data]);

  async function move(from, to) {
    const next = reorder(cards, from, to);
    setOrder(next);
    try { await persistOrder(next); }
    catch { ui.toast('Could not save the new order.', 'bad'); setOrder(null); }
  }

  async function remove(card) {
    const ok = await ui.confirm({
      title: `Delete ${card.label}?`,
      message: 'The card and its photos will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      await deleteCard(card);
      state.reload();
      ui.toast('Card deleted.', 'info');
    } catch { ui.toast('Could not delete that card.', 'bad'); }
  }

  if (state.loading) {
    return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Your health card, insurance and any other card — kept private to you, and readable
        even with no signal.
      </p>

      {!cards.length ? (
        <HeroEmpty icon="cross" title="No cards yet"
          action={<Button icon="plus" onClick={() => setEditing({})}>Add your first card</Button>}>
          Take a photo of a card and it will always be here when someone asks for it.
        </HeroEmpty>
      ) : (
        <>
          <ul className="cardlist">
            {cards.map((c, i) => (
              <li key={c.id} className="g-reveal" style={{ '--i': i }}>
                <CardRow card={c} index={i} total={cards.length}
                  onOpen={() => setViewing(c)} onEdit={() => setEditing(c)}
                  onRemove={() => remove(c)} onMove={move} />
              </li>
            ))}
          </ul>
          <Button icon="plus" onClick={() => setEditing({})}>Add a card</Button>
        </>
      )}

      <div className="cards-privacy">
        <Icon name="shield" size={20} />
        <span>
          Only you can see these. They are never shared with a guardian, and nothing on a
          card is read, scanned or sent anywhere.
        </span>
      </div>

      {editing && (
        <CardForm card={editing.id ? editing : null} nextOrder={cards.length}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); state.reload(); }} />
      )}
      {viewing && <CardViewer card={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* -------------------------------- list -------------------------------- */

function CardRow({ card, index, total, onOpen, onEdit, onRemove, onMove }) {
  const thumb = useCardImage(card.front_path);
  const expired = isExpired(card.expiry);
  const type = CARD_TYPES.find((t) => t.id === card.card_type) || CARD_TYPES[5];

  return (
    <div className="cardrow">
      <button className="cardrow__main" onClick={onOpen}
        aria-label={`Open ${card.label}${expired ? ', expired' : ''}`}>
        <span className="cardrow__thumb">
          {thumb
            ? <img src={thumb} alt="" />
            : <span className="cardrow__noimg"><Icon name={type.icon} size={26} /></span>}
        </span>
        <span className="cardrow__text">
          <span className="cardrow__label">{card.label}</span>
          <span className="cardrow__type">{cardTypeLabel(card.card_type)}</span>
          {card.card_number && (
            <span className="cardrow__num">{maskCardNumber(card.card_number)}</span>
          )}
          {card.expiry && (
            <span className={`cardrow__exp${expired ? ' is-expired' : ''}`}>
              <Icon name={expired ? 'bell' : 'clock'} size={14} />
              {expired ? `Expired ${card.expiry}` : expiryLabel(card.expiry)}
            </span>
          )}
        </span>
        <Icon name="chevron" size={24} />
      </button>

      <div className="cardrow__acts">
        {/* Reordering with buttons rather than drag: drag is genuinely hard
            with a tremor, and two big arrows are not. */}
        <button className="icon-btn" aria-label={`Move ${card.label} up`}
          disabled={index === 0} onClick={() => onMove(index, index - 1)}>
          <Icon name="chevron" size={20} style={{ transform: 'rotate(-90deg)' }} />
        </button>
        <button className="icon-btn" aria-label={`Move ${card.label} down`}
          disabled={index === total - 1} onClick={() => onMove(index, index + 1)}>
          <Icon name="chevron" size={20} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <button className="icon-btn" aria-label={`Edit ${card.label}`} onClick={onEdit}>
          <Icon name="edit" size={20} />
        </button>
        <button className="icon-btn" aria-label={`Delete ${card.label}`} onClick={onRemove}>
          <Icon name="trash" size={20} />
        </button>
      </div>
    </div>
  );
}

/**
 * A card image as a displayable URL: a fresh signed URL when online, the
 * service-worker copy when not. Never throws — a missing image just renders
 * as the type icon.
 */
function useCardImage(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    if (!path) { setUrl(null); return; }
    (async () => {
      const signed = await cardImageUrl(path);
      if (!alive) return;
      if (signed) { setUrl(signed); return; }
      // Offline: fall back to whatever the service worker kept.
      const cached = await offlineCardImage(path);
      if (!alive) { if (cached) URL.revokeObjectURL(cached); return; }
      objectUrl = cached;
      setUrl(cached);
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return url;
}

/* ------------------------------- viewer ------------------------------- */

// Full screen, because the point is holding it up at a counter.
function CardViewer({ card, onClose }) {
  const [side, setSide] = useState('front');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [bright, setBright] = useState(false);
  const [showNumber, setShowNumber] = useState(false);

  const path = side === 'front' ? card.front_path : card.back_path;
  const url = useCardImage(path);
  const hasBack = !!card.back_path;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);

  // Reset the view when flipping sides, so the back does not inherit a zoom
  // that made sense for the front.
  useEffect(() => { setZoom(1); setRotation(0); }, [side]);

  return createPortal(
    <div className={`cv${bright ? ' cv--bright' : ''}`} role="dialog" aria-modal="true" aria-label={card.label}>
      <header className="cv__bar">
        <button className="cv__btn" onClick={onClose} aria-label="Close">
          <Icon name="close" size={24} />
        </button>
        <span className="cv__title">{card.label}</span>
        <span style={{ width: 52 }} />
      </header>

      <div className="cv__stage" onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}>
        {url ? (
          <img className="cv__img" src={url} alt={`${card.label}, ${side}`}
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }} />
        ) : (
          <div className="cv__noimg">
            <Icon name="cross" size={56} />
            <p>No photo on this card.</p>
            {card.card_number && <p className="cv__bignum">{card.card_number}</p>}
          </div>
        )}
      </div>

      {/* The details repeated under the image, because a photo can be hard to
          read and someone at a desk usually just wants the number. */}
      <div className="cv__details">
        {card.card_number && (
          <button type="button" className="cv__num" onClick={() => setShowNumber((v) => !v)}
            aria-label={showNumber ? 'Hide the number' : 'Show the number'}>
            <span>{showNumber ? card.card_number : maskCardNumber(card.card_number)}</span>
            <span className="cv__numtoggle">{showNumber ? 'Hide' : 'Show'}</span>
          </button>
        )}
        {card.expiry && (
          <div className={`cv__exp${isExpired(card.expiry) ? ' is-expired' : ''}`}>
            {isExpired(card.expiry) ? `Expired ${card.expiry}` : expiryLabel(card.expiry)}
          </div>
        )}
        {card.note && <div className="cv__note">{card.note}</div>}
      </div>

      <footer className="cv__tools">
        {hasBack && (
          <button className="cv__tool" onClick={() => setSide((s) => (s === 'front' ? 'back' : 'front'))}>
            <Icon name="refresh" size={22} />
            <span>{side === 'front' ? 'Back' : 'Front'}</span>
          </button>
        )}
        <button className="cv__tool" onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)))}
          aria-label="Zoom in">
          <Icon name="plus" size={22} /><span>Bigger</span>
        </button>
        <button className="cv__tool" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
          aria-label="Zoom out" disabled={zoom <= 1}>
          <Icon name="minus" size={22} /><span>Smaller</span>
        </button>
        <button className="cv__tool" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotate">
          <Icon name="refresh" size={22} /><span>Turn</span>
        </button>
        {/* Screen brightness cannot be changed from a web page, so this raises
            the IMAGE's brightness and contrast instead — which is what makes a
            laminated card readable under a service-desk light. */}
        <button className={`cv__tool${bright ? ' is-on' : ''}`} onClick={() => setBright((b) => !b)}
          aria-pressed={bright} aria-label="Brighten">
          <Icon name="sun" size={22} /><span>{bright ? 'Normal' : 'Brighter'}</span>
        </button>
      </footer>
    </div>,
    document.body
  );
}

/* -------------------------------- form -------------------------------- */

function CardForm({ card, nextOrder, onClose, onSaved }) {
  const ui = useUI();
  const editing = !!card;
  const [form, setForm] = useState(() => ({
    label: card?.label || '',
    card_type: card?.card_type || 'health',
    card_number: card?.card_number || '',
    expiry: card?.expiry || '',
    note: card?.note || '',
    front_path: card?.front_path || null,
    back_path: card?.back_path || null,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form.label.trim()) { setError('Please give this card a name.'); return; }
    setError('');
    setBusy(true);
    try {
      await saveCard({ ...form, id: card?.id, sort_order: card?.sort_order ?? nextOrder });
      ui.toast(editing ? 'Card updated.' : 'Card added.');
      onSaved();
    } catch (e) {
      setError(e.message || 'Could not save that card. Your details are still here.');
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? 'Edit card' : 'Add a card'} onClose={onClose}>
      {error && <p className="wiz__err" role="alert">{error}</p>}

      <label className="wiz__field">
        <span className="wiz__label">What is it?</span>
        <Input value={form.label} onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Ontario health card" maxLength={60} />
      </label>

      <span className="wiz__label" style={{ display: 'block', marginTop: 14 }}>Kind of card</span>
      <div className="chips">
        {CARD_TYPES.map((t) => (
          <button key={t.id} type="button" aria-pressed={form.card_type === t.id}
            className={`chip${form.card_type === t.id ? ' is-on' : ''}`}
            onClick={() => set({ card_type: t.id })}>{t.label}</button>
        ))}
      </div>

      <div className="cards-photos">
        <PhotoSlot label="Front" path={form.front_path}
          onChange={(p) => set({ front_path: p })} onError={setError} />
        <PhotoSlot label="Back" optional path={form.back_path}
          onChange={(p) => set({ back_path: p })} onError={setError} />
      </div>

      <label className="wiz__field" style={{ marginTop: 14 }}>
        <span className="wiz__label">Number <span className="wiz__optional">optional</span></span>
        <Input value={form.card_number} onChange={(e) => set({ card_number: e.target.value })}
          placeholder="e.g. 1234-567-890-AB" maxLength={60} autoComplete="off" spellCheck={false} />
        <span className="field__hint">Hidden by default. Only you can see it.</span>
      </label>

      <label className="wiz__field">
        <span className="wiz__label">Expires <span className="wiz__optional">optional</span></span>
        <Input value={form.expiry} onChange={(e) => set({ expiry: e.target.value })}
          placeholder="e.g. 2027-06 or 06/2027" maxLength={20} />
      </label>

      <label className="wiz__field">
        <span className="wiz__label">Note <span className="wiz__optional">optional</span></span>
        <Input value={form.note} onChange={(e) => set({ note: e.target.value })}
          placeholder="e.g. kept in the blue wallet" maxLength={300} />
      </label>

      <div className="btn-row" style={{ marginTop: 16 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add card'}</Button>
      </div>
    </Modal>
  );
}

function PhotoSlot({ label, path, optional, onChange, onError }) {
  const fileRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const url = useCardImage(path);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProgress(0.08);
    try {
      const next = await uploadCardImage(file, setProgress);
      // Replacing a photo removes the old file rather than orphaning it.
      if (path) removeCardImage(path).catch(() => {});
      onChange(next);
    } catch (err) {
      onError?.(err.message || 'Could not add that photo.');
    } finally { setProgress(0); }
  }

  return (
    <div className="pslot">
      <span className="pslot__label">{label}{optional && <em> (optional)</em>}</span>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        onChange={pick} style={{ display: 'none' }} />
      {url ? (
        <>
          <button type="button" className="pslot__img" onClick={() => fileRef.current?.click()}
            aria-label={`Replace the ${label.toLowerCase()} photo`}>
            <img src={url} alt={`${label} of the card`} />
            <span className="pslot__replace"><Icon name="edit" size={18} /> Replace</span>
          </button>
          <button type="button" className="pslot__remove"
            onClick={() => { removeCardImage(path).catch(() => {}); onChange(null); }}>
            Remove photo
          </button>
        </>
      ) : progress > 0 ? (
        <div className="pslot__busy">
          <span className="ring" style={{ '--p': Math.round(progress * 100) }}>
            <b>{Math.round(progress * 100)}%</b>
          </span>
        </div>
      ) : (
        <button type="button" className="pslot__add" onClick={() => fileRef.current?.click()}>
          <Icon name="plus" size={26} />
          <span>Take a photo</span>
        </button>
      )}
    </div>
  );
}
