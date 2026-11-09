import { z } from 'zod';
import type { NoteGraph } from '@larvis/shared';

// Themen-Graph einer Notiz (Vertrag: NoteGraph in @larvis/shared), beim Schreiben über MCP
// geprüft. Unbekannte Felder werden abgewiesen, damit ein Tippfehler (source/target statt
// from/to) nicht still verloren geht. Der Versionswechsel selbst liegt in der Datenbank
// (Funktion create_note_version in der Migration).
const nodeSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    group: z.string().trim().min(1).optional(),
    note: z.string().optional(),
    weight: z.number().int().min(1).max(5).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
  })
  .strict();

const edgeSchema = z
  .object({
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
    label: z.string().optional(),
  })
  .strict();

export const noteGraphSchema = z
  .object({
    nodes: z.array(nodeSchema).min(1, 'graph.nodes darf nicht leer sein'),
    edges: z.array(edgeSchema).default([]),
    groups: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((g, ctx) => {
    const seen = new Set<string>();
    g.nodes.forEach((n, i) => {
      if (seen.has(n.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', i, 'id'], message: `Knoten-id „${n.id}" ist doppelt` });
      }
      seen.add(n.id);
    });
    g.edges.forEach((e, i) => {
      for (const end of ['from', 'to'] as const) {
        if (!seen.has(e[end])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['edges', i, end],
            message: `Kante verweist auf unbekannten Knoten „${e[end]}"`,
          });
        }
      }
    });
  });

export function parseNoteGraph(input: unknown): NoteGraph {
  return noteGraphSchema.parse(input);
}

export const FROZEN_VERSION_MESSAGE =
  'Diese Version ist eingefroren; neue Version anlegen mit create_note_version oder force:true';
