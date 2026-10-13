import { useEffect, useRef, useState } from 'react';
import { CAPTION_MAX, EVENT_NAME, NAME_MAX, type PublicState } from '@hpa/shared';
import { getState, uploadPhoto } from '../api';
import { resizeToJpeg } from '../image';

type Status = { kind: 'idle' } | { kind: 'working'; label: string } | { kind: 'error'; message: string } | { kind: 'done' };

export default function Submit() {
  const [state, setState] = useState<PublicState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [catId, setCatId] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getState().then(setState, (e) => setLoadError(e.message));
  }, []);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    setStatus({ kind: 'working', label: 'Getting your photo ready…' });
    try {
      const blob = await resizeToJpeg(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  }

  async function submit() {
    if (!photo) return;
    setStatus({ kind: 'working', label: 'Sending it to the big screen…' });
    try {
      await uploadPhoto({ catId, caption: caption.trim(), submitterName: name.trim() || undefined }, photo.blob);
      setStatus({ kind: 'done' });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  }

  function another() {
    setPhoto(null);
    setCaption('');
    setStatus({ kind: 'idle' });
  }

  if (loadError) return <div className="page center"><p className="error">{loadError}</p><button onClick={() => location.reload()}>Try again</button></div>;
  if (!state) return <div className="page center muted">Loading…</div>;

  if (!state.settings.submissionsOpen) {
    return (
      <div className="page center">
        <h1>🎃 {EVENT_NAME}</h1>
        <p className="muted">The photo booth has closed its doors — come see everyone’s looks at the party!</p>
      </div>
    );
  }

  if (status.kind === 'done') {
    return (
      <div className="page center stack">
        <p className="eyebrow">{EVENT_NAME}</p>
        <h1>✨ You’re in!</h1>
        <p className="muted">Your look will join the parade on the big screen at the party.</p>
        {photo && <img className="preview" src={photo.url} alt="" />}
        <button className="btn-primary" onClick={another}>Share another look</button>
      </div>
    );
  }

  const busy = status.kind === 'working';
  const category = state.categories.find((c) => c.id === catId);
  const canSubmit = !!category && !!photo && caption.trim().length > 0 && !busy;

  return (
    <div className="page stack">
      <header className="center">
        <h1>🎃 {EVENT_NAME}</h1>
        <p className="muted">Show everyone your creative outfit! Pick a category, strike a pose and give your look a name.</p>
      </header>

      <section className="stack">
        <h2>1. Pick your category</h2>
        {state.categories.map((c) => (
          <button key={c.id} className={`choice ${c.id === catId ? 'selected' : ''}`} onClick={() => setCatId(c.id)} aria-pressed={c.id === catId}>
            {c.id === catId ? '✅' : '🕸️'} {c.name}
          </button>
        ))}
      </section>

      <section className="stack">
        <h2>2. Strike a pose</h2>
        {photo && <img className="preview" src={photo.url} alt="Your outfit photo" />}
        <div className="row">
          <button className={photo ? '' : 'btn-primary'} onClick={() => cameraInput.current?.click()} disabled={busy}>📷 {photo ? 'Retake' : 'Snap a photo'}</button>
          <button onClick={() => libraryInput.current?.click()} disabled={busy}>🖼️ Pick from your photos</button>
        </div>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <input ref={libraryInput} type="file" accept="image/*" hidden onChange={onFile} />
      </section>

      <section className="stack">
        <h2>3. Name your look</h2>
        <div>
          <label htmlFor="caption">What’s your look called?</label>
          <input id="caption" type="text" value={caption} maxLength={CAPTION_MAX} placeholder="e.g. The Addams Family" onChange={(e) => setCaption(e.target.value)} />
        </div>
        <div>
          <label htmlFor="name">Your name <span className="muted">(optional — just for us, never shown on screen)</span></label>
          <input id="name" type="text" value={name} maxLength={NAME_MAX} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </div>
      </section>

      {status.kind === 'error' && <p className="error" role="alert">{status.message}</p>}
      <button className="btn-primary btn-block" onClick={submit} disabled={!canSubmit}>
        {busy ? status.label : status.kind === 'error' && photo ? 'Try again' : '✨ Show it off'}
      </button>
      {!canSubmit && !busy && (
        <p className="muted center">
          {!category ? 'Pick a category' : !photo ? 'Add a photo' : 'Name your look'} to continue.
        </p>
      )}
    </div>
  );
}
