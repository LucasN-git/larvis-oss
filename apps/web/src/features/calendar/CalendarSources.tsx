import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { projectColorMap, selectableProjects, type CalendarSubscription, type Project } from '@larvis/shared';
import {
  addSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
} from '../../lib/calendar';
import { listProjects } from '../../lib/api';
import { useCachedQuery } from '../../lib/cache';
import { formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useGoogleConnect } from './useGoogleConnect';
import { Drawer } from '../../components/Drawer';
import { Button, IconButton, TextInput } from '../../components/ui';

// Kalender-Quellen: das verbundene Google-Konto (lesen + schreiben) und die
// Kalender-Abos — fremde Kalender, die Larvis über ihren geheimen ICS-Link nur liest
// (Outlook, ein zweites Google-Konto). Der Link verlässt den Server nie; die Liste zeigt
// nur Host und maskiertes Ende.
//
// Ein Abo kann einem Larvis-Projekt gehören. Dann tragen seine Termine das Projekt und
// färben sich mit dessen (vererbter) Projektfarbe; die eigene Abo-Farbe ruht und gilt
// wieder, sobald das Projekt gelöst wird. Die Projektfarbe wird nicht ins Abo kopiert,
// sondern hier wie im Kalender beim Anzeigen abgeleitet.

/** Feste Auswahl statt Farbfeld; Orange bleibt der Larvis-Kalender. */
const SWATCHES = ['#0078d4', '#2f6fed', '#1f8f5a', '#00897b', '#8e24aa', '#d23f31', '#f6bf26', '#616161'];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Google-Konto verbunden? */
  googleConnected: boolean;
  /** Nach jeder Änderung an den Abos: Termine neu laden. */
  onChanged: () => void;
}

export function CalendarSources({ open, onClose, googleConnected, onChanged }: Props) {
  const connectGoogle = useGoogleConnect();
  const { notify, saved } = useToast();
  const [subs, setSubs] = useState<CalendarSubscription[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { data: projects } = useCachedQuery('projects', listProjects);
  const projColor = useMemo(() => projectColorMap(projects ?? []), [projects]);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setSubs(await listSubscriptions());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function patch(id: string, p: Parameters<typeof updateSubscription>[1]) {
    try {
      const next = await updateSubscription(id, p);
      setSubs((list) => list?.map((s) => (s.id === id ? next : s)) ?? null);
      saved();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async function remove(id: string) {
    try {
      await deleteSubscription(id);
      setSubs((list) => list?.filter((s) => s.id !== id) ?? null);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Kalender">
      <div className="stack gap-lg">
        <section className="stack gap-sm" aria-labelledby="cal-src-google">
          <h3 id="cal-src-google" className="section-title" style={{ margin: 0 }}>Google</h3>
          <div className="cal-src-row">
            <span className="cal-src-dot" style={{ ['--chip-color' as string]: 'var(--accent)' }} />
            <div className="cal-src-row__main">
              <span className="cal-src-row__name">Google-Konto</span>
              <span className="cal-src-row__meta">
                {googleConnected
                  ? 'Verbunden. Larvis liest alle sichtbaren Kalender und schreibt in den Kalender „Larvis“.'
                  : 'Nicht verbunden.'}
              </span>
            </div>
            {!googleConnected && (
              <Button size="sm" onClick={connectGoogle}>
                <ExternalLink size={15} /> Verbinden
              </Button>
            )}
          </div>
        </section>

        <section className="stack gap-sm" aria-labelledby="cal-src-subs">
          <div className="row between center">
            <h3 id="cal-src-subs" className="section-title" style={{ margin: 0 }}>Kalender-Abos</h3>
            {!adding && (
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <Plus size={15} /> Abo hinzufügen
              </Button>
            )}
          </div>
          <p className="cal-src-hint">
            Nur lesend: Larvis zeigt die Termine an, ändert aber nie etwas daran. Bearbeitet wird im
            Ursprungskalender; Änderungen erscheinen hier nach spätestens fünf Minuten.
          </p>

          {adding && (
            <AddSubscriptionForm
              projects={projects ?? []}
              projColor={projColor}
              onCancel={() => setAdding(false)}
              onAdded={(s) => {
                setSubs((list) => [...(list ?? []), s]);
                setAdding(false);
                saved('Abo angelegt');
                onChanged();
              }}
            />
          )}

          {loadError ? (
            <div className="cal-src-error" role="alert">
              <AlertCircle size={15} /> {loadError}
            </div>
          ) : subs === null ? (
            <div className="text-muted" style={{ fontSize: 13 }}>Lädt …</div>
          ) : subs.length === 0 && !adding ? (
            <div className="text-muted" style={{ fontSize: 13 }}>Noch keine Abos.</div>
          ) : (
            <ul className="stack gap-xs" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {subs.map((s) => (
                <SubscriptionRow
                  key={s.id}
                  sub={s}
                  projects={projects ?? []}
                  projColor={projColor}
                  onPatch={(p) => patch(s.id, p)}
                  onDelete={() => remove(s.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

/** Wirksame Projektfarbe eines Abos oder null (kein Projekt, Projekt ohne Farbe). */
function projectColorOf(projectId: string | null, projColor: Map<string, string | null>): string | null {
  return projectId ? projColor.get(projectId) ?? null : null;
}

function ProjectSelect({
  value,
  projects,
  onChange,
  label,
}: {
  value: string | null;
  projects: Project[];
  onChange: (projectId: string | null) => void;
  label: string;
}) {
  return (
    <select
      className="input cal-src-project"
      value={value ?? ''}
      aria-label={label}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Kein Projekt</option>
      {value && !projects.some((p) => p.id === value) ? (
        <option value={value}>Archiviertes Projekt</option>
      ) : null}
      {selectableProjects(projects, value).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

function SubscriptionRow({
  sub,
  projects,
  projColor,
  onPatch,
  onDelete,
}: {
  sub: CalendarSubscription;
  projects: Project[];
  projColor: Map<string, string | null>;
  onPatch: (p: Parameters<typeof updateSubscription>[1]) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [editingColor, setEditingColor] = useState(false);
  // Entwurf beim Umbenennen; null = Name wird nur angezeigt.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // Enter/Escape beenden das Umbenennen; ein danach noch eintreffendes blur des
  // verschwindenden Feldes darf weder doppelt noch einen verworfenen Entwurf speichern.
  const nameDone = useRef(false);
  // Mit Projekt (das eine Farbe hat) färbt das Projekt; die Abo-Farbe ruht.
  const projectColor = projectColorOf(sub.project_id, projColor);
  const dotColor = projectColor ?? sub.color;

  const startRename = () => {
    nameDone.current = false;
    setNameDraft(sub.name);
  };
  // Leerer oder unveränderter Name speichert nichts; der Server kürzt auf 80 Zeichen.
  const commitName = () => {
    if (nameDraft === null || nameDone.current) return;
    nameDone.current = true;
    const next = nameDraft.trim();
    setNameDraft(null);
    if (next && next !== sub.name) void onPatch({ name: next });
  };
  const cancelName = () => {
    nameDone.current = true;
    setNameDraft(null);
  };

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const status = sub.last_error
    ? sub.last_error
    : sub.last_synced_at
      ? `Zuletzt abgerufen ${formatRelative(sub.last_synced_at)}`
      : 'Noch nicht abgerufen';

  return (
    <li className={clsx('cal-src-row', !sub.enabled && 'cal-src-row--off')}>
      {projectColor ? (
        <span className="cal-src-dot" style={{ ['--chip-color' as string]: dotColor }} title="Farbe kommt vom Projekt" />
      ) : (
        <button
          type="button"
          className="cal-src-dot cal-src-dot--button"
          style={{ ['--chip-color' as string]: dotColor }}
          aria-label={`Farbe von ${sub.name} ändern`}
          aria-expanded={editingColor}
          onClick={() => setEditingColor((v) => !v)}
        />
      )}
      <div className="cal-src-row__main">
        {nameDraft === null ? (
          <button
            type="button"
            id={`${id}-name`}
            className="cal-src-row__name cal-src-row__name--button"
            title="Umbenennen"
            onClick={startRename}
          >
            {sub.name}
            <Pencil size={13} aria-hidden className="cal-src-row__name-icon" />
          </button>
        ) : (
          <TextInput
            id={`${id}-name`}
            aria-label={`Name von ${sub.name}`}
            value={nameDraft}
            maxLength={80}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                // Nur das Umbenennen abbrechen, nicht die Schublade schließen.
                e.stopPropagation();
                cancelName();
              }
            }}
          />
        )}
        <span className="cal-src-row__meta">{sub.url_hint}</span>
        <span id={`${id}-status`} className={clsx('cal-src-row__meta', sub.last_error && 'cal-src-row__meta--error')}>
          {status}
        </span>
        <ProjectSelect
          value={sub.project_id}
          projects={projects}
          label={`Projekt von ${sub.name}`}
          onChange={(projectId) => {
            setEditingColor(false);
            void onPatch({ project_id: projectId });
          }}
        />
        {projectColor && <span className="cal-src-row__meta">Farbe kommt vom Projekt.</span>}
        {editingColor && !projectColor && (
          <ColorSwatches
            value={sub.color}
            onChange={(c) => {
              setEditingColor(false);
              void onPatch({ color: c });
            }}
          />
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={sub.enabled}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-status`}
        title={sub.enabled ? 'Ausblenden' : 'Einblenden'}
        className="cal-switch"
        onClick={() => void onPatch({ enabled: !sub.enabled })}
      >
        <span className="cal-switch__knob" />
      </button>
      {confirming ? (
        <Button size="sm" variant="ghost" style={{ color: 'var(--danger)' }} onClick={() => void onDelete()}>
          Löschen?
        </Button>
      ) : (
        <IconButton size="sm" label={`${sub.name} löschen`} onClick={() => setConfirming(true)}>
          <Trash2 size={16} />
        </IconButton>
      )}
    </li>
  );
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="cal-swatches" role="group" aria-label="Farbe">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className="cal-swatch"
          style={{ ['--chip-color' as string]: c }}
          aria-label={c}
          aria-pressed={c.toLowerCase() === value.toLowerCase()}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function AddSubscriptionForm({
  projects,
  projColor,
  onCancel,
  onAdded,
}: {
  projects: Project[];
  projColor: Map<string, string | null>;
  onCancel: () => void;
  onAdded: (s: CalendarSubscription) => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const projectColor = projectColorOf(projectId, projColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onAdded(await addSubscription({ url: url.trim(), name: name.trim() || undefined, color, project_id: projectId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="cal-src-form stack gap-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextInput
        placeholder="ICS-Link (https://… oder webcal://…)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoFocus
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        aria-label="ICS-Link"
      />
      <TextInput
        placeholder="Name, z. B. Outlook oder Arbeit (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Name"
      />
      <ProjectSelect value={projectId} projects={projects} label="Projekt (optional)" onChange={setProjectId} />
      {projectColor ? (
        <div className="row gap-xs center cal-src-row__meta">
          <span className="cal-src-dot" style={{ ['--chip-color' as string]: projectColor, marginTop: 0 }} />
          Farbe kommt vom Projekt.
        </div>
      ) : (
        <ColorSwatches value={color} onChange={setColor} />
      )}
      <details className="cal-src-help">
        <summary>Wo finde ich den Link?</summary>
        <p>
          <strong>Outlook:</strong> Outlook im Web → Einstellungen → Kalender → Freigegebene Kalender →
          „Kalender veröffentlichen“, Kalender wählen, „Kann alle Details anzeigen“, Veröffentlichen.
          Den <em>ICS</em>-Link kopieren (nicht den HTML-Link).
        </p>
        <p>
          <strong>Google (z. B. Arbeitskonto):</strong> Google Kalender im Web → Einstellungen → links den
          Kalender wählen → „Kalender integrieren“ → „Privatadresse im iCal-Format“ kopieren. Ist das Feld
          ausgegraut, hat der Workspace-Admin das Teilen gesperrt.
        </p>
        <p>Der Link ist geheim: Wer ihn hat, sieht den Kalender. Larvis zeigt ihn nach dem Speichern nicht mehr an.</p>
      </details>
      {error && (
        <div className="cal-src-error" role="alert">
          <AlertCircle size={15} /> {error}
        </div>
      )}
      <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Abbrechen</Button>
        <Button type="submit" variant="primary" disabled={busy || !url.trim()}>
          {busy ? 'Prüfe Link …' : 'Abo anlegen'}
        </Button>
      </div>
    </form>
  );
}
