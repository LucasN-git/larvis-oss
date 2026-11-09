import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { downloadMp4, resolveLearnwebVideoSources, type LearnwebVideoSource } from '../../lib/learnweb';
import { Button, Segmented } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { VideoPlayer } from './VideoPlayer';

/**
 * Kompletter Player-Block einer eLecture: holt frische mp4-URLs (CDN-Links
 * laufen ab), schaltet zwischen Kamera/Folien um (Kamera zuerst — Position
 * bleibt beim Wechsel erhalten) und bietet Learnweb-Link + mp4-Download.
 * Gemeinsame Basis für das Desktop-Modal und die mobile Video-Seite.
 */
export function VideoView({
  videoId,
  title,
  episodeUrl,
}: {
  videoId: string;
  title: string;
  episodeUrl: string;
}) {
  const { notify } = useToast();
  const [sources, setSources] = useState<LearnwebVideoSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('presenter');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    resolveLearnwebVideoSources(videoId)
      .then(({ sources }) => {
        if (!alive) return;
        setSources(sources);
        if (!sources.some((s) => s.content === 'presenter')) setContent(sources[0].content);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Video-URL nicht auflösbar.');
      });
    return () => {
      alive = false;
    };
  }, [videoId]);

  // Verfügbare Streams (presenter = Kamera, presentation = Folien) und je Stream
  // die beste Qualität — die Quellen kommen bereits nach Höhe absteigend sortiert.
  // Kamera zuerst, passend zum Default.
  const contents = useMemo(
    () =>
      [...new Set((sources ?? []).map((s) => s.content))].sort(
        (a, b) => Number(b === 'presenter') - Number(a === 'presenter'),
      ),
    [sources],
  );
  const active = useMemo(
    () => (sources ?? []).find((s) => s.content === content) ?? sources?.[0] ?? null,
    [sources, content],
  );

  const download = async () => {
    if (!active) return;
    setDownloading(true);
    const how = await downloadMp4(active.src, title);
    if (how === 'opened') notify('Direkt-Download blockiert — mp4 im neuen Tab geöffnet.', 'info');
    setDownloading(false);
  };

  if (error) {
    return (
      <div className="empty" style={{ color: 'var(--danger)' }}>
        {error}
      </div>
    );
  }
  if (!sources) return <div className="empty">Hole frische Video-URL…</div>;
  if (!active) return <div className="empty">Keine Streams verfügbar.</div>;

  return (
    <div className="stack gap-sm">
      {contents.length > 1 && (
        <Segmented
          options={contents.map((c) => ({
            value: c,
            label: c === 'presenter' ? 'Kamera' : c === 'presentation' ? 'Folien' : c,
          }))}
          value={content}
          onChange={setContent}
        />
      )}
      <VideoPlayer src={active.src} title={title} videoId={videoId} />
      <div className="row gap-sm center" style={{ justifyContent: 'flex-end' }}>
        <a href={episodeUrl} target="_blank" rel="noreferrer">
          <Button variant="ghost">
            <ExternalLink size={16} /> Learnweb
          </Button>
        </a>
        <Button onClick={download} disabled={downloading}>
          <Download size={16} /> {downloading ? 'Lädt…' : 'MP4'}
        </Button>
      </div>
    </div>
  );
}
