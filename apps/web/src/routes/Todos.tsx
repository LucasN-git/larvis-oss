import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui';
import { TodoList } from '../features/todos/TodoList';

export function Todos() {
  const [showDone, setShowDone] = useState(false);
  const [showBacklog, setShowBacklog] = useState(false);

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">ToDos</h1>
        {/* Kurzes Label + Zustand über die Button-Variante — lange Texte
            sprengen auf dem Handy die Button-Breite. */}
        <Button size="sm" variant={showDone ? 'primary' : 'default'} onClick={() => setShowDone((s) => !s)}>
          {showDone ? <EyeOff size={15} /> : <Eye size={15} />} Erledigte
        </Button>
      </div>

      {/* Jede Liste ist eine Gruppe direkt auf der Seite; Abschnittstitel stehen
          außerhalb des Rahmens. */}
      <div className="stack-section">
        <TodoList filter={{ includeDone: showDone, backlog: false }} />

        <section>
          <div className="page__header" style={{ marginBottom: showBacklog ? 10 : 0 }}>
            <div className="section-title" style={{ margin: 0 }}>Backlog</div>
            <Button size="sm" variant={showBacklog ? 'primary' : 'default'} onClick={() => setShowBacklog((s) => !s)}>
              {showBacklog ? <EyeOff size={15} /> : <Eye size={15} />} Backlog
            </Button>
          </div>

          {showBacklog && (
            <TodoList
              filter={{ includeDone: showDone, backlog: true }}
              showAdd={false}
              emptyText="Backlog ist leer. Nach links wischen parkt ein ToDo hier."
            />
          )}
        </section>
      </div>
    </div>
  );
}
