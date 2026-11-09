import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';

// Emoji einer Notiz: ein kleines Feld im Kopf. Klick öffnet eine Zeile mit
// Vorschlägen, einem Textfeld (beliebiges Emoji über die System-Tastatur) und
// „Entfernen". Kein Picker-Paket — die Auswahl bleibt bewusst klein.

const SUGGESTIONS = ['🗺️', '🧭', '📌', '💡', '🧠', '📚', '⚖️', '🏛️', '🤖', '🌍', '🔥', '📝'];

/**
 * Höchstens ein Graphem (ein Emoji samt Variationszeichen) übernehmen, und zwar das
 * zuletzt getippte: so ersetzt ein neues Emoji das alte, statt hinten abgeschnitten zu werden.
 */
function lastGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (typeof Intl.Segmenter === 'function') {
    const parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed), (s) => s.segment);
    return parts[parts.length - 1] ?? '';
  }
  return Array.from(trimmed).slice(-2).join('');
}

export function NoteIconField({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (icon: string) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  if (readOnly) {
    return value ? <span className="note-icon note-icon--static" aria-label="Icon">{value}</span> : null;
  }

  const pick = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <div className="note-icon-wrap" ref={wrapRef}>
      <button
        type="button"
        className="note-icon"
        aria-label={value ? `Icon ${value} ändern` : 'Icon setzen'}
        aria-expanded={open}
        title={value ? 'Icon ändern' : 'Icon setzen'}
        onClick={() => setOpen((o) => !o)}
      >
        {value || <SmilePlus size={17} />}
      </button>
      {open && (
        <div className="note-icon-pop glass glass--strong" role="dialog" aria-label="Icon wählen">
          <div className="note-icon-pop__grid">
            {SUGGESTIONS.map((e) => (
              <button
                key={e}
                type="button"
                className="note-icon-pop__opt"
                aria-pressed={value === e}
                onClick={() => pick(e)}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="row gap-xs center">
            <input
              className="input note-icon-pop__input"
              placeholder="Eigenes Emoji"
              aria-label="Eigenes Emoji"
              value={value}
              onChange={(e) => onChange(lastGrapheme(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && setOpen(false)}
            />
            {value && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => pick('')}>
                Entfernen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
