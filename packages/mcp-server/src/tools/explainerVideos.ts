import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { explainerVideoPath, parseChapters, parseNarrator } from '@larvis/shared';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

/**
 * Erklärvideos nur lesend: Videos entstehen außerhalb von Larvis und kommen über
 * scripts/videos/upload.mjs herein; geschrieben wird hier nichts.
 */
export function registerExplainerVideoTools(server: McpServer) {
  server.registerTool(
    'explainer_video_list',
    {
      title: 'Erklärvideos auflisten',
      description:
        'Listet die Erklärvideos (im Tab „Podcasts“ neben den Folgen) mit Projekt, Länge, Kapiteln, Erzähler und Sehstand. Ein Video trägt denselben Slug wie die Podcast-Folge zum selben Thema. Optional nur die Videos eines Projekts (Slug, ohne Unterprojekte).',
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
          .from('explainer_videos')
          .select('id,slug,title,subtitle,project_id,duration_s,chapters,narrator,updated_at,projects(slug,name)')
          .is('deleted_at', null)
          .not('video_path', 'is', null);
        if (projectId) q = q.eq('project_id', projectId);
        const rows = unwrap(await q.order('sort_order').order('created_at', { ascending: false }));
        const progress = unwrap(
          await db.from('explainer_video_progress').select('video_id,position_s,completed,watched_at'),
        );
        const byVideo = new Map((progress ?? []).map((p) => [p.video_id, p]));
        return ok(
          (rows ?? []).map((r) => ({
            ...r,
            chapters: parseChapters(r.chapters).map((c) => ({ title: c.title, start: Math.round(c.start) })),
            narrator: parseNarrator(r.narrator),
            progress: byVideo.get(r.id) ?? null,
            url: explainerVideoPath(r.slug),
          })),
        );
      }),
  );
}
