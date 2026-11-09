/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** '1' schaltet im Dev-Server den Login-Bypass ein (siehe lib/devBypass.ts). */
  readonly VITE_DEV_BYPASS_AUTH?: string;
  // Optional: Absprung-Link in Einstellungen → Infrastruktur; ohne Wert gibt es keinen Link.
  readonly VITE_GITHUB_REPO_URL?: string;
  // Optionale Module und Ortsangaben (siehe lib/modules.ts).
  readonly VITE_WEATHER_PLACE?: string;
  readonly VITE_WEATHER_LAT?: string;
  readonly VITE_WEATHER_LON?: string;
  readonly VITE_HOME_PLACE?: string;
  readonly VITE_LEARNWEB_ENABLED?: string;
  readonly VITE_MENSA_CANTEENS?: string;
  readonly VITE_BUS_STOP_ID?: string;
  readonly VITE_BUS_STOP_NAME?: string;
  readonly VITE_BUS_HBF_MINUTES?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// CSS-only package without an extension in its import path, so the `*.css`
// declaration from vite/client does not match it.
declare module '@fontsource-variable/plus-jakarta-sans';
