import { useRef } from 'react';
import type { PublicPhoto } from '@hpa/shared';

interface Props {
  photos: PublicPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Label + action for the main button, e.g. "Pick" / "Unpick". */
  action: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean };
  status?: string;
}

/** Full-screen single photo with swipe left/right (and buttons) to browse. */
export default function PhotoViewer({ photos, index, onIndex, onClose, action, status }: Props) {
  const startX = useRef<number | null>(null);
  const photo = photos[index];
  const go = (delta: number) => onIndex((index + delta + photos.length) % photos.length);

  return (
    <div
      className="viewer"
      onPointerDown={(e) => { startX.current = e.clientX; }}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 50 && photos.length > 1) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="row">
        <button className="btn-small" onClick={onClose}>← Back to grid</button>
        <span className="spacer" />
        <span className="muted">{index + 1} / {photos.length}</span>
      </div>
      <img src={photo.url} alt="" draggable={false} />
      <div className="viewer-caption">{photo.caption}</div>
      {status && <div className="center muted">{status}</div>}
      <div className="row" style={{ justifyContent: 'center' }}>
        <button onClick={() => go(-1)} disabled={photos.length < 2} aria-label="Previous photo">◀</button>
        <button className={action.primary ? 'btn-primary' : ''} onClick={action.onClick} disabled={action.disabled} style={{ minWidth: 180 }}>
          {action.label}
        </button>
        <button onClick={() => go(1)} disabled={photos.length < 2} aria-label="Next photo">▶</button>
      </div>
    </div>
  );
}
