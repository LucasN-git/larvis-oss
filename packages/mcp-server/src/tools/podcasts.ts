import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseChapters, podcastEpisodePath } from '@larvis/shared';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

/**
 * Podcasts nur lesend: Folgen entstehen außerhalb von Larvis und kommen über
 * scripts/podcasts/upload.mjs herein; geschrieben wird hier nichts.
 */
export function registerPodcastTools(server: McpServer) {
  server.registerTool(
    'podcast_list',
    {
      title: 'Podcast-Folgen auflisten',
      description:
        'Listet die Podcast-Folgen (Tab „Podcasts“) mit Projekt, Länge, Kapiteln und Hörstand. Optional nur die Folgen eines Projekts (Slug, ohne Unterprojekte).',
      inputSchema: { project_slug: z.string().optional() },
    },
    async ({ project_slug }) =>
      guard(async () => {
        let projectId: string | null = null;
        if (project_slug) {
          const p = unwrap(
            await db.from('projects').select('id').eq('slug', project_slug).is('deleted_at', null).maybeSingle(),
          );
          if (!p) return ok([]);
          projectId = p.id;
        }
        let q = db
          .from('podcast_episodes')
          .select('id,slug,title,subtitle,project_id,duration_s,chapters,voices,updated_at,projects(slug,name)')
          .is('deleted_at', null)
          .not('audio_path', 'is', null);
        if (projectId) q = q.eq('project_id', projectId);
        const rows = unwrap(await q.order('sort_order').order('created_at', { ascending: false }));
        const progress = unwrap(await db.from('podcast_progress').select('episode_id,position_s,completed,listened_at'));
        const byEpisode = new Map((progress ?? []).map((p) => [p.episode_id, p]));
        return ok(
          (rows ?? []).map((r) => ({
            ...r,
            chapters: parseChapters(r.chapters).map((c) => ({ title: c.title, start: Math.round(c.start) })),
            progress: byEpisode.get(r.id) ?? null,
            url: podcastEpisodePath(r.slug),
          })),
        );
      }),
  );
}
