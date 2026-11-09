import { useState } from 'react';
import type { LearnwebCourse } from '@larvis/shared';
import { Segmented } from '../../components/ui';
import { CourseContent } from './CourseContent';
import { AnnouncementList } from './AnnouncementList';
import { VideoList } from './VideoList';

type Tab = 'inhalte' | 'ankuendigungen' | 'videos';

/**
 * Inhalte/Ankündigungen/Videos eines Kurses mit eigenem Segmented — genutzt von
 * der Kurs-Detailseite im Learnweb-Tab UND vom Learnweb-Tab eines verknüpften
 * Projekts, damit beide exakt dieselben Funktionen bieten.
 *
 * Der aktive Tab wird pro Kurs in sessionStorage gemerkt, damit der Zurück-Weg
 * von der Video-Seite wieder im Videos-Tab landet statt auf "Inhalte".
 */
export function CoursePanel({ course }: { course: LearnwebCourse }) {
  const tabKey = `larvis.lw-tab.${course.id}`;
  const [tab, setTabState] = useState<Tab>(() => {
    const stored = sessionStorage.getItem(tabKey);
    return stored === 'ankuendigungen' || stored === 'videos' ? stored : 'inhalte';
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    sessionStorage.setItem(tabKey, next);
  };

  return (
    <div className="stack gap-md">
      <Segmented
        options={[
          { value: 'inhalte', label: 'Inhalte' },
          { value: 'ankuendigungen', label: 'Ankündigungen' },
          { value: 'videos', label: 'Videos' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'inhalte' && <CourseContent course={course} />}
      {tab === 'ankuendigungen' && <AnnouncementList course={course} />}
      {tab === 'videos' && <VideoList course={course} />}
    </div>
  );
}
