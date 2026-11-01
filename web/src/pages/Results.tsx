import { useEffect, useMemo, useState } from 'react';
import { EVENT_NAME, type PublicPhoto, type PublicResults } from '@hpa/shared';
import { ADMIN_KEY, api, ApiError, getToken } from '../api';
import PhotoViewer from '../components/PhotoViewer';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const PLACE: Record<number, string> = { 1: '1st place', 2: '2nd place', 3: '3rd place' };
const votesLabel = (n: number) => `${n} vote${n === 1 ? '' : 's'}`;

interface Viewing {
  photos: PublicPhoto[];
  index: number;
  status: (i: number) => string | undefined;
}

/** Public, shareable results: ranked winners per category plus a gallery of every costume. */
export default function Results() {
  const [data, setData] = useState<PublicResults | null>(null);
  const [notPublished, setNotPublished] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<Viewing | null>(null);

  useEffect(() => {
    // An admin who is logged in on this device can preview before publishing.
    api<PublicResults>('GET', '/api/results', undefined, getToken(ADMIN_KEY)).then(setData, (e) => {
      if (e instanceof ApiError && e.status === 403) setNotPublished(true);
      else setError((e as Error).message);
    });
  }, []);

  const gallery = useMemo(() => data?.categories.flatMap((c) => c.rows.map((r) => r.photo)) ?? [], [data]);

  if (notPublished) {
    return (
      <div className="page center">
        <h1>🎃 {EVENT_NAME}</h1>
        <p className="muted">The results are coming soon — check back shortly! 👻</p>
      </div>
    );
  }
  if (error) return <div className="page center"><p className="error">{error}</p></div>;
  if (!data) return <div className="page center muted">Loading…</div>;

  return (
    <div className="page-wide stack">
      <header className="center">
        <h1>🎃 {EVENT_NAME}</h1>
        <p className="muted">Thank you for an amazing night! Here are the winners — and every fabulous look.</p>
      </header>

      {data.categories.map(({ category, rows }) => {
        const podium = rows.filter((r) => r.place <= 3 && r.votes > 0);
        const rest = rows.filter((r) => !podium.includes(r));
        const photos = rows.map((r) => r.photo);
        const open = (photoId: string) =>
          setViewing({
            photos,
            index: photos.findIndex((p) => p.id === photoId),
            status: (i) => `${MEDAL[rows[i].place] ?? `#${rows[i].place}`} ${rows[i].votes > 0 ? votesLabel(rows[i].votes) : ''}`.trim(),
          });
        return (
          <section key={category.id} className="card stack">
            <h2 style={{ margin: 0 }}>{category.name}</h2>
            <div className="results-podium">
              {podium.map((r) => (
                <button key={r.photo.id} className={`results-winner place-border-${r.place}`} onClick={() => open(r.photo.id)}>
                  <img src={r.photo.url} alt="" loading="lazy" />
                  <span className={`results-place place-${r.place}`}>{MEDAL[r.place]} {PLACE[r.place]}</span>
                  <span className="results-caption">{r.photo.caption}</span>
                  <span className="muted">{votesLabel(r.votes)}</span>
                </button>
              ))}
            </div>
            {rest.length > 0 && (
              <table>
                <tbody>
                  {rest.map((r) => (
                    <tr key={r.photo.id} onClick={() => open(r.photo.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ width: 48 }}><b>#{r.place}</b></td>
                      <td style={{ width: 64 }}><img className="thumb" src={r.photo.url} alt="" loading="lazy" /></td>
                      <td>{r.photo.caption}</td>
                      <td className="muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{votesLabel(r.votes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      {gallery.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>📸 The gallery</h2>
          <p className="muted" style={{ margin: 0 }}>Every costume of the night — tap one to see it up close.</p>
          <div className="results-gallery">
            {gallery.map((p, i) => (
              <button key={p.id} className="tile" onClick={() => setViewing({ photos: gallery, index: i, status: () => undefined })}>
                <img src={p.url} alt="" loading="lazy" />
                <span className="tile-caption">{p.caption}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {viewing && (
        <PhotoViewer
          photos={viewing.photos}
          index={viewing.index}
          onIndex={(index) => setViewing({ ...viewing, index })}
          onClose={() => setViewing(null)}
          status={viewing.status(viewing.index)}
        />
      )}
    </div>
  );
}
