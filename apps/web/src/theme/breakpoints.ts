// ============================================================================
// Larvis breakpoints — the three viewport widths, shared by CSS and JS.
//
// Phone   (< 640 px):     bottom tab bar, mobile header, sheets instead of
//                         modals/drawers, the tightest insets.
// Tablet  (640–1023 px):  framed canvas with an icon-only rail sidebar
//                         (76 px), no bottom tab bar, no mobile header.
// Desktop (>= 1024 px):   framed canvas with the full sidebar (labels, long
//                         logo) and the widest insets.
//
// CSS cannot import these numbers, so it writes them literally and only these
// four: `(max-width: 639px)`, `(min-width: 640px)`, `(max-width: 1023px)` and
// `(min-width: 1024px)`. test/breakpoints.test.ts guards every stylesheet.
// Layout that depends on the width of a column rather than the viewport uses
// container queries instead.
// ============================================================================

export const BP = { tablet: 640, desktop: 1024 } as const;

/** Media-query strings for `useMediaQuery` / `matchMedia`. */
export const MQ = {
  /** Phone: everything below 640 px (bottom tab bar, sheets). */
  phone: '(max-width: 639px)',
  /** Tablet only: 640–1023 px (icon rail, framed canvas). */
  tablet: '(min-width: 640px) and (max-width: 1023px)',
  /** Tablet and desktop: 640 px and wider (sidebar or rail, framed canvas, no bottom tab bar). */
  framed: '(min-width: 640px)',
  /** Desktop: 1024 px and wider (full sidebar with labels). */
  desktop: '(min-width: 1024px)',
} as const;
