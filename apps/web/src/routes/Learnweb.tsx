import { useCallback } from 'react';
import { listLearnwebCourses } from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { SyncButton } from '../features/learnweb/SyncButton';
import { UpcomingEvents } from '../features/learnweb/UpcomingEvents';
import { CourseList } from '../features/learnweb/CourseList';

export function Learnweb() {
  const fetcher = useCallback(() => listLearnwebCourses(), []);
  const { data: courses, loading } = useLiveQuery(fetcher, ['learnweb_courses'], [], 'lw:courses');

  const lastSyncedAt =
    courses && courses.length > 0
      ? courses.reduce<string | null>((max, c) => (c.last_synced_at && (!max || c.last_synced_at > max) ? c.last_synced_at : max), null)
      : null;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Learnweb</h1>
        <SyncButton lastSyncedAt={lastSyncedAt} />
      </div>

      {courses && courses.length === 0 && !loading && (
        <div className="empty">Noch nichts synchronisiert. Tippe auf „Synchronisieren".</div>
      )}

      {courses && courses.length > 0 && (
        <div className="stack gap-md">
          <UpcomingEvents courses={courses} />
          <CourseList courses={courses} />
        </div>
      )}
    </div>
  );
}
