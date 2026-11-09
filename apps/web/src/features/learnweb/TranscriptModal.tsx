import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LearnwebVideo } from '@larvis/shared';
import { getLearnwebVideo } from '../../lib/api';
import { Button, Segmented } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { Markdown } from '../../components/Markdown';
import { formatDuration } from './helpers';

type View = 'text' | 'segments';

/** Transkript-Viewer: lädt die großen Spalten erst beim Öffnen. */
export function TranscriptModal({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const [video, setVideo] = useState<LearnwebVideo | null>(null);
  const [view, setView] = useState<View>('text');

  useEffect(() => {
    let alive = true;
    getLearnwebVideo(videoId).then((v) => {
      if (alive) setVideo(v);
    });
    return () => {
      alive = false;
    };
  }, [videoId]);

  const meta = video
    ? [
        formatDuration(video.duration_seconds),
        video.transcribed_at && `transkribiert ${new Date(video.transcribed_at).toLocaleDateString('de-DE')}`,
        video.model,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Modal
      open
      onClose={onClose}
      title={video?.title ?? 'Transkript'}
      footer={
        video && (
          <a href={video.episode_url} target="_blank" rel="noreferrer">
            <Button>
              <ExternalLink size={16} /> Im Learnweb ansehen
            </Button>
          </a>
        )
      }
    >
      {!video && <div className="empty">Lädt…</div>}
      {video && (
        <div className="stack gap-md">
          {meta && <div className="item-row__sub">{meta}</div>}
          <Segmented
            options={[
              { value: 'text', label: 'Text' },
              { value: 'segments', label: 'Zeitmarken' },
            ]}
            value={view}
            onChange={setView}
          />
          {view === 'text' &&
            (video.transcript_md ? (
              <Markdown>{video.transcript_md}</Markdown>
            ) : (
              <div className="empty">Noch kein Transkript.</div>
            ))}
          {view === 'segments' && (
            <div className="stack gap-xs">
              {video.segments.length === 0 && <div className="empty">Keine Zeitmarken.</div>}
              {video.segments.map((s, i) => (
                <div key={i} className="row gap-sm" style={{ alignItems: 'baseline' }}>
                  <span
                    className="item-row__sub"
                    style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--accent)' }}
                  >
                    {formatTimestamp(s.start)}
                  </span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Sekunden -> [hh:mm:ss] bzw. [mm:ss]. */
function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
