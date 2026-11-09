import { useCallback } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { listLearnwebCourses, listLearnwebVideos } from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { IconButton } from '../components/ui';
import { VideoView } from '../features/learnweb/VideoView';

/**
 * Video-Seite (mobil): eLecture als volle Seite statt Bottom-Sheet, mit
 * Zurück-Button oben. Zurück geht in der History (Kurs- oder Projekt-Tab);
 * bei Direktaufruf/Reload stattdessen zur Kursseite.
 */
export function LearnwebVideo() {
  const { id, videoId } = useParams<{ id: string; videoId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const moodleId = Number(id);

  const coursesFetcher = useCallback(() => listLearnwebCourses(true), []);
  const { data: courses } = useLiveQuery(coursesFetcher, ['learnweb_courses'], [], 'lw:courses:all');
  const course = courses?.find((c) => c.moodle_id === moodleId);

  const videosFetcher = useCallback(
    () => (course ? listLearnwebVideos(course.id) : Promise.resolve([])),
    [course],
  );
  const { data: videos } = useLiveQuery(
    videosFetcher,
    ['learnweb_videos'],
    [course?.id ?? 'none'],
    `lw:vids:${course?.id ?? 'none'}`,
  );
  const video = videos?.find((v) => v.id === videoId);

  const back = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(`/learnweb/${moodleId}`);
  };

  if (courses && videos && !video) {
    return (
      <div className="page">
        <p className="empty">Video nicht im Cache.</p>
        <Link to={`/learnweb/${moodleId}`} className="btn">Zum Kurs</Link>
      </div>
    );
  }
  if (!video) {
    return (
      <div className="page">
        <p className="empty">Lädt…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="video-page__header">
        <IconButton size="sm" label="Zurück" onClick={back}>
          <ChevronLeft size={18} />
        </IconButton>
        <div className="video-page__title">{video.title}</div>
      </div>
      <VideoView videoId={video.id} title={video.title} episodeUrl={video.episode_url} />
    </div>
  );
}
