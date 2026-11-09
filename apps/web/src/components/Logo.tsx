import type { CSSProperties } from 'react';

// Die Larvis-Bildmarke: ein L aus zwei Pillen, ein oranger Punkt als Kern, dazu ein Ring.
// Das L folgt der Textfarbe (`currentColor`), der Punkt dem Akzent-Token, deshalb passt
// dieselbe Marke in Light und Dark. Der Ring ist hier kräftiger als in public/icon.svg, weil
// die App die Marke nur zwischen 20 und 30 px zeigt und eine Hairline dort verschwindet.
export function LogoMark({ size = 24, style }: { size?: number | string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.16" />
      <g fill="currentColor">
        <rect x="34" y="26" width="10" height="48" rx="5" />
        <rect x="34" y="64" width="34" height="10" rx="5" />
      </g>
      <circle cx="64" cy="34" r="7" fill="var(--accent)" />
    </svg>
  );
}

// Langform: Bildmarke plus Wortmarke „Larvis“. Schriftgröße, Gewicht und Laufweite kommen
// vom umgebenden Element (z. B. `.sidebar__brand` oder einer Überschrift), die Marke skaliert
// in em mit; `size` setzt die Schriftgröße nur, wo kein Kontext sie vorgibt. Das Wort ist
// echter Text und bleibt für Screenreader lesbar. Die Datei-Fassung (Wortmarke als Pfad)
// liegt unter apps/web/public/logo/.
export function Logo({ size, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4em',
        lineHeight: 1,
        ...(size ? { fontSize: size } : null),
        ...style,
      }}
    >
      <LogoMark size="1.15em" />
      Larvis
    </span>
  );
}
