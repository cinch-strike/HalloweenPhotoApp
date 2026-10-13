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
    setStatus({ kind: 'working', label: 'Preparing photo…' });
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
    setStatus({ kind: 'working', label: 'Uploading…' });
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
        <p className="eyebrow">{EVENT_NAME}</p>
        <h1>🎃 Costume Contest</h1>
        <p className="muted">Submissions are closed — see you at the party!</p>
      </div>
    );
  }

  if (status.kind === 'done') {
    return (
      <div className="page center stack">
        <p className="eyebrow">{EVENT_NAME}</p>
        <h1>🎃 You’re in!</h1>
        <p className="muted">Your costume will appear on the big screen at the party.</p>
        {photo && <img className="preview" src={photo.url} alt="" />}
        <button className="btn-primary" onClick={another}>Submit another costume</button>
      </div>
    );
  }

  const busy = status.kind === 'working';
  const category = state.categories.find((c) => c.id === catId);
  const canSubmit = !!category && !!photo && caption.trim().length > 0 && !busy;

  return (
    <div className="page stack">
      <header className="center">
        <p className="eyebrow">{EVENT_NAME}</p>
        <h1>🎃 Costume Contest</h1>
        <p className="muted">Pick a category, add a photo of your costume and give it a title.</p>
      </header>

      <section className="stack">
        <h2>1. Category</h2>
        {state.categories.map((c) => (
          <button key={c.id} className={`choice ${c.id === catId ? 'selected' : ''}`} onClick={() => setCatId(c.id)} aria-pressed={c.id === catId}>
            {c.id === catId ? '✅' : '🕸️'} {c.name}
          </button>
        ))}
      </section>

      <section className="stack">
        <h2>2. Photo</h2>
        {photo && <img className="preview" src={photo.url} alt="Your costume photo" />}
        <div className="row">
          <button className={photo ? '' : 'btn-primary'} onClick={() => cameraInput.current?.click()} disabled={busy}>📷 {photo ? 'Retake' : 'Take photo'}</button>
          <button onClick={() => libraryInput.current?.click()} disabled={busy}>🖼️ Choose from library</button>
        </div>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <input ref={libraryInput} type="file" accept="image/*" hidden onChange={onFile} />
      </section>

      <section className="stack">
        <h2>3. Title</h2>
        <div>
          <label htmlFor="caption">Costume title or caption</label>
          <input id="caption" type="text" value={caption} maxLength={CAPTION_MAX} placeholder="e.g. The Addams Family" onChange={(e) => setCaption(e.target.value)} />
        </div>
        <div>
          <label htmlFor="name">Your name <span className="muted">(optional, not shown on screen)</span></label>
          <input id="name" type="text" value={name} maxLength={NAME_MAX} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </div>
      </section>

      {status.kind === 'error' && <p className="error" role="alert">{status.message}</p>}
      <button className="btn-primary btn-block" onClick={submit} disabled={!canSubmit}>
        {busy ? status.label : status.kind === 'error' && photo ? 'Retry submit' : 'Submit costume'}
      </button>
      {!canSubmit && !busy && (
        <p className="muted center">
          {!category ? 'Choose a category' : !photo ? 'Add a photo' : 'Add a title'} to submit.
        </p>
      )}
    </div>
  );
}
