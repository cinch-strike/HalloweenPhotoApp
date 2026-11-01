import { useEffect, useState } from 'react';
import { EVENT_NAME, type PublicResults } from '@hpa/shared';
import { ADMIN_KEY, api, ApiError, getToken } from '../api';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const PLACE: Record<number, string> = { 1: '1st place', 2: '2nd place', 3: '3rd place' };
const votesLabel = (n: number) => `${n} vote${n === 1 ? '' : 's'}`;

/** Public, shareable results: ranked captions and vote totals per category. Deliberately no photos. */
export default function Results() {
  const [data, setData] = useState<PublicResults | null>(null);
  const [notPublished, setNotPublished] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // An admin who is logged in on this device can preview before publishing.
    api<PublicResults>('GET', '/api/results', undefined, getToken(ADMIN_KEY)).then(setData, (e) => {
      if (e instanceof ApiError && e.status === 403) setNotPublished(true);
      else setError((e as Error).message);
    });
  }, []);

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
    <div className="page stack">
      <header className="center">
        <h1>🎃 {EVENT_NAME}</h1>
        <p className="muted">Thank you for an amazing night! Here are the costume contest results.</p>
      </header>

      {data.categories.map(({ category, rows }) => {
        const podium = rows.filter((r) => r.place <= 3 && r.votes > 0);
        const rest = rows.filter((r) => !podium.includes(r));
        return (
          <section key={category.id} className="card stack">
            <h2 style={{ margin: 0 }}>{category.name}</h2>
            <div className="stack" style={{ gap: 8 }}>
              {podium.map((r, i) => (
                <div key={i} className={`results-winner place-border-${r.place}`}>
                  <span className={`results-place place-${r.place}`}>{MEDAL[r.place]} {PLACE[r.place]}</span>
                  <span className="results-caption">{r.caption}</span>
                  <span className="muted">{votesLabel(r.votes)}</span>
                </div>
              ))}
            </div>
            {rest.length > 0 && (
              <table>
                <tbody>
                  {rest.map((r, i) => (
                    <tr key={i}>
                      <td style={{ width: 48 }}><b>#{r.place}</b></td>
                      <td>{r.caption}</td>
                      <td className="muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{votesLabel(r.votes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
