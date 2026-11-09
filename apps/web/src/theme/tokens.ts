// ============================================================================
// Larvis design tokens — THE central place to change colors & look.
//
// Every visual value lives here. The ThemeProvider writes these as CSS custom
// properties on :root; all components read only `var(--…)`. To re-skin Larvis,
// edit a theme below (or add a new one and switch to it) — nothing else.
//
// The look follows a clean dashboard style: a light-grey page, the app canvas
// as one large rounded frame, white cards with a hairline ring and almost no
// shadow. Primary actions are ink (black in light, white in dark); orange is
// reserved for brand, progress and highlights. Overlays (bottom nav, modal,
// drawer, toast) use translucent "liquid glass" surfaces.
//
// Radius scale: tag 8 · sm 10 · md 12 (tiles, buttons, inputs) ·
// lg 18 (cards, groups) · xl 24 · frame 28 (app frame) · pill (nav tab,
// avatars, round icon buttons, switches only).
//
// Only fixed values live here. Responsive layout tokens (--inset-page,
// --inset-card, --gap-section, --row-*, --tap) live in global.css under media
// queries: the ThemeProvider sets these tokens inline on :root, and an inline
// custom property would override every media query. --space-* stays a fixed
// scale for components that are not part of the page rhythm.
// ============================================================================

export interface Theme {
  name: string;
  /** 'light' | 'dark' — drives the root color-scheme + default surface assumptions. */
  scheme: 'light' | 'dark';
  colors: {
    page: string; // area outside the app frame (desktop)
    bg: string; // app canvas inside the frame
    surface: string; // neutral hover / panel tint
    card: string; // cards
    well: string; // grey wells: inputs, key-value lists, icon tiles, tracks
    text: string;
    textMuted: string;
    textFaint: string; // decoration and placeholders only
    border: string; // hairline ring
    separator: string; // hairline between rows inside a group
    borderStrong: string; // stronger ring: secondary buttons, focused inputs
    ink: string; // primary action background
    inkContrast: string; // text/icon on ink
    accent: string; // brand accent (orange)
    accentSoft: string; // tinted accent surface
    accentContrast: string; // text/icon on top of accent
    success: string;
    successSoft: string;
    warning: string;
    warningSoft: string;
    danger: string;
    dangerSoft: string;
    glassBg: string; // liquid-glass fill (bottom nav, toast)
    glassBgStrong: string; // denser glass for forms (modal, drawer)
    glassBorder: string; // inner highlight ring of glass
    scrim: string; // dimming layer behind modals and sheets
  };
  radius: { tag: string; sm: string; md: string; lg: string; xl: string; frame: string; pill: string };
  space: { xs: string; sm: string; md: string; lg: string; xl: string };
  font: { sans: string; mono: string };
}

const SANS =
  "'Plus Jakarta Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

const RADIUS: Theme['radius'] = {
  tag: '8px',
  sm: '10px',
  md: '12px',
  lg: '18px',
  xl: '24px',
  frame: '28px',
  pill: '999px',
};
const SPACE: Theme['space'] = { xs: '6px', sm: '10px', md: '16px', lg: '28px', xl: '40px' };

export const lightTheme: Theme = {
  name: 'light',
  scheme: 'light',
  colors: {
    page: '#E9EAEC',
    bg: '#FAFAFB',
    surface: '#F4F4F6',
    card: '#FFFFFF',
    well: '#F3F4F6',
    text: '#18181B',
    textMuted: '#6B6E76',
    textFaint: '#A1A4AB',
    border: 'rgba(0, 0, 0, 0.06)',
    separator: 'rgba(0, 0, 0, 0.08)',
    borderStrong: 'rgba(0, 0, 0, 0.10)',
    ink: '#111113',
    inkContrast: '#FFFFFF',
    accent: '#F05A28',
    accentSoft: '#FDEBE3',
    accentContrast: '#FFFFFF',
    success: '#1F8F5A',
    successSoft: '#E6F6EE',
    warning: '#A86400',
    warningSoft: '#FDF1DC',
    danger: '#D23F31',
    dangerSoft: '#FBE7E4',
    glassBg: 'rgba(255, 255, 255, 0.72)',
    glassBgStrong: 'rgba(255, 255, 255, 0.86)',
    glassBorder: 'rgba(255, 255, 255, 0.60)',
    scrim: 'rgba(17, 17, 19, 0.28)',
  },
  radius: RADIUS,
  space: SPACE,
  font: { sans: SANS, mono: MONO },
};

export const darkTheme: Theme = {
  name: 'dark',
  scheme: 'dark',
  colors: {
    page: '#0F0F11',
    bg: '#141416',
    surface: '#202023',
    card: '#1C1C1F',
    well: '#232327',
    text: '#F2F2F4',
    textMuted: '#9A9AA2',
    textFaint: '#5E5E66',
    border: 'rgba(255, 255, 255, 0.07)',
    separator: 'rgba(255, 255, 255, 0.10)',
    borderStrong: 'rgba(255, 255, 255, 0.12)',
    ink: '#F2F2F4',
    inkContrast: '#111113',
    accent: '#F26B33',
    accentSoft: '#3A241B',
    accentContrast: '#1A1206',
    success: '#3FBF90',
    successSoft: '#16291F',
    warning: '#E0A53F',
    warningSoft: '#33281A',
    danger: '#E45B4C',
    dangerSoft: '#3A1F1C',
    glassBg: 'rgba(28, 28, 31, 0.70)',
    glassBgStrong: 'rgba(28, 28, 31, 0.84)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    scrim: 'rgba(0, 0, 0, 0.5)',
  },
  radius: RADIUS,
  space: SPACE,
  font: { sans: SANS, mono: MONO },
};

export const themes: Record<string, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

export type ThemeName = keyof typeof themes;
export const DEFAULT_THEME: ThemeName = 'light';

/** Flatten a theme into the CSS custom properties consumed by global.css. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  return {
    'color-scheme': theme.scheme,
    '--page': c.page,
    '--bg': c.bg,
    '--surface': c.surface,
    '--card': c.card,
    '--well': c.well,
    '--text': c.text,
    '--text-muted': c.textMuted,
    '--text-faint': c.textFaint,
    '--border': c.border,
    '--separator': c.separator,
    '--border-strong': c.borderStrong,
    '--ink': c.ink,
    '--ink-contrast': c.inkContrast,
    '--accent': c.accent,
    '--accent-soft': c.accentSoft,
    '--accent-contrast': c.accentContrast,
    '--success': c.success,
    '--success-soft': c.successSoft,
    '--warning': c.warning,
    '--warning-soft': c.warningSoft,
    '--danger': c.danger,
    '--danger-soft': c.dangerSoft,
    '--glass-bg': c.glassBg,
    '--glass-bg-strong': c.glassBgStrong,
    '--glass-border': c.glassBorder,
    '--scrim': c.scrim,
    '--radius-tag': theme.radius.tag,
    '--radius-sm': theme.radius.sm,
    '--radius-md': theme.radius.md,
    '--radius-lg': theme.radius.lg,
    '--radius-xl': theme.radius.xl,
    '--radius-frame': theme.radius.frame,
    '--radius-pill': theme.radius.pill,
    '--space-xs': theme.space.xs,
    '--space-sm': theme.space.sm,
    '--space-md': theme.space.md,
    '--space-lg': theme.space.lg,
    '--space-xl': theme.space.xl,
    '--font-sans': theme.font.sans,
    '--font-mono': theme.font.mono,
  };
}
