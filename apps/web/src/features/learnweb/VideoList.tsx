import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ExternalLink, NotebookPen, Play, Video } from 'lucide-react';
import {
  LEARNWEB_VIDEO_STATUS_LABELS,
  type LearnwebCourse,
} from '@larvis/shared';
import {
  listLearnwebVideos,
  queueLearnwebTranscription,
  upsertLectureNote,
  type LearnwebVideoSummary,
} from '../../lib/api';
import { bestVideoSource, downloadMp4, resolveLearnwebVideoSources } from '../../lib/learnweb';
import { useLiveQuery } from '../../lib/useLive';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { MQ } from '../../theme/breakpoints';
import { Badge, Button, IconButton } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { formatRelative } from '../../lib/format';
import { formatDuration, statusTone } from './helpers';
import { TranscriptModal } from './TranscriptModal';
import { VideoPlayerModal } from './VideoPlayerModal';
import './learnweb.css';

/** eLectures eines Kurses: abspielen, mp4 laden, transkribieren, Vorlesungsnotiz anlegen. */
export function VideoList({ course }: { course: LearnwebCourse }) {
  const { notify } = useToast();
  const navigate = useNavigate();
  // Handy: Video als eigene Seite (Zurück-Button, kein Bottom-Sheet).
  const isPhone = useMediaQuery(MQ.phone);
  const fetcher = useCallback(() => listLearnwebVideos(course.id), [course.id]);
  const { data: videos, loading } = useLiveQuery(fetcher, ['learnweb_videos'], [course.id], `lw:vids:${course.id}`);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<LearnwebVideoSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const play = (v: LearnwebVideoSummary) => {
    if (isPhone) navigate(`/learnweb/${course.moodle_id}/video/${v.id}`);
    else setPlaying(v);
  };

  const queue = async (id: string) => {
    try {
      await queueLearnwebTranscription(id);
      notify('Zur Transkription vorgemerkt. Läuft lokal auf deinem Rechner.', 'info');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Konnte nicht vormerken.', 'error');
    }
  };

  const download = async (v: LearnwebVideoSummary) => {
    setBusyId(v.id);
    try {
      const { sources } = await resolveLearnwebVideoSources(v.id);
      const how = await downloadMp4(bestVideoSource(sources).src, v.title);
      if (how === 'opened') notify('Direkt-Download blockiert — mp4 im neuen Tab geöffnet.', 'info');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Download fehlgeschlagen.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const createNote = async (v: LearnwebVideoSummary) => {
    setBusyId(v.id);
    try {
      const { action } = await upsertLectureNote(course, v);
      notify(
        action === 'created'
          ? 'Vorlesungsnotiz angelegt (Projekt → Notizen → Vorlesungen).'
          : action === 'transcript_added'
            ? 'Transkript in die bestehende Notiz nachgetragen.'
            : 'Notiz existiert bereits.',
        action === 'unchanged' ? 'info' : 'saved',
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Notiz konnte nicht angelegt werden.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (videos && videos.length === 0 && !loading) {
    return <div className="empty">Keine Aufzeichnungen im Cache.</div>;
  }
  if (!videos) return null;

  return (
    <>
      <div className="group group--tile">
        {videos.map((v) => (
          <VideoRow
            key={v.id}
            video={v}
            busy={busyId === v.id}
            hasProject={Boolean(course.project_id)}
            onQueue={() => queue(v.id)}
            onOpenTranscript={() => setTranscriptId(v.id)}
            onPlay={() => play(v)}
            onDownload={() => download(v)}
            onNote={() => createNote(v)}
          />
        ))}
      </div>
      {transcriptId && <TranscriptModal videoId={transcriptId} onClose={() => setTranscriptId(null)} />}
      {playing && (
        <VideoPlayerModal
          videoId={playing.id}
          title={playing.title}
          episodeUrl={playing.episode_url}
          onClose={() => setPlaying(null)}
        />
      )}
    </>
  );
}

function VideoRow({
  video: v,
  busy,
  hasProject,
  onQueue,
  onOpenTranscript,
  onPlay,
  onDownload,
  onNote,
}: {
  video: LearnwebVideoSummary;
  busy: boolean;
  hasProject: boolean;
  onQueue: () => void;
  onOpenTranscript: () => void;
  onPlay: () => void;
  onDownload: () => void;
  onNote: () => void;
}) {
  const canQueue = v.status === 'none' || v.status === 'failed';
  const playable = v.kind === 'opencast';
  const meta = [formatDuration(v.duration_seconds), v.recorded_at && formatRelative(`${v.recorded_at}T12:00:00Z`)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="item-row item-row--wrap"
      role={v.status === 'done' ? 'button' : undefined}
      tabIndex={v.status === 'done' ? 0 : undefined}
      onClick={v.status === 'done' ? onOpenTranscript : undefined}
      onKeyDown={(ev) => {
        if (ev.target !== ev.currentTarget) return;
        if (v.status === 'done' && (ev.key === 'Enter' || ev.key === ' ')) {
          ev.preventDefault();
          onOpenTranscript();
        }
      }}
    >
      <div className="icon-tile icon-tile--sm">
        <Video size={14} />
      </div>
      <div className="item-row__main">
        <div className="item-row__title">{v.title}</div>
        <div className="meta-row" style={{ marginTop: 4 }}>
          {meta && <span className="item-row__sub">{meta}</span>}
          <Badge tone={statusTone(v.status)}>{LEARNWEB_VIDEO_STATUS_LABELS[v.status]}</Badge>
        </div>
        {v.status === 'failed' && v.error && (
          <div className="item-row__sub" style={{ marginTop: 4, color: 'var(--danger)' }}>
            {v.error}
          </div>
        )}
      </div>
      <div className="item-row__actions" onClick={(e) => e.stopPropagation()}>
        {playable && (
          <IconButton size="sm" variant="bare" label={`${v.title} abspielen`} onClick={onPlay}>
            <Play size={16} />
          </IconButton>
        )}
        {playable && (
          <IconButton size="sm" variant="bare" label={`${v.title} als mp4 herunterladen`} onClick={onDownload} disabled={busy}>
            <Download size={16} />
          </IconButton>
        )}
        {hasProject && (
          <IconButton size="sm" variant="bare" label={`Vorlesungsnotiz zu ${v.title}`} onClick={onNote} disabled={busy}>
            <NotebookPen size={16} />
          </IconButton>
        )}
        {canQueue && (
          <Button size="sm" variant="ghost" onClick={onQueue}>
            {v.status === 'failed' ? 'Erneut versuchen' : 'Transkribieren'}
          </Button>
        )}
        <a
          href={v.episode_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${v.title} in Learnweb öffnen`}
          className="icon-btn icon-btn--bare"
        >
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}
