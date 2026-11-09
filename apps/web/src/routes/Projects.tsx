import { ProjectsGrid } from '../features/projects/ProjectsGrid';

export function Projects() {
  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Projekte</h1>
      </div>
      <ProjectsGrid />
    </div>
  );
}
