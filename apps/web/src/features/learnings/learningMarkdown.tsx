import { useCallback, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { parseAttachmentRef, type LearningAttachment, type NoteAttachment } from '@larvis/shared';
import { signedLearningFileUrl } from '../../lib/api';
import { InlineImage } from '../../components/InlineImage';

// Renderer-Overrides für Markdown mit `larvis-att:`-Bildern: die Verweise werden über
// die Anhang-Liste zu signierten URLs aufgelöst, interne Links (/learnings/…) laufen
// über den Router. Wiki-Seiten (Standard-Signer) und Notizen (`signedAttachmentUrl`)
// teilen sich den Hook; nur der Wiki-Editor gibt `onResize` mit (Breite in den Body).
export function useLearningRenderers(
  attachments: Pick<LearningAttachment | NoteAttachment, 'id' | 'storage_path'>[],
  onResize?: (attachmentId: string, width: number | null) => void,
  signer: (storagePath: string) => Promise<string> = signedLearningFileUrl,
) {
  const byId = useMemo(() => new Map(attachments.map((a) => [a.id, a] as const)), [attachments]);

  // Unbekannte id → Fehler, damit InlineImage den Fehlzustand zeigt statt ewig zu laden.
  const resolveUrl = useCallback(
    async (id: string) => {
      const att = byId.get(id);
      if (!att) throw new Error('Anhang unbekannt');
      return signer(att.storage_path);
    },
    [byId, signer],
  );

  const renderImage = useCallback(
    (src: string, alt: string): ReactNode => {
      const ref = parseAttachmentRef(src);
      if (!ref) return <img src={src} alt={alt} />;
      return (
        <InlineImage
          attachmentId={ref.id}
          alt={alt}
          width={ref.width}
          resolveUrl={resolveUrl}
          onResize={onResize ? (w) => onResize(ref.id, w) : undefined}
        />
      );
    },
    [resolveUrl, onResize],
  );

  const renderLink = useCallback((href: string, children: ReactNode): ReactNode => {
    if (href.startsWith('/')) return <Link to={href}>{children}</Link>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }, []);

  return { renderImage, renderLink };
}
