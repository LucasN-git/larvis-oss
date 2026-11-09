import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Settings,
  SkipForward,
  X,
} from 'lucide-react';
import { Button, Card, IconButton, Segmented } from '../../components/ui';

type Mode = 'focus' | 'short' | 'long';
type Durations = Record<Mode, number>; // Sekunden

const MODES: Mode[] = ['focus', 'short', 'long'];

const DEFAULT_DURATIONS: Durations = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
};

const MODE_LABEL: Record<Mode, string> = {
  focus: 'Fokus',
  short: 'Kurze Pause',
  long: 'Lange Pause',
};

// Fokus-Farbe = Akzent, Pausen = Grün.
const MODE_COLOR: Record<Mode, string> = {
  focus: 'var(--accent)',
  short: 'var(--success)',
  long: 'var(--success)',
};

const LONG_BREAK_EVERY = 4; // nach 4 Fokus-Runden eine lange Pause
const MIN_MIN = 1;
const MAX_MIN = 180;

const STATE_KEY = 'larvis.pomodoro'; // laufender Timer
const CONFIG_KEY = 'larvis.pomodoro.config'; // Dauern + Presets

interface Preset {
  id: string;
  name: string;
  durations: Durations;
}

const SEED_PRESETS: Preset[] = [
  { id: 'classic', name: 'Klassisch', durations: { focus: 1500, short: 300, long: 900 } },
  { id: 'deep', name: 'Deep Work', durations: { focus: 3000, short: 600, long: 1200 } },
  { id: 'sprint', name: 'Sprint', durations: { focus: 900, short: 180, long: 600 } },
];

interface Config {
  durations: Durations;
  presets: Preset[];
  activePresetId: string | null;
}

interface RunState {
  mode: Mode;
  remaining: number;
  endAt: number | null; // epoch ms, gesetzt solange der Timer läuft
  round: number; // abgeschlossene Fokus-Runden in diesem Zyklus
}

function clampSec(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_MIN * 60, Math.max(MIN_MIN * 60, Math.round(value)));
}

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<Config>;
      if (c.durations && Array.isArray(c.presets)) {
        return {
          durations: {
            focus: clampSec(c.durations.focus, DEFAULT_DURATIONS.focus),
            short: clampSec(c.durations.short, DEFAULT_DURATIONS.short),
            long: clampSec(c.durations.long, DEFAULT_DURATIONS.long),
          },
          presets: c.presets.filter((p) => p && p.id && p.durations),
          activePresetId: c.activePresetId ?? null,
        };
      }
    }
  } catch {
    /* fällt auf Defaults zurück */
  }
  return { durations: { ...DEFAULT_DURATIONS }, presets: SEED_PRESETS, activePresetId: 'classic' };
}

function saveConfig(cfg: Config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* Storage kann voll/blockiert sein */
  }
}

function loadState(): RunState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RunState;
    if (!MODES.includes(p.mode)) return null;
    return p;
  } catch {
    return null;
  }
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p${Date.now().toString(36)}`;
  }
}

const toMin = (sec: number) => String(Math.round(sec / 60));
const draftFrom = (d: Durations): Record<Mode, string> => ({
  focus: toMin(d.focus),
  short: toMin(d.short),
  long: toMin(d.long),
});

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Kurzer Sinus-Ping zum Phasenwechsel. Kein Asset nötig, Web Audio reicht.
function ping() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.start(t);
      osc.stop(t + 0.5);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* Audio ist optional */
  }
}

function Ring({
  progress,
  size,
  color,
  children,
}: {
  progress: number;
  size: number;
  color: string;
  children: ReactNode;
}) {
  const stroke = Math.max(6, size * 0.05);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div className="pomo-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          className="pomo-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="pomo-ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="pomo-ring__inner">{children}</div>
    </div>
  );
}

export function PomodoroCard() {
  const cfgRef = useRef<Config | null>(null);
  if (cfgRef.current === null) cfgRef.current = loadConfig();
  const cfg = cfgRef.current;

  const rtRef = useRef<RunState | null>(null);
  if (rtRef.current === null) rtRef.current = loadState();
  const rt = rtRef.current;

  const [durations, setDurations] = useState<Durations>(cfg.durations);
  const [presets, setPresets] = useState<Preset[]>(cfg.presets);
  const [activePresetId, setActivePresetId] = useState<string | null>(cfg.activePresetId);

  const [mode, setMode] = useState<Mode>(rt?.mode ?? 'focus');
  const [round, setRound] = useState<number>(rt?.round ?? 0);
  const [running, setRunning] = useState<boolean>(false);
  const [remaining, setRemaining] = useState<number>(() => {
    if (rt?.endAt) return Math.max(0, Math.round((rt.endAt - Date.now()) / 1000));
    return rt?.remaining ?? cfg.durations[rt?.mode ?? 'focus'];
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<Mode, string>>(() => draftFrom(cfg.durations));
  const [presetName, setPresetName] = useState('');

  const [fullscreen, setFullscreen] = useState(false);
  const [fsSize, setFsSize] = useState(360);

  const endAtRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<string>('');

  // Beim ersten Mount einen laufenden Timer aus dem Storage fortsetzen.
  useEffect(() => {
    if (rt?.endAt) {
      const left = Math.round((rt.endAt - Date.now()) / 1000);
      if (left > 0) {
        endAtRef.current = rt.endAt;
        setRunning(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistRun = useCallback(
    (next: Partial<RunState>) => {
      const state: RunState = { mode, remaining, endAt: endAtRef.current, round, ...next };
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    },
    [mode, remaining, round],
  );

  // Nächste Phase laden. Fokus → (lange) Pause, Pause → Fokus. Bleibt pausiert.
  const advance = useCallback(
    (sound: boolean) => {
      if (sound) ping();
      endAtRef.current = null;
      let nextMode: Mode = 'focus';
      let nextRound = round;
      if (mode === 'focus') {
        nextRound = round + 1;
        nextMode = nextRound % LONG_BREAK_EVERY === 0 ? 'long' : 'short';
      }
      setRunning(false);
      setRound(nextRound);
      setMode(nextMode);
      setRemaining(durations[nextMode]);
      persistRun({ mode: nextMode, remaining: durations[nextMode], endAt: null, round: nextRound });
    },
    [mode, round, durations, persistRun],
  );

  // Sekunden-Tick, leitet die Restzeit aus dem End-Zeitstempel ab (driftfrei).
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const end = endAtRef.current;
      if (end == null) return;
      const left = Math.round((end - Date.now()) / 1000);
      if (left <= 0) {
        setRemaining(0);
        advance(true);
      } else {
        setRemaining(left);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [running, advance]);

  // Laufende Restzeit im Tab-Titel spiegeln.
  useEffect(() => {
    if (running) {
      if (!titleRef.current) titleRef.current = document.title;
      document.title = `${fmt(remaining)} · ${MODE_LABEL[mode]}`;
    } else if (titleRef.current) {
      document.title = titleRef.current;
      titleRef.current = '';
    }
    return () => {
      if (titleRef.current) document.title = titleRef.current;
    };
  }, [running, remaining, mode]);

  const start = useCallback(() => {
    endAtRef.current = Date.now() + remaining * 1000;
    setRunning(true);
    persistRun({ endAt: endAtRef.current });
  }, [remaining, persistRun]);

  const pause = useCallback(() => {
    const end = endAtRef.current;
    const left = end ? Math.max(0, Math.round((end - Date.now()) / 1000)) : remaining;
    endAtRef.current = null;
    setRunning(false);
    setRemaining(left);
    persistRun({ endAt: null, remaining: left });
  }, [remaining, persistRun]);

  const reset = useCallback(() => {
    endAtRef.current = null;
    setRunning(false);
    setRemaining(durations[mode]);
    persistRun({ endAt: null, remaining: durations[mode] });
  }, [mode, durations, persistRun]);

  const selectMode = useCallback(
    (m: Mode) => {
      endAtRef.current = null;
      setRunning(false);
      setMode(m);
      setRemaining(durations[m]);
      persistRun({ mode: m, endAt: null, remaining: durations[m] });
    },
    [durations, persistRun],
  );

  // ---- Dauern frei einstellen ----
  const commitDuration = useCallback(
    (m: Mode, minutes: number) => {
      const next: Durations = { ...durations, [m]: minutes * 60 };
      setDurations(next);
      setActivePresetId(null);
      if (!running && m === mode) setRemaining(minutes * 60);
      saveConfig({ durations: next, presets, activePresetId: null });
    },
    [durations, running, mode, presets],
  );

  const onDurChange = (m: Mode, raw: string) => {
    setDraft((d) => ({ ...d, [m]: raw }));
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= MIN_MIN && n <= MAX_MIN) commitDuration(m, n);
  };
  const onDurBlur = (m: Mode) => {
    setDraft((d) => ({ ...d, [m]: toMin(durations[m]) }));
  };

  // ---- Presets ----
  const applyPreset = useCallback(
    (p: Preset) => {
      setDurations(p.durations);
      setDraft(draftFrom(p.durations));
      setActivePresetId(p.id);
      if (!running) setRemaining(p.durations[mode]);
      saveConfig({ durations: p.durations, presets, activePresetId: p.id });
    },
    [running, mode, presets],
  );

  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const p: Preset = { id: uid(), name, durations: { ...durations } };
    const next = [...presets, p];
    setPresets(next);
    setActivePresetId(p.id);
    setPresetName('');
    saveConfig({ durations, presets: next, activePresetId: p.id });
  }, [presetName, durations, presets]);

  const deletePreset = useCallback(
    (id: string) => {
      const next = presets.filter((p) => p.id !== id);
      const active = activePresetId === id ? null : activePresetId;
      setPresets(next);
      setActivePresetId(active);
      saveConfig({ durations, presets: next, activePresetId: active });
    },
    [presets, activePresetId, durations],
  );

  // ---- Vollbild: CSS-Overlay plus, wenn möglich, natives Fullscreen ----
  const enterFs = useCallback(() => {
    setFullscreen(true);
    overlayRef.current?.requestFullscreen?.().catch(() => {});
  }, []);
  const exitFs = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFs();
    };
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    const measure = () =>
      setFsSize(Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.62));
    measure();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [fullscreen, exitFs]);

  const total = durations[mode];
  const progress = total > 0 ? remaining / total : 0;
  const color = MODE_COLOR[mode];
  const cycle = (round % LONG_BREAK_EVERY) + (mode === 'focus' ? 1 : 0);
  const cycleLabel = `Runde ${Math.min(LONG_BREAK_EVERY, Math.max(1, cycle))} / ${LONG_BREAK_EVERY}`;

  const controls = (large: boolean) => (
    <div className="pomo-controls">
      <IconButton label="Zurücksetzen" size={large ? 'md' : 'sm'} onClick={reset}>
        <RotateCcw size={large ? 20 : 17} />
      </IconButton>
      <Button
        variant="primary"
        className="pomo-play"
        onClick={running ? pause : start}
        aria-label={running ? 'Pausieren' : 'Starten'}
      >
        {running ? <Pause size={20} /> : <Play size={20} />}
        {running ? 'Pause' : 'Start'}
      </Button>
      <IconButton label="Phase überspringen" size={large ? 'md' : 'sm'} onClick={() => advance(false)}>
        <SkipForward size={large ? 20 : 17} />
      </IconButton>
    </div>
  );

  return (
    <Card className="pomo">
      <div className="row between center" style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ margin: 0 }}>Pomodoro</div>
        <div className="row gap-xs">
          <IconButton
            label="Zeiten einstellen"
            size="sm"
            variant="bare"
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
          >
            <Settings size={16} />
          </IconButton>
          <IconButton label="Vollbild" size="sm" variant="bare" onClick={enterFs}>
            <Maximize2 size={16} />
          </IconButton>
        </div>
      </div>

      <Segmented<Mode>
        className="pomo-modes"
        options={[
          { value: 'focus', label: 'Fokus' },
          { value: 'short', label: 'Kurze Pause' },
          { value: 'long', label: 'Lange Pause' },
        ]}
        value={mode}
        onChange={selectMode}
      />

      <div className="pomo-face">
        <Ring progress={progress} size={196} color={color}>
          <div className="pomo-time mono">{fmt(remaining)}</div>
          <div className="pomo-mode" style={{ color }}>{MODE_LABEL[mode]}</div>
        </Ring>
        <div className="pomo-round">{cycleLabel}</div>
      </div>

      {controls(false)}

      {editing && (
        <div className="pomo-edit">
          <div className="pomo-edit__label">Dauer (Minuten)</div>
          <div className="pomo-durs">
            {MODES.map((m) => (
              <label key={m} className="pomo-dur">
                <span>{MODE_LABEL[m]}</span>
                <input
                  className="input pomo-dur__input"
                  type="number"
                  inputMode="numeric"
                  min={MIN_MIN}
                  max={MAX_MIN}
                  value={draft[m]}
                  onChange={(e) => onDurChange(m, e.target.value)}
                  onBlur={() => onDurBlur(m)}
                />
              </label>
            ))}
          </div>

          <div className="pomo-edit__label">Presets</div>
          <div className="pomo-presets">
            {presets.length === 0 && (
              <span className="text-muted" style={{ fontSize: 13 }}>Noch keine Presets.</span>
            )}
            {presets.map((p) => (
              <span key={p.id} className="pomo-preset" data-active={p.id === activePresetId}>
                <button
                  className="pomo-preset__apply"
                  onClick={() => applyPreset(p)}
                  title={`${toMin(p.durations.focus)} / ${toMin(p.durations.short)} / ${toMin(p.durations.long)} min`}
                >
                  {p.name}
                </button>
                <button
                  className="pomo-preset__del"
                  aria-label={`${p.name} löschen`}
                  onClick={() => deletePreset(p.id)}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>

          <div className="pomo-save">
            <input
              className="input"
              placeholder="Aktuelle Zeiten als Preset benennen…"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') savePreset();
              }}
            />
            <Button size="sm" onClick={savePreset} disabled={!presetName.trim()}>
              <Save size={15} /> Speichern
            </Button>
          </div>
        </div>
      )}

      {fullscreen && (
        <div className="pomo-fs" ref={overlayRef}>
          <IconButton label="Vollbild verlassen" className="pomo-fs__exit" onClick={exitFs}>
            <Minimize2 size={20} />
          </IconButton>
          <Ring progress={progress} size={fsSize} color={color}>
            <div className="pomo-time pomo-time--fs mono">{fmt(remaining)}</div>
            <div className="pomo-mode pomo-mode--fs" style={{ color }}>{MODE_LABEL[mode]}</div>
          </Ring>
          <div className="pomo-round pomo-round--fs">{cycleLabel}</div>
          {controls(true)}
        </div>
      )}
    </Card>
  );
}
