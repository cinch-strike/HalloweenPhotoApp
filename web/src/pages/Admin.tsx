import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { EVENT_NAME, PICKS_PER_CATEGORY, TV_LAYOUTS, type Category, type Picks } from '@hpa/shared';
import { ADMIN_KEY, api, ApiError, getToken, KIOSK_KEY, setToken, type AdminData, type AdminPhoto } from '../api';
import PhotoViewer from '../components/PhotoViewer';

const TABS = ['Contest', 'Categories', 'Photos', 'Our vote', 'Results', 'Reveal'] as const;
type Tab = (typeof TABS)[number];

export default function Admin() {
  const [token, setTok] = useState(() => getToken(ADMIN_KEY));
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>('Contest');
  const [error, setError] = useState('');

  const logout = useCallback(() => {
    setToken(ADMIN_KEY, null);
    setTok(null);
    setData(null);
  }, []);

  const call = useCallback(
    async <T,>(method: string, path: string, body?: unknown): Promise<T | undefined> => {
      setError('');
      try {
        return await api<T>(method, path, body, token);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) logout();
        setError((e as Error).message);
        return undefined;
      }
    },
    [token, logout],
  );

  const refresh = useCallback(async () => {
    const d = await call<AdminData>('GET', '/api/admin/data');
    if (d) setData(d);
  }, [call]);

  useEffect(() => { if (token) refresh(); }, [token, refresh]);

  // Keep results fresh while watching them.
  useEffect(() => {
    if (!token || tab !== 'Results') return;
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [token, tab, refresh]);

  if (!token) return <Login onToken={(t) => { setToken(ADMIN_KEY, t); setTok(t); }} />;
  if (!data) return <div className="page center">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;

  /** Run a mutation, then reload everything. */
  const act = async (method: string, path: string, body?: unknown) => {
    const r = await call(method, path, body);
    await refresh();
    return r;
  };

  const props = { data, act, call };

  return (
    <div className="page-wide">
      <div className="row" style={{ marginBottom: 12 }}>
        <div>
          <p className="eyebrow">{EVENT_NAME}</p>
          <h1 style={{ margin: 0 }}>🎃 Contest admin</h1>
        </div>
        <span className="spacer" />
        <button className="btn-small" onClick={refresh}>↻ Refresh</button>
        <button className="btn-small" onClick={logout}>Log out</button>
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`btn-small ${t === tab ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
      {tab === 'Contest' && <ContestTab {...props} />}
      {tab === 'Categories' && <CategoriesTab {...props} />}
      {tab === 'Photos' && <PhotosTab {...props} />}
      {tab === 'Our vote' && <AdminVoteTab {...props} />}
      {tab === 'Results' && <ResultsTab {...props} />}
      {tab === 'Reveal' && <RevealTab {...props} />}
    </div>
  );
}

interface TabProps {
  data: AdminData;
  act: (method: string, path: string, body?: unknown) => Promise<unknown>;
  call: <T>(method: string, path: string, body?: unknown) => Promise<T | undefined>;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="page stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          onToken((await api<{ token: string }>('POST', '/api/admin/login', { passcode })).token);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <p className="eyebrow">{EVENT_NAME}</p>
        <h1>🎃 Contest admin</h1>
      </div>
      <div>
        <label htmlFor="pc">Admin passcode</label>
        <input id="pc" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={!passcode || busy}>{busy ? 'Checking…' : 'Log in'}</button>
    </form>
  );
}

// ---------------- Contest ----------------

function ContestTab({ data, act, call }: TabProps) {
  const navigate = useNavigate();
  const { settings } = data;
  const [seconds, setSeconds] = useState(String(settings.carouselSeconds));
  const [qr, setQr] = useState('');
  const [resetText, setResetText] = useState('');
  const submitUrl = `${location.origin}/`;

  useEffect(() => { QRCode.toDataURL(submitUrl, { margin: 1, width: 240 }).then(setQr); }, [submitUrl]);

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Phases</h2>
        <label className="toggle">
          <span>Submissions open <span className="muted">— guests can upload photos</span></span>
          <input type="checkbox" checked={settings.submissionsOpen} onChange={(e) => act('PUT', '/api/admin/settings', { submissionsOpen: e.target.checked })} />
        </label>
        <label className="toggle">
          <span>Voting open <span className="muted">— the kiosk accepts ballots</span></span>
          <input type="checkbox" checked={settings.votingOpen} onChange={(e) => act('PUT', '/api/admin/settings', { votingOpen: e.target.checked })} />
        </label>
        <div className="row">
          <label htmlFor="secs" style={{ margin: 0 }}>TV seconds per screen</label>
          <input id="secs" type="number" min={3} max={120} value={seconds} onChange={(e) => setSeconds(e.target.value)} style={{ width: 100 }} />
          <button className="btn-small" onClick={() => act('PUT', '/api/admin/settings', { carouselSeconds: Number(seconds) })}>Save</button>
        </div>
        <div className="row">
          <label htmlFor="per" style={{ margin: 0 }}>Photos per TV screen</label>
          <select id="per" value={settings.photosPerScreen} onChange={(e) => act('PUT', '/api/admin/settings', { photosPerScreen: Number(e.target.value) })} style={{ width: 200 }}>
            {Object.entries(TV_LAYOUTS).map(([n, l]) => (
              <option key={n} value={n}>{n === '1' ? '1 (full screen)' : `${n} (${l.cols}×${l.rows} grid)`}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card stack">
        <h2>Links</h2>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {qr && <img src={qr} alt="QR code for the submit page" style={{ width: 160, background: '#fff', borderRadius: 8, padding: 4 }} />}
          <div className="stack" style={{ flex: 1, minWidth: 220 }}>
            <div>Submit (share this): <a href="/">{submitUrl}</a></div>
            <div>TV display: <a href="/tv">{location.origin}/tv</a></div>
            <div>Voting kiosk: <a href="/vote">{location.origin}/vote</a></div>
          </div>
        </div>
      </div>

      <div className="card stack">
        <h2>Voting kiosk</h2>
        <p className="muted">Do this once on the iPad: log in here, tap the button, and it opens the voting screen. Only set-up devices can submit votes.</p>
        <button
          className="btn-primary"
          onClick={async () => {
            const r = await call<{ token: string }>('POST', '/api/admin/kiosk-token');
            if (r) {
              setToken(KIOSK_KEY, r.token);
              navigate('/vote');
            }
          }}
        >
          Set up this device as the voting kiosk
        </button>
      </div>

      <div className="card stack">
        <h2>Reset contest data</h2>
        <p className="muted">Deletes every photo, ballot and our vote. Categories and settings stay. Use after the dry run.</p>
        <div className="row">
          <input type="text" placeholder="Type RESET" value={resetText} onChange={(e) => setResetText(e.target.value)} style={{ maxWidth: 200 }} />
          <button className="btn-danger" disabled={resetText !== 'RESET'} onClick={async () => { await act('POST', '/api/admin/reset', { confirm: 'RESET' }); setResetText(''); }}>
            Delete all photos & votes
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Categories ----------------

function CategoriesTab({ data, act }: TabProps) {
  const [newName, setNewName] = useState('');
  const cats = data.categories;
  const move = (i: number, d: number) => {
    const ids = cats.map((c) => c.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    act('PUT', '/api/admin/categories-order', { ids });
  };
  return (
    <div className="stack">
      {cats.map((c, i) => (
        <CategoryRow key={c.id} cat={c} count={data.photos.filter((p) => p.catId === c.id).length}
          onRename={(name) => act('PUT', `/api/admin/categories/${c.id}`, { name })}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < cats.length - 1 ? () => move(i, 1) : undefined}
          onDelete={() => { if (confirm(`Delete “${c.name}”?`)) act('DELETE', `/api/admin/categories/${c.id}`); }}
        />
      ))}
      <form className="card row" onSubmit={(e) => { e.preventDefault(); act('POST', '/api/admin/categories', { name: newName }); setNewName(''); }}>
        <input type="text" placeholder="New category name" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn-primary" disabled={!newName.trim()}>Add category</button>
      </form>
    </div>
  );
}

function CategoryRow({ cat, count, onRename, onUp, onDown, onDelete }: {
  cat: Category; count: number; onRename: (n: string) => void; onUp?: () => void; onDown?: () => void; onDelete: () => void;
}) {
  const [name, setName] = useState(cat.name);
  useEffect(() => setName(cat.name), [cat.name]);
  return (
    <div className="card row">
      <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
      {name.trim() && name !== cat.name && <button className="btn-small btn-primary" onClick={() => onRename(name)}>Save</button>}
      <span className="muted">{count} photo{count === 1 ? '' : 's'}</span>
      <button className="btn-small" onClick={onUp} disabled={!onUp} aria-label="Move up">↑</button>
      <button className="btn-small" onClick={onDown} disabled={!onDown} aria-label="Move down">↓</button>
      <button className="btn-small btn-danger" onClick={onDelete} disabled={count > 0} title={count > 0 ? 'Move or delete its photos first' : ''}>Delete</button>
    </div>
  );
}

// ---------------- Photos ----------------

function PhotosTab({ data, act }: TabProps) {
  const [filter, setFilter] = useState('all');
  const shown = data.photos.filter((p) => filter === 'all' || p.catId === filter || p.status === filter);
  return (
    <div className="stack">
      <div className="row">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="all">All photos ({data.photos.length})</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="hidden">Hidden</option>
          <option value="pending">Pending (upload not finished)</option>
        </select>
      </div>
      {shown.length === 0 && <p className="muted">No photos.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {shown.map((p) => <PhotoCard key={p.id} photo={p} categories={data.categories} act={act} />)}
      </div>
    </div>
  );
}

function PhotoCard({ photo, categories, act }: { photo: AdminPhoto; categories: Category[]; act: TabProps['act'] }) {
  const [caption, setCaption] = useState(photo.caption);
  useEffect(() => setCaption(photo.caption), [photo.caption]);
  return (
    <div className="card stack" style={{ padding: 10, opacity: photo.status === 'live' ? 1 : 0.6 }}>
      {photo.status === 'pending'
        ? <div className="tile center muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Upload not finished</div>
        : <a href={photo.url} target="_blank" rel="noreferrer" className="tile"><img src={photo.url} alt="" loading="lazy" /></a>}
      <input type="text" value={caption} maxLength={80} onChange={(e) => setCaption(e.target.value)} />
      {caption.trim() && caption !== photo.caption && (
        <button className="btn-small btn-primary" onClick={() => act('PUT', `/api/admin/photos/${photo.id}`, { caption })}>Save caption</button>
      )}
      <select value={photo.catId} onChange={(e) => act('PUT', `/api/admin/photos/${photo.id}`, { catId: e.target.value })}>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="muted" style={{ fontSize: 14 }}>
        {photo.status === 'hidden' ? '🙈 Hidden · ' : ''}{photo.submitterName ? `By ${photo.submitterName} · ` : ''}
        {new Date(photo.createdAt).toLocaleString()}
      </div>
      <div className="row">
        {photo.status !== 'pending' && (
          <button className="btn-small" onClick={() => act('PUT', `/api/admin/photos/${photo.id}`, { status: photo.status === 'hidden' ? 'live' : 'hidden' })}>
            {photo.status === 'hidden' ? 'Show' : 'Hide'}
          </button>
        )}
        <button className="btn-small btn-danger" onClick={() => { if (confirm('Delete this photo permanently?')) act('DELETE', `/api/admin/photos/${photo.id}`); }}>Delete</button>
      </div>
    </div>
  );
}

// ---------------- Our (admin) vote ----------------

function AdminVoteTab({ data, act }: TabProps) {
  const [ranks, setRanks] = useState<Picks>(data.adminBallot);
  const [viewer, setViewer] = useState<{ catId: string; index: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const live = data.photos.filter((p) => p.status === 'live');

  const toggle = (catId: string, id: string) => {
    setSaved(false);
    setRanks((prev) => {
      const cur = prev[catId] ?? [];
      if (cur.includes(id)) return { ...prev, [catId]: cur.filter((x) => x !== id) };
      if (cur.length >= PICKS_PER_CATEGORY) return prev;
      return { ...prev, [catId]: [...cur, id] };
    });
  };

  const viewerPhotos = viewer ? live.filter((p) => p.catId === viewer.catId) : [];

  return (
    <div className="stack">
      <p className="muted">Tap photos in order: first tap = 🥇 1st, second = 🥈 2nd, third = 🥉 3rd. Tap a ranked photo to remove it. Tap the 🔍 to see it big.</p>
      {data.categories.map((c) => {
        const photos = live.filter((p) => p.catId === c.id);
        const r = ranks[c.id] ?? [];
        return (
          <div key={c.id} className="card stack">
            <h3>{c.name} <span className="muted">({r.length}/{Math.min(PICKS_PER_CATEGORY, photos.length)})</span></h3>
            {photos.length === 0 && <p className="muted">No photos yet.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {photos.map((p, i) => {
                const rank = r.indexOf(p.id);
                return (
                  <div key={p.id} style={{ position: 'relative' }}>
                    <button className={`tile ${rank >= 0 ? 'picked' : ''}`} style={{ width: '100%' }} onClick={() => toggle(c.id, p.id)}>
                      <img src={p.url} alt="" loading="lazy" />
                      {rank >= 0 && <span className="badge">{['🥇', '🥈', '🥉'][rank]}</span>}
                      <span className="tile-caption">{p.caption}</span>
                    </button>
                    <button className="btn-small" style={{ position: 'absolute', top: 4, left: 4, minHeight: 30, padding: '2px 8px' }} onClick={() => setViewer({ catId: c.id, index: i })} aria-label="View larger">🔍</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <button className="btn-primary" onClick={async () => { await act('PUT', '/api/admin/admin-ballot', { ranks }); setSaved(true); }}>Save our vote</button>
      {saved && <p className="success">Saved.</p>}
      {viewer && viewerPhotos[viewer.index] && (
        <PhotoViewer
          photos={viewerPhotos}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
          status={(() => { const k = (ranks[viewer.catId] ?? []).indexOf(viewerPhotos[viewer.index].id); return k >= 0 ? `Ranked ${['1st', '2nd', '3rd'][k]}` : undefined; })()}
          action={{ label: 'Rank / unrank', onClick: () => toggle(viewer.catId, viewerPhotos[viewer.index].id), primary: true }}
        />
      )}
    </div>
  );
}

// ---------------- Results ----------------

function ResultsTab({ data }: TabProps) {
  const photo = (id: string) => data.photos.find((p) => p.id === id);
  return (
    <div className="stack">
      <div className="card row">
        <b>{data.ballotCount} ballot{data.ballotCount === 1 ? '' : 's'} cast</b>
        {data.duplicateNames.length > 0 && <span className="error">⚠ Same name voted more than once: {data.duplicateNames.join(', ')}</span>}
        {data.lostVotes > 0 && <span className="muted">{data.lostVotes} vote{data.lostVotes === 1 ? ' was' : 's were'} for photos since hidden or deleted (not counted).</span>}
      </div>
      <p className="muted">Scoring: crowd top 3 by votes get 3/2/1 points, our 1st/2nd/3rd get 3/2/1 points. Total = both. Ties go to more public votes, then our ranking.</p>
      {data.categories.map((c) => {
        const rows = data.results[c.id] ?? [];
        return (
          <div key={c.id} className="card" style={{ overflowX: 'auto' }}>
            <h3>{c.name}</h3>
            {rows.length === 0 ? <p className="muted">No photos.</p> : (
              <table>
                <thead><tr><th>Place</th><th></th><th>Costume</th><th>Votes</th><th>Crowd pts</th><th>Our rank</th><th>Our pts</th><th>Total</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const p = photo(r.photoId);
                    return (
                      <tr key={r.photoId}>
                        <td className={r.total > 0 ? `place-${r.place}` : ''}><b>{r.total > 0 && r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : ''} {r.place}</b>{r.tied && <span className="error"> TIE</span>}</td>
                        <td>{p && <img className="thumb" src={p.url} alt="" />}</td>
                        <td>{p?.caption}</td>
                        <td>{r.publicVotes}</td>
                        <td>{r.crowdPoints}</td>
                        <td>{r.adminRank ?? '—'}</td>
                        <td>{r.adminPoints}</td>
                        <td><b>{r.total}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {data.voters.length > 0 && (
        <details className="card">
          <summary>Who voted ({data.voters.length})</summary>
          <p>{data.voters.map((v) => v.name).join(', ')}</p>
        </details>
      )}
    </div>
  );
}

// ---------------- Reveal ----------------

const STEP_LABEL = ['Category title', '3rd place', '2nd place', '1st place'];

function RevealTab({ data, act }: TabProps) {
  const { reveal } = data.settings;
  const cats = data.categories;
  const set = (catIndex: number, step: number, active = true) => act('PUT', '/api/admin/reveal', { active, catIndex, step });
  const next = () => {
    if (reveal.step < 3) set(reveal.catIndex, reveal.step + 1);
    else if (reveal.catIndex < cats.length - 1) set(reveal.catIndex + 1, 0);
  };
  const back = () => {
    if (reveal.step > 0) set(reveal.catIndex, reveal.step - 1);
    else if (reveal.catIndex > 0) set(reveal.catIndex - 1, 3);
  };
  const isLast = reveal.catIndex >= cats.length - 1 && reveal.step === 3;
  const current = cats[reveal.catIndex];
  const podium = current ? (data.results[current.id] ?? []).filter((r) => r.total > 0).slice(0, 3) : [];
  const tie = podium.some((r) => r.tied);

  return (
    <div className="stack">
      <p className="muted">The TV switches to the reveal within ~2 seconds. Check the Results tab for ties first.</p>
      {!reveal.active ? (
        <button className="btn-primary" onClick={() => set(0, 0)} disabled={cats.length === 0}>▶ Start winners reveal on the TV</button>
      ) : (
        <div className="card stack">
          <div className="muted">Now showing on TV</div>
          <h2 style={{ margin: 0 }}>{current?.name} — {STEP_LABEL[reveal.step]}</h2>
          {tie && <p className="error">⚠ This category has a tie on the podium — decide before revealing.</p>}
          <div className="row">
            <button onClick={back} disabled={reveal.catIndex === 0 && reveal.step === 0}>◀ Back</button>
            <button className="btn-primary" onClick={next} disabled={isLast} style={{ minWidth: 200 }}>
              {reveal.step < 3 ? `Reveal ${STEP_LABEL[reveal.step + 1]} ▶` : 'Next category ▶'}
            </button>
          </div>
          <button className="btn-danger" onClick={() => set(0, 0, false)}>End reveal (back to carousel)</button>
        </div>
      )}
      <div className="stack">
        {cats.map((c, i) => (
          <button key={c.id} className={`choice ${reveal.active && i === reveal.catIndex ? 'selected' : ''}`} onClick={() => set(i, 0)}>
            Jump to: {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
