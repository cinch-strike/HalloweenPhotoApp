import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { DEFAULT_SETTINGS, EVENT_NAME, TV_LAYOUTS, type PublicPhoto, type PublicState } from '@hpa/shared';
import { byCategory, chunk, getPhotos, getState } from '../api';

const STATE_POLL_MS = 2000;

interface Screen {
  catId: string;
  catName: string;
  page: number;
  pageCount: number;
  photos: PublicPhoto[];
}

/** Works out the screen after `current`: next 9 in the same category, else the next category with photos (looping). */
function nextScreen(state: PublicState, photos: PublicPhoto[], current: Screen | null): Screen | null {
  const groups = byCategory(photos);
  const perScreen = state.settings.photosPerScreen;
  const cats = state.categories.filter((c) => groups[c.id]?.length);
  if (!cats.length) return null;
  let catIdx = current ? cats.findIndex((c) => c.id === current.catId) : -1;
  let page = 0;
  if (catIdx >= 0 && current!.page + 1 < Math.ceil(groups[cats[catIdx].id].length / perScreen)) {
    page = current!.page + 1;
  } else {
    catIdx = (catIdx + 1) % cats.length;
  }
  const cat = cats[catIdx];
  const pages = chunk(groups[cat.id], perScreen);
  return { catId: cat.id, catName: cat.name, page, pageCount: pages.length, photos: pages[page] };
}

function preload(photos: PublicPhoto[]) {
  for (const p of photos) new Image().src = p.url;
}

export default function Tv() {
  const [state, setState] = useState<PublicState | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [qr, setQr] = useState('');
  const [offline, setOffline] = useState(false);
  const stateRef = useRef(state);
  const screenRef = useRef(screen);
  stateRef.current = state;
  screenRef.current = screen;

  const submitUrl = `${location.origin}/`;

  useEffect(() => {
    QRCode.toDataURL(submitUrl, { margin: 1, width: 300 }).then(setQr);
  }, [submitUrl]);

  // Poll state (categories, settings, reveal) frequently so the reveal follows the admin's clicks.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      getState()
        .then((s) => { if (alive) { setState(s); setOffline(false); } })
        .catch(() => alive && setOffline(true));
    tick();
    const id = setInterval(tick, STATE_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Carousel: fetch photos fresh at each advance so new submissions join without a reload.
  const ready = state !== null;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const advance = async () => {
      const s = stateRef.current!;
      try {
        const photos = await getPhotos();
        if (!alive) return;
        const next = nextScreen(s, photos, screenRef.current);
        setScreen(next);
        if (next) preload(nextScreen(s, photos, next)?.photos ?? []);
      } catch {
        // Keep showing the last screen; try again next tick.
      }
      if (alive) timer = setTimeout(advance, (stateRef.current?.settings.carouselSeconds ?? 10) * 1000);
    };
    advance();
    return () => { alive = false; clearTimeout(timer); };
  }, [ready]);

  if (!state) return <div className="tv"><h1 className="tv-title muted">Loading…</h1></div>;
  const layout = TV_LAYOUTS[state.settings.photosPerScreen] ?? TV_LAYOUTS[DEFAULT_SETTINGS.photosPerScreen];
  if (state.revealed) return <Reveal revealed={state.revealed} step={state.settings.reveal.step} />;

  const footer = (
    <div className="tv-footer">
      <span>{offline ? '⚠️ Reconnecting…' : screen && screen.pageCount > 1 ? `${screen.page + 1} / ${screen.pageCount}` : ''}</span>
      {state.settings.submissionsOpen && qr && (
        <div className="tv-qr">
          <span>Scan to show off your outfit ✨</span>
          <img src={qr} alt="QR code to share your outfit" />
        </div>
      )}
    </div>
  );

  if (!screen) {
    return (
      <div className="tv" onClick={goFullscreen}>
        <div className="reveal">
          <h1>🎃 {EVENT_NAME}</h1>
          <p className="reveal-caption muted">Scan to show everyone your creative outfit ✨</p>
          {qr && <img src={qr} alt="" style={{ height: '35vh', background: '#fff', padding: '1vh', borderRadius: '2vh' }} />}
        </div>
      </div>
    );
  }

  return (
    <div className="tv" onClick={goFullscreen}>
      <p className="eyebrow">{EVENT_NAME}</p>
      <h1 className="tv-title">{screen.catName}</h1>
      <div
        className="tv-grid tv-fade"
        key={`${screen.catId}-${screen.page}`}
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
          gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
          ['--tv-caption' as string]: `${Math.max(2.3, 6 / layout.rows)}vh`,
        }}
      >
        {screen.photos.map((p) => (
          <figure className="tv-cell" key={p.id} style={{ margin: 0 }}>
            <img src={p.url} alt="" />
            <figcaption className="tile-caption">{p.caption}</figcaption>
          </figure>
        ))}
      </div>
      {footer}
    </div>
  );
}

function goFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
}

const PLACE_LABEL: Record<number, string> = { 1: '🥇 1st place', 2: '🥈 2nd place', 3: '🥉 3rd place' };

function Reveal({ revealed, step }: { revealed: NonNullable<PublicState['revealed']>; step: number }) {
  const [headline, ...others] = revealed.winners;
  if (step === 0 || !headline) {
    return (
      <div className="reveal" onClick={goFullscreen}>
        <p className="eyebrow">{EVENT_NAME}</p>
        <p className="reveal-place muted">And the winners for…</p>
        <h1 className="pop" key={revealed.category.id}>{revealed.category.name}</h1>
        {step > 0 && <p className="muted">No votes here yet.</p>}
      </div>
    );
  }
  return (
    <div className="reveal" onClick={goFullscreen}>
      <p className="muted" style={{ fontSize: '3vh', margin: 0 }}>{revealed.category.name}</p>
      <div className={`reveal-place place-${headline.place}`}>{PLACE_LABEL[headline.place] ?? `#${headline.place}`}</div>
      <img className="reveal-photo pop" key={headline.photo.id} src={headline.photo.url} alt="" />
      <div className="reveal-caption">{headline.photo.caption}</div>
      {others.length > 0 && (
        <div className="reveal-others">
          {others.map((w) => (
            <figure key={w.photo.id}>
              <img src={w.photo.url} alt="" />
              <span className={`place-${w.place}`}>{PLACE_LABEL[w.place] ?? `#${w.place}`}</span> · {w.photo.caption}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
