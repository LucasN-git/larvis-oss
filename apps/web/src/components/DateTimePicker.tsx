// Custom date/time pickers. On desktop we render our own popover calendar and
// time list — the native <input type="date|time|datetime-local"> widgets look
// broken and are fiddly to type into on Linux. On mobile (max-width: 639px) we
// keep the native inputs: the iOS/Android wheels are familiar and fast on touch.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  setMonth,
  setYear,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { clsx } from 'clsx';
import { useMediaQuery } from '../lib/useMediaQuery';
import { MQ } from '../theme/breakpoints';

const NATIVE_QUERY = MQ.phone;
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Parse a bare `YYYY-MM-DD` as a local calendar day (no timezone shift). */
function parseDateOnly(s: string): Date | null {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Accept `9`, `930`, `9:5`, `0930`, `09:30` → `09:30`. '' clears, null = invalid. */
function normalizeTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return '';
  let h: number;
  let m: number;
  const colon = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else {
    const digits = s.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length <= 2) {
      h = Number(digits);
      m = 0;
    } else if (digits.length === 3) {
      h = Number(digits.slice(0, 1));
      m = Number(digits.slice(1));
    } else {
      h = Number(digits.slice(0, 2));
      m = Number(digits.slice(2, 4));
    }
  }
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Popover shell: portaled to <body>, fixed-positioned under its anchor, closes
// on outside pointerdown / Escape, and repositions on scroll & resize.
// ---------------------------------------------------------------------------
function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
) {
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const ph = panel?.offsetHeight ?? 0;
      const pw = panel?.offsetWidth ?? r.width;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Prefer below; flip above when it would overflow and there's room up top.
      let top = r.bottom + 6;
      if (top + ph > vh - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6;
      // Align to the anchor's left, clamp inside the viewport.
      let left = Math.max(8, r.left);
      if (left + pw > vw - 8) left = Math.max(8, vw - 8 - pw);
      setPos({ top, left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorRef, panelRef]);
  return pos;
}

function Popover({
  anchorRef,
  open,
  onClose,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(anchorRef, panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture-phase stopPropagation keeps the surrounding Drawer/Modal open —
      // Escape closes only the popover.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div ref={panelRef} className="dtp-pop" style={{ top: pos.top, left: pos.left }}>
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Month calendar used inside the date popover.
// ---------------------------------------------------------------------------
// Drei Zoomstufen: Tage → Monate → Jahre. Klick auf den Titel zoomt raus,
// eine Auswahl zoomt wieder rein — so sind weit zurückliegende Daten
// (Geburtstage!) in wenigen Klicks erreichbar statt monatsweise zu blättern.
type CalView = 'days' | 'months' | 'years';
const YEARS_PER_PAGE = 16;

function MonthCalendar({
  selected,
  onPick,
}: {
  selected: Date | null;
  onPick: (d: Date) => void;
}) {
  const [cursor, setCursor] = useState<Date>(selected ?? new Date());
  const [view, setView] = useState<CalView>('days');
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const year = cursor.getFullYear();
  const yearBase = Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
  const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearBase + i);

  const step = (dir: 1 | -1) => {
    if (view === 'days') setCursor(dir === 1 ? addMonths(cursor, 1) : subMonths(cursor, 1));
    else if (view === 'months') setCursor(setYear(cursor, year + dir));
    else setCursor(setYear(cursor, year + dir * YEARS_PER_PAGE));
  };

  const title =
    view === 'days'
      ? format(cursor, 'LLLL yyyy', { locale: de })
      : view === 'months'
        ? String(year)
        : `${yearBase}–${yearBase + YEARS_PER_PAGE - 1}`;

  return (
    <div className="dtp-cal">
      <div className="dtp-cal__head">
        <button type="button" className="dtp-nav" aria-label="Zurück" onClick={() => step(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="dtp-cal__month dtp-cal__month--btn"
          aria-label="Zoomstufe wechseln"
          onClick={() => setView(view === 'days' ? 'months' : 'years')}
        >
          {title}
        </button>
        <button type="button" className="dtp-nav" aria-label="Weiter" onClick={() => step(1)}>
          <ChevronRight size={16} />
        </button>
      </div>

      {view === 'days' && (
        <div className="dtp-cal__grid">
          {WEEKDAYS.map((w) => (
            <div key={w} className="dtp-cal__wd">{w}</div>
          ))}
          {days.map((d) => (
            <button
              key={d.toISOString()}
              type="button"
              className={clsx(
                'dtp-day',
                !isSameMonth(d, cursor) && 'dtp-day--out',
                isToday(d) && 'dtp-day--today',
                selected && isSameDay(d, selected) && 'dtp-day--sel',
              )}
              onClick={() => onPick(d)}
            >
              {format(d, 'd')}
            </button>
          ))}
        </div>
      )}

      {view === 'months' && (
        <div className="dtp-cal__coarse">
          {Array.from({ length: 12 }, (_, m) => (
            <button
              key={m}
              type="button"
              className={clsx(
                'dtp-cell',
                selected && selected.getFullYear() === year && selected.getMonth() === m && 'dtp-cell--sel',
              )}
              onClick={() => {
                setCursor(setMonth(cursor, m));
                setView('days');
              }}
            >
              {format(setMonth(cursor, m), 'LLL', { locale: de })}
            </button>
          ))}
        </div>
      )}

      {view === 'years' && (
        <div className="dtp-cal__coarse">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              className={clsx('dtp-cell', selected && selected.getFullYear() === y && 'dtp-cell--sel')}
              onClick={() => {
                setCursor(setYear(cursor, y));
                setView('months');
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FieldProps {
  disabled?: boolean;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// DatePicker — value is '' | 'YYYY-MM-DD'.
// ---------------------------------------------------------------------------
export function DatePicker({
  value,
  onChange,
  placeholder = 'Datum wählen',
  disabled,
  style,
}: FieldProps & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const native = useMediaQuery(NATIVE_QUERY);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  if (native) {
    return (
      <input
        className="input"
        type="date"
        value={value}
        disabled={disabled}
        style={style}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const selected = value ? parseDateOnly(value) : null;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx('dtp-trigger', !value && 'dtp-trigger--empty')}
        disabled={disabled}
        style={style}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarIcon size={15} className="dtp-trigger__icon" />
        <span className="dtp-trigger__label">
          {selected ? format(selected, 'EEE, d. MMM yyyy', { locale: de }) : placeholder}
        </span>
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <MonthCalendar
          selected={selected}
          onPick={(d) => {
            onChange(format(d, 'yyyy-MM-dd'));
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// TimePicker — value is '' | 'HH:mm'. Type freely, or click a 15-min slot.
// ---------------------------------------------------------------------------
const TIME_SLOTS: string[] = Array.from({ length: (24 * 60) / 15 }, (_, i) => {
  const mins = i * 15;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
});

export function TimePicker({
  value,
  onChange,
  placeholder = 'Uhrzeit',
  disabled,
  style,
}: FieldProps & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const native = useMediaQuery(NATIVE_QUERY);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value, open]);

  // Scroll the current (or nearest earlier) slot into view when the list opens.
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    (active ?? listRef.current.querySelector('.dtp-slot'))?.scrollIntoView({ block: 'center' });
  }, [open]);

  if (native) {
    return (
      <input
        className="input"
        type="time"
        value={value}
        disabled={disabled}
        style={style}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const commit = (raw: string) => {
    const norm = normalizeTime(raw);
    if (norm === null) {
      setDraft(value); // invalid → revert
      return;
    }
    onChange(norm);
    setDraft(norm);
  };

  // Which slot to highlight: exact match, else the last one at/before the value.
  const activeSlot = value && !TIME_SLOTS.includes(value)
    ? [...TIME_SLOTS].reverse().find((s) => s <= value) ?? ''
    : value;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx('dtp-trigger', !value && 'dtp-trigger--empty')}
        disabled={disabled}
        style={style}
        onClick={() => setOpen((o) => !o)}
      >
        <Clock size={15} className="dtp-trigger__icon" />
        <span className="dtp-trigger__label">{value || placeholder}</span>
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <div className="dtp-time">
          <input
            className="input dtp-time__field"
            value={draft}
            placeholder="HH:MM"
            inputMode="numeric"
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit(draft);
                setOpen(false);
              }
            }}
          />
          <div className="dtp-time__list" ref={listRef}>
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                data-active={slot === activeSlot}
                className={clsx('dtp-slot', slot === value && 'dtp-slot--sel')}
                onClick={() => {
                  onChange(slot);
                  setDraft(slot);
                  setOpen(false);
                }}
              >
                {slot}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// DateTimePicker — date + time side by side. Value is 'YYYY-MM-DDTHH:mm'
// (the datetime-local format), so it drops into existing event handlers.
// ---------------------------------------------------------------------------
export function DateTimePicker({
  value,
  onChange,
  disabled,
}: FieldProps & {
  value: string;
  onChange: (v: string) => void;
}) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16) || '09:00';
  return (
    <div className="row gap-sm wrap">
      <DatePicker
        value={date}
        disabled={disabled}
        style={{ flex: 1, minWidth: 150 }}
        onChange={(d) => onChange(`${d}T${time}`)}
      />
      <TimePicker
        value={time}
        disabled={disabled}
        style={{ flex: '0 0 118px' }}
        onChange={(t) => onChange(`${date}T${t || '09:00'}`)}
      />
    </div>
  );
}
