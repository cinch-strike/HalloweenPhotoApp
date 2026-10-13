import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EVENT_NAME, NAME_MAX, PICKS_PER_CATEGORY, type Category, type Picks, type PublicPhoto, type PublicState } from '@hpa/shared';
import { api, ApiError, byCategory, chunk, getPhotos, getState, getToken, KIOSK_KEY } from '../api';
import PhotoViewer from '../components/PhotoViewer';

const IDLE_RESET_MS = 2 * 60 * 1000;
const THANKS_MS = 5000;
const PER_PAGE = 9;

type Step =
  | { kind: 'name' }
  | { kind: 'confirmName' }
  | { kind: 'categories' }
  | { kind: 'grid'; catId: string; page: number }
  | { kind: 'thanks' };

export default function Vote() {
  const token = getToken(KIOSK_KEY);
  const [kioskOk, setKioskOk] = useState<boolean | null>(token ? null : false);
  const [state, setState] = useState<PublicState | null>(null);
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);

  const [step, setStep] = useState<Step>({ kind: 'name' });
  const [name, setName] = useState('');
  const [picks, setPicks] = useState<Picks>({});
  const [ballotId, setBallotId] = useState(() => crypto.randomUUID());
  const [viewer, setViewer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setStep({ kind: 'name' });
    setName('');
    setPicks({});
    setViewer(null);
    setError('');
    setBallotId(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!token) return;
    api('GET', '/api/kiosk/check', undefined, token).then(() => setKioskOk(true), (e) => setKioskOk(e instanceof ApiError && e.status === 401 ? false : true));
  }, [token]);

  // Poll whether voting is open while sitting on the name screen.
  useEffect(() => {
    const load = () => getState().then(setState).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  // Discard an abandoned ballot after 2 minutes without a touch.
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const bump = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(reset, IDLE_RESET_MS);
    };
    bump();
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [reset]);

  useEffect(() => {
    if (step.kind !== 'thanks') return;
    const id = setTimeout(reset, THANKS_MS);
    return () => clearTimeout(id);
  }, [step, reset]);

  const groups = useMemo(() => byCategory(photos), [photos]);
  const categories: Category[] = (state?.categories ?? []).filter((c) => groups[c.id]?.length);
  const required = (catId: string) => Math.min(PICKS_PER_CATEGORY, groups[catId]?.length ?? 0);
  const complete = categories.length > 0 && categories.every((c) => (picks[c.id]?.length ?? 0) === required(c.id));

  async function start() {
    setBusy(true);
    setError('');
    try {
      const [fresh, check] = await Promise.all([
        getPhotos(),
        api<{ voted: boolean }>('GET', `/api/ballots/check?name=${encodeURIComponent(name.trim())}`, undefined, token),
      ]);
      setPhotos(fresh);
      setStep(check.voted ? { kind: 'confirmName' } : { kind: 'categories' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(catId: string, photoId: string) {
    setPicks((prev) => {
      const current = prev[catId] ?? [];
      if (current.includes(photoId)) return { ...prev, [catId]: current.filter((id) => id !== photoId) };
      if (current.length >= required(catId)) return prev;
      return { ...prev, [catId]: [...current, photoId] };
    });
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const ballotPicks = Object.fromEntries(categories.map((c) => [c.id, picks[c.id] ?? []]));
      await api('POST', '/api/ballots', { id: ballotId, voterName: name.trim(), picks: ballotPicks }, token);
      setStep({ kind: 'thanks' });
    } catch (e) {
      // A photo may have been hidden mid-vote: refresh the photos and drop picks that no longer exist.
      setError((e as Error).message);
      try {
        const fresh = await getPhotos();
        const live = new Set(fresh.map((p) => p.id));
        setPhotos(fresh);
        setPicks((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.filter((id) => live.has(id))])));
      } catch { /* keep current view */ }
    } finally {
      setBusy(false);
    }
  }

  if (kioskOk === false) {
    return (
      <div className="page center">
        <h1>🎃 {EVENT_NAME}</h1>
        <p className="muted">This device isn’t set up for voting yet. An admin needs to open <b>/admin → Contest → Set up this device as the voting kiosk</b>.</p>
      </div>
    );
  }
  if (kioskOk === null || !state) return <div className="page center muted">Loading…</div>;

  if (!state.settings.votingOpen && step.kind !== 'thanks') {
    return (
      <div className="page center">
        <h1>🎃 {EVENT_NAME}</h1>
        <p className="muted">The voting booth opens soon — go admire everyone’s looks in the meantime! 👀</p>
      </div>
    );
  }

  if (step.kind === 'thanks') {
    return (
      <div className="page center stack" onClick={reset}>
        <p className="eyebrow">{EVENT_NAME}</p>
        <h1>Thanks, {name.trim()}! 👻</h1>
        <p className="muted">Your votes are cast. Next voter — tap to begin!</p>
      </div>
    );
  }

  if (step.kind === 'name' || step.kind === 'confirmName') {
    return (
      <div className="page stack">
        <h1 className="center">🎃 {EVENT_NAME}</h1>
        <p className="muted center">Help crown the best looks of the night — pick your top {PICKS_PER_CATEGORY} in every category.</p>
        {step.kind === 'name' ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) start(); }}>
            <div>
              <label htmlFor="voter">Who’s voting?</label>
              <input id="voter" type="text" value={name} maxLength={NAME_MAX} autoComplete="off" placeholder="Type your name" onChange={(e) => setName(e.target.value)} />
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn-primary btn-block" disabled={!name.trim() || busy}>{busy ? 'Loading…' : 'Let’s vote 🗳️'}</button>
          </form>
        ) : (
          <div className="card stack">
            <p>Someone named <b>{name.trim()}</b> has already voted. Is this a different person?</p>
            <div className="row">
              <button className="btn-primary" onClick={() => setStep({ kind: 'categories' })}>Yes, continue</button>
              <button onClick={reset}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (step.kind === 'categories') {
    return (
      <div className="page stack">
        <div className="row">
          <h1 style={{ margin: 0 }}>Hi {name.trim()}!</h1>
          <span className="spacer" />
          <button className="btn-small" onClick={reset}>Cancel</button>
        </div>
        <p className="muted">Choose a category, then pick {PICKS_PER_CATEGORY} favourites.</p>
        {categories.length === 0 && <p className="muted">No outfits to vote on yet.</p>}
        {categories.map((c) => {
          const n = picks[c.id]?.length ?? 0;
          const done = n === required(c.id);
          return (
            <button key={c.id} className={`choice ${done ? 'selected' : ''}`} onClick={() => setStep({ kind: 'grid', catId: c.id, page: 0 })}>
              {done ? '✅' : '🕸️'} {c.name}
              <span className="spacer" />
              <span className="muted">{n}/{required(c.id)}</span>
            </button>
          );
        })}
        {error && <p className="error">{error}</p>}
        <button className="btn-primary btn-block" disabled={!complete || busy} onClick={submit}>
          {busy ? 'Casting…' : complete ? '✨ Cast my votes' : `Pick ${PICKS_PER_CATEGORY} in every category to cast your votes`}
        </button>
      </div>
    );
  }

  // Grid for one category
  const catPhotos = groups[step.catId] ?? [];
  const pages = chunk(catPhotos, PER_PAGE);
  const page = Math.min(step.page, pages.length - 1);
  const chosen = picks[step.catId] ?? [];
  const need = required(step.catId);
  const category = categories.find((c) => c.id === step.catId);

  return (
    <div className="page stack">
      <div className="row">
        <button className="btn-small" onClick={() => setStep({ kind: 'categories' })}>← Categories</button>
        <span className="spacer" />
        <b>{chosen.length}/{need} picked</b>
      </div>
      <h2 style={{ margin: 0 }}>{category?.name}</h2>
      <p className="muted" style={{ margin: 0 }}>Tap a photo to see it up close, then swipe through them all.</p>
      <div className="grid9">
        {pages[page]?.map((p) => {
          const rank = chosen.indexOf(p.id);
          return (
            <button key={p.id} className={`tile ${rank >= 0 ? 'picked' : ''}`} onClick={() => setViewer(catPhotos.indexOf(p))}>
              <img src={p.url} alt="" loading="lazy" />
              {rank >= 0 && <span className="badge">✓</span>}
              <span className="tile-caption">{p.caption}</span>
            </button>
          );
        })}
      </div>
      {pages.length > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button disabled={page === 0} onClick={() => setStep({ ...step, page: page - 1 })}>◀ Prev</button>
          <span className="muted">Page {page + 1} of {pages.length}</span>
          <button disabled={page === pages.length - 1} onClick={() => setStep({ ...step, page: page + 1 })}>Next ▶</button>
        </div>
      )}
      {chosen.length === need && (
        <button className="btn-primary btn-block" onClick={() => setStep({ kind: 'categories' })}>Done — back to categories</button>
      )}
      {viewer !== null && catPhotos[viewer] && (() => {
        const p = catPhotos[viewer];
        const isPicked = chosen.includes(p.id);
        return (
          <PhotoViewer
            photos={catPhotos}
            index={viewer}
            onIndex={setViewer}
            onClose={() => { setViewer(null); setStep({ ...step, page: Math.floor(viewer / PER_PAGE) }); }}
            status={`${chosen.length}/${need} picked`}
            action={{
              label: isPicked ? '✓ Picked — tap to undo' : chosen.length >= need ? `Already picked ${need}` : '⭐ Pick this one',
              onClick: () => toggle(step.catId, p.id),
              disabled: !isPicked && chosen.length >= need,
              primary: !isPicked,
            }}
          />
        );
      })()}
    </div>
  );
}
