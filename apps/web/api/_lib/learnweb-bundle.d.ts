// Typ-Oberfläche für das generierte Bundle (api/_lib/learnweb-bundle.js), erzeugt
// beim Build von scripts/build-mcp-bundle.mjs aus @larvis/shared/learnweb. Die .js
// ist gitignored und existiert erst nach einem Build; diese Deklaration lässt tsc
// den Import so oder so auflösen. Mit der echten Signatur synchron halten.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@larvis/shared';
import type {
  EpisodeData,
  LearnwebSession,
  LearnwebSyncOptions,
  LearnwebSyncReport,
  Mp4Pick,
} from '@larvis/shared/learnweb';

export type {
  EpisodeData,
  LearnwebSession,
  LearnwebSyncOptions,
  LearnwebSyncReport,
  Mp4Pick,
} from '@larvis/shared/learnweb';

export function syncLearnweb(
  db: SupabaseClient<Database>,
  opts?: LearnwebSyncOptions,
): Promise<LearnwebSyncReport>;

export function login(): Promise<LearnwebSession>;
export function lwGet(session: LearnwebSession, path: string): Promise<string>;
export function parseEpisodeJson(html: string): EpisodeData;
export function pickMp4(
  episode: EpisodeData,
  opts?: { content?: string; maxHeight?: number },
): Mp4Pick | null;

export class LearnwebAuthError extends Error {}
export class LearnwebMaintenanceError extends Error {}
export class LearnwebParseError extends Error {}
