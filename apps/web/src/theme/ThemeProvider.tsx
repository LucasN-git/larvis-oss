import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, themeToCssVars, themes, type ThemeName } from './tokens';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (name: ThemeName) => void;
  toggle: () => void;
  available: ThemeName[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'larvis.theme';
// Set only when the user actively picks a theme. Without it a stored value is
// ignored — so every device defaults to light, even if an older build once
// auto-persisted dark.
const EXPLICIT_KEY = 'larvis.themeExplicit';

function applyTheme(name: ThemeName) {
  const theme = themes[name] ?? themes[DEFAULT_THEME];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(themeToCssVars(theme))) {
    root.style.setProperty(key, value);
  }
  root.dataset.theme = name;
  // Browser/PWA chrome takes the canvas color of the active theme.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.bg);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME;
    const stored = localStorage.getItem(STORAGE_KEY);
    const explicit = localStorage.getItem(EXPLICIT_KEY) === '1';
    return explicit && stored && stored in themes ? (stored as ThemeName) : DEFAULT_THEME;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => {
    const available = Object.keys(themes) as ThemeName[];
    const choose = (next: ThemeName | ((cur: ThemeName) => ThemeName)) => {
      setThemeState((cur) => {
        const resolved = typeof next === 'function' ? next(cur) : next;
        localStorage.setItem(STORAGE_KEY, resolved);
        localStorage.setItem(EXPLICIT_KEY, '1');
        return resolved;
      });
    };
    return {
      theme,
      available,
      setTheme: choose,
      toggle: () =>
        choose((cur) => {
          const i = available.indexOf(cur);
          return available[(i + 1) % available.length];
        }),
    };
  }, [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
