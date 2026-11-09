import { Modal } from '../../components/Modal';
import { VideoView } from './VideoView';

/**
 * eLecture-Player im Modal — der Desktop-Weg. Auf dem Handy navigiert die
 * VideoList stattdessen auf die Video-Seite (routes/LearnwebVideo).
 */
export function VideoPlayerModal({
  videoId,
  title,
  episodeUrl,
  onClose,
}: {
  videoId: string;
  title: string;
  episodeUrl: string;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={title}>
      <VideoView videoId={videoId} title={title} episodeUrl={episodeUrl} />
    </Modal>
  );
}
