import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus, User } from 'lucide-react';
import { PERSONAL_PROJECT_SLUG, buildProjectTree, isProjectActive, projectColorMap, type ProjectNode } from '@larvis/shared';
import { listNotes, listProjects, listTodos } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Button } from '../../components/ui';
import { VSCodeIcon } from '../../components/VSCodeIcon';
import { vscodeUrl } from '../../lib/openLocal';
import { ProjectFormModal } from './ProjectFormModal';
import { countBySubtree, type SubtreeCount } from './counts';
import './projects.css';

/** "3 Notizen · 2 offen" — the footer of a project tile or row. */
export function countLabel(c: SubtreeCount | undefined): string {
  if (!c) return '';
  return `${c.notes} ${c.notes === 1 ? 'Notiz' : 'Notizen'} · ${c.open} offen`;
}

/**
 * The project list, which is also the home of all notes and todos:
 * "Persönlich" (the personal project, which holds everything without a project)
 * first, then active top-level projects as tiles, inactive ones folded away.
 */
export function ProjectsGrid() {
  const navigate = useNavigate();
  const { data: projects, loading } = useLiveQuery(listProjects, ['projects'], [], 'projects');
  const { data: notes } = useLiveQuery(() => listNotes(), ['notes'], [], 'notes:all');
  const openTodos = useCallback(() => listTodos({ includeDone: false }), []);
  const { data: todos } = useLiveQuery(openTodos, ['todos'], [], 'todos:{"includeDone":false}');
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const all = projects ?? [];
  const personal = all.find((p) => p.slug === PERSONAL_PROJECT_SLUG) ?? null;
  const colors = useMemo(() => projectColorMap(all), [all]);
  const counts = useMemo(
    () => (notes && todos ? countBySubtree(all, notes, todos, personal?.id) : null),
    [all, notes, todos, personal?.id],
  );
  // Persönlich sits in its own section above the grid; its sub-projects (if any) stay with it.
  const tree = buildProjectTree(all).filter((n) => n.id !== personal?.id);
  const active = tree.filter(isProjectActive);
  const inactive = tree.filter((node) => !isProjectActive(node));

  const renderTile = (node: ProjectNode, muted = false) => {
    const color = colors.get(node.id) ?? 'var(--accent)';
    return (
      <div key={node.id} className={`tile-wrap project-tile${muted ? ' project-tile--muted' : ''}`}>
        <div className="tile project-tile__body" style={{ ['--project-color' as string]: color }}>
          <button className="project-tile__link" onClick={() => navigate(`/projects/${node.id}`)}>
            <span className="tile__title project-tile__head">{node.name}</span>
          </button>
          {node.children.length > 0 && (
            <div className="project-chips">
              {node.children.map((c) => (
                <button key={c.id} className="chip project-chip" onClick={() => navigate(`/projects/${c.id}`)}>
                  <span className="project-chip__dot" style={{ background: colors.get(c.id) ?? color }} />
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="project-tile__foot">{countLabel(counts?.get(node.id))}</div>
        </div>
        {node.local_path && (
          <a
            className="tile__open"
            href={vscodeUrl(node.local_path)}
            title={`In VS Code öffnen — ${node.local_path}`}
            aria-label={`${node.name} in VS Code öffnen`}
          >
            <VSCodeIcon size={17} />
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="stack-section">
      {personal && (
        <section>
          <div className="section-title">Persönlich</div>
          <div className="group group--tile">
            <button className="item-row project-row" onClick={() => navigate(`/projects/${personal.id}`)}>
              <span
                className="icon-tile icon-tile--sm project-row__icon"
                style={{ background: colors.get(personal.id) ?? 'var(--accent)', color: '#fff' }}
                aria-hidden
              >
                <User size={17} />
              </span>
              <span className="item-row__main">
                <span className="item-row__title">Persönlich</span>
                <span className="item-row__sub">Notizen und ToDos ohne Projekt</span>
              </span>
              <span className="project-row__count">{countLabel(counts?.get(personal.id))}</span>
              <ChevronRight size={18} className="project-row__chevron" aria-hidden />
            </button>
          </div>
        </section>
      )}

      <section className="stack gap-md">
        <div className="row between center">
          <span className="section-title" style={{ margin: 0 }}>
            {projects ? `${active.length} aktive Projekte` : 'Projekte'}
          </span>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={16} /> Projekt
          </Button>
        </div>

        {projects && tree.length === 0 && !loading && (
          <div className="empty">Noch keine Projekte. Lege dein erstes an.</div>
        )}

        <div className="card-grid">{active.map((node) => renderTile(node))}</div>

        {inactive.length > 0 && (
          <div className="stack gap-sm">
            <div
              className="section-title"
              role="button"
              tabIndex={0}
              aria-expanded={showInactive}
              style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}
              onClick={() => setShowInactive((v) => !v)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  setShowInactive((v) => !v);
                }
              }}
            >
              {showInactive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Inaktiv</span>
              <span style={{ fontWeight: 400 }}>({inactive.length})</span>
            </div>
            {showInactive && <div className="card-grid">{inactive.map((node) => renderTile(node, true))}</div>}
          </div>
        )}
      </section>

      {creating && <ProjectFormModal project={null} projects={all} open onClose={() => setCreating(false)} />}
    </div>
  );
}
