// UI primitives. Styling lives in theme/components.css + global.css.
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { handleTextareaTabKey } from '../lib/textareaKeys';
import type { SaveState } from '../lib/useAutosave';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'md' | 'sm';
  block?: boolean;
};

export function Button({ variant = 'default', size = 'md', block, className, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        'btn',
        variant === 'primary' && 'btn--primary',
        variant === 'ghost' && 'btn--ghost',
        size === 'sm' && 'btn--sm',
        block && 'btn--block',
        className,
      )}
      {...rest}
    />
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'md' | 'sm';
  /** 'ring' = round button with hairline ring (headers, toolbars, free-standing).
   *  'bare' = no ring, transparent, hover fill — for buttons inside a row or group. */
  variant?: 'ring' | 'bare';
  label: string;
};

export function IconButton({ size = 'md', variant = 'ring', label, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      className={clsx('icon-btn', size === 'sm' && 'icon-btn--sm', variant === 'bare' && 'icon-btn--bare', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: 'raised' | 'flat';
  /** 'lg' = --inset-card, 'sm' = --inset-card-sm, 'none' = no padding and clipped
   *  corners, for a card whose content (rows, media) runs edge to edge. */
  pad?: 'lg' | 'sm' | 'none';
};

export function Card({ variant = 'raised', pad = 'lg', className, ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        variant === 'raised' && 'card',
        variant === 'flat' && 'card--flat',
        pad === 'lg' && 'card-pad',
        pad === 'sm' && 'card-pad-sm',
        pad === 'none' && 'card-pad-none',
        className,
      )}
      {...rest}
    />
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('input', className)} {...rest} />;
}

export function TextArea({ className, onKeyDown, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx('textarea', className)}
      onKeyDown={(e) => {
        handleTextareaTabKey(e);
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
}

// Textfeld in Input-Optik, das mit dem Text in die Höhe wächst statt seitlich zu scrollen —
// für Felder, die meist einen ganzen Satz tragen.
export function GrowingInput({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => fitHeight(ref.current), [rest.value]);
  // Eine neue Breite (Drawer, Fenster, Drehen) verschiebt die Umbrüche; die eigene
  // Höhenänderung löst keinen erneuten Durchlauf aus.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitHeight(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <textarea ref={ref} rows={1} className={clsx('input', 'input--grow', className)} {...rest} />;
}

function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
};

export function Badge({ tone = 'default', className, ...rest }: BadgeProps) {
  return <span className={clsx('badge', tone !== 'default' && `badge--${tone}`, className)} {...rest} />;
}

export function Chip({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={clsx('chip', className)} {...rest} />;
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
}

/** Key-Value-Zeilen auf grauem Well: Label links gedämpft, Wert rechts kräftig.
 *  Ersetzt Chip-Reihen in Detailansichten. Leere Werte (null/undefined/'') fallen weg. */
export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  const rows = items.filter((it) => it.value !== null && it.value !== undefined && it.value !== '');
  if (rows.length === 0) return null;
  return (
    <dl className={clsx('kv-list', className)}>
      {rows.map((it, i) => (
        <div className="kv" key={i}>
          <dt className="kv__label">{it.label}</dt>
          <dd className="kv__value">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Inline autosave indicator for editor footers. Visible on every device so the
// phone still gets feedback (the top-right toast is desktop-only).
export function SaveStatus({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const text =
    state === 'saving' ? 'Speichert…' : state === 'saved' ? 'Gespeichert' : 'Nicht gespeichert';
  return (
    <span className={clsx('save-status', `save-status--${state}`)}>
      {state === 'saved' && <Check size={14} />}
      {text}
    </span>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** Abstand zwischen zwei Optionen; derselbe Wert wie `gap` in `.segmented`. */
const SEGMENTED_GAP = 4;

/**
 * Wie viele Optionen nebeneinander passen. `null` heißt: alles passt in eine Zeile.
 * Reicht die Breite nicht, wird auf gleich breite Spalten umgebrochen statt seitlich
 * zu scrollen — so viele Zeilen wie nötig, so wenige wie möglich.
 */
function useSegmentedColumns(count: number, labelsKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const measure = () => {
      const ps = getComputedStyle(parent);
      const es = getComputedStyle(el);
      const available =
        parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) -
        parseFloat(es.paddingLeft) - parseFloat(es.paddingRight);
      // Natürliche Breite je Option: ihr Text plus der Innenabstand der einzeiligen Form.
      // Der steht als `--seg-pad-x` am Container und hängt nicht davon ab, ob gerade
      // umgebrochen ist — sonst könnte die Messung zwischen beiden Formen hin- und herkippen.
      const padX = parseFloat(es.getPropertyValue('--seg-pad-x')) || 16;
      const widths = [...el.querySelectorAll<HTMLElement>('.segmented__label')].map((label) => label.offsetWidth + 2 * padX);
      const total = widths.reduce((a, b) => a + b, 0) + SEGMENTED_GAP * (widths.length - 1);
      if (available <= 0 || total <= available + 0.5) {
        setCols(null);
        return;
      }
      const widest = Math.max(...widths);
      let next = Math.ceil(count / Math.ceil(total / available));
      while (next > 1 && (available - SEGMENTED_GAP * (next - 1)) / next < widest) next -= 1;
      setCols(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [count, labelsKey]);

  return { ref, cols };
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const labelsKey = options.map((o) => (typeof o.label === 'string' ? o.label : o.value)).join('|');
  const { ref, cols } = useSegmentedColumns(options.length, labelsKey);
  return (
    <div
      ref={ref}
      className={clsx('segmented', cols !== null && 'segmented--wrapped', className)}
      style={cols !== null ? { ['--seg-cols' as string]: cols } : undefined}
      role="tablist"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          className="segmented__option"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          <span className="segmented__label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
