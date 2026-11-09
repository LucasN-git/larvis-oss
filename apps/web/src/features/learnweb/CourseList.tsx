import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { LearnwebCourse } from '@larvis/shared';
import { Badge } from '../../components/ui';
import { courseSemester, currentSemester, type Semester } from './helpers';
import './learnweb.css';

/**
 * Kursliste, nach Semester gruppiert (neuestes zuerst, "Sonstige" am Ende).
 * Nur das aktuelle Semester startet aufgeklappt; Klick auf die Überschrift
 * klappt eine Gruppe um. Klick auf einen Kurs -> Kurs-Detailseite.
 */
export function CourseList({ courses }: { courses: LearnwebCourse[] }) {
  const navigate = useNavigate();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (courses.length === 0) return null;

  const groups = groupBySemester(courses);
  const current = currentSemester();
  // Läuft gerade kein gesyncter Kurs (z. B. vorlesungsfreie Zeit ohne neue
  // Kurse), startet stattdessen das neueste Semester offen.
  const defaultOpenKey = groups.some(([sem]) => sem.key === current.key)
    ? current.key
    : groups[0][0].key;

  return (
    <div className="stack gap-md">
      {groups.map(([sem, group]) => {
        const open = toggled[sem.key] ?? sem.key === defaultOpenKey;
        const toggle = () => setToggled((prev) => ({ ...prev, [sem.key]: !open }));
        return (
          <div key={sem.key} className="stack gap-xs">
            <div
              className="section-title lw-sem-toggle"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={toggle}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  toggle();
                }
              }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>{sem.label}</span>
              <span style={{ fontWeight: 400 }}>({group.length})</span>
            </div>
            {open && (
              <div className="group">
                {group.map((c) => (
                  <div
                    key={c.id}
                    className="item-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/learnweb/${c.moodle_id}`)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        navigate(`/learnweb/${c.moodle_id}`);
                      }
                    }}
                  >
                    <div className="item-row__main">
                      <div className="item-row__title">{c.fullname}</div>
                      <div className="meta-row" style={{ marginTop: 4 }}>
                        {c.shortname && <Badge>{c.shortname}</Badge>}
                      </div>
                    </div>
                    <ChevronRight size={18} style={{ color: 'var(--text-muted)' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Kurse nach Semester bündeln, Gruppen absteigend sortiert ("Sonstige" zuletzt). */
function groupBySemester(courses: LearnwebCourse[]): [Semester, LearnwebCourse[]][] {
  const groups = new Map<string, [Semester, LearnwebCourse[]]>();
  for (const c of courses) {
    const sem = courseSemester(c);
    let entry = groups.get(sem.key);
    if (!entry) groups.set(sem.key, (entry = [sem, []]));
    entry[1].push(c);
  }
  return [...groups.values()].sort((a, b) => b[0].sortKey - a[0].sortKey);
}
