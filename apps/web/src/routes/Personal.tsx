import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, NotebookPen, Tv } from 'lucide-react';
import { PERSONAL_PROJECT_SLUG, type Project } from '@larvis/shared';
import { getProjectBySlug } from '../lib/api';
import { Segmented } from '../components/ui';
import { BriefingHistory } from '../features/briefing/BriefingHistory';
import { MemoryList } from '../features/memories/MemoryList';
import { SettingsPanel } from '../components/SettingsPanel';
import './personal.css';

type Tab = 'briefings' | 'memory' | 'settings';

// /profil: Briefings, Memory und Einstellungen. Notizen und ToDos ohne Projekt
// liegen im Projekt „Persönlich“ (Projekte → Persönlich), hier nur als Verweis.
export function Personal() {
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>('briefings');

  useEffect(() => {
    getProjectBySlug(PERSONAL_PROJECT_SLUG).then(setProject).catch(() => setProject(null));
  }, []);

  return (
    <div className="page">
      <div className="page__header">
        <div className="row gap-sm center">
          <span style={{ width: 14, height: 14, borderRadius: 5, background: project?.color ?? '#3A82F6' }} />
          <h1 className="page__title">Profil</h1>
        </div>
        {/* Kiosk-Ansicht für einen fest montierten Bildschirm (chromelos, Bento-Grid). */}
        <Link to="/dashboard" className="btn btn--sm">
          <Tv size={15} /> TV-Dashboard
        </Link>
      </div>

      <div className="stack-section">
        {project && (
          <div className="group group--glyph">
            <Link to={`/projects/${project.id}`} className="item-row link-row">
              <span className="row-glyph" aria-hidden>
                <NotebookPen size={18} />
              </span>
              <span className="item-row__main item-row__title">Notizen & ToDos liegen im Projekt Persönlich</span>
              <ChevronRight size={18} className="link-row__trail" aria-hidden />
            </Link>
          </div>
        )}

        <div>
          <Segmented
            options={[
              { value: 'briefings', label: 'Briefings' },
              { value: 'memory', label: 'Memory' },
              { value: 'settings', label: 'Einstellungen' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'settings' ? <SettingsPanel /> : tab === 'memory' ? <MemoryList /> : <BriefingHistory />}
      </div>
    </div>
  );
}
