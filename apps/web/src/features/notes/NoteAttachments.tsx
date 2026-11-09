import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, Eye, Paperclip, Trash2, Upload, X } from 'lucide-react';
import type { AttachmentLike } from '@larvis/shared';
import { signedAttachmentUrl } from '../../lib/api';
import { attachmentIcon, formatBytes } from './attachmentUtil';

// Attachment area inside an editor (notes, wiki pages): upload documents, see
// thumbnails, view (image → in-app lightbox, other files → new tab) and delete.
// Works on any AttachmentLike row; `resolveUrl` says which bucket the file lives
// in (default: the note-files bucket).

type ResolveUrl<T extends AttachmentLike> = (att: T) => Promise<string>;
const resolveNoteUrl: ResolveUrl<AttachmentLike> = (att) => signedAttachmentUrl(att.storage_path);

function Thumb<T extends AttachmentLike>({ att, resolveUrl }: { att: T; resolveUrl: ResolveUrl<T> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (att.kind === 'image') resolveUrl(att).then((u) => alive && setUrl(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [att, resolveUrl]);
  const Icon = attachmentIcon(att);
  return (
    <span className="att-thumb">
      {att.kind === 'image' && url ? <img src={url} alt="" /> : <Icon size={18} />}
    </span>
  );
}

export function NoteAttachments<T extends AttachmentLike>({
  attachments,
  onUpload,
  onDelete,
  resolveUrl = resolveNoteUrl,
}: {
  attachments: T[];
  onUpload: (files: File[]) => Promise<void>;
  onDelete: (att: T) => Promise<void>;
  /** Signed URL for a row — defaults to the note-files bucket. */
  resolveUrl?: ResolveUrl<T>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const images = attachments.filter((a) => a.kind === 'image');

  const doUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      try {
        await onUpload(files);
      } finally {
        setBusy(false);
      }
    },
    [onUpload],
  );

  async function view(att: T) {
    if (att.kind === 'image') {
      setLightbox(images.findIndex((a) => a.id === att.id));
      return;
    }
    const url = await resolveUrl(att).catch(() => null);
    if (url) window.open(url, '_blank', 'noopener');
  }

  return (
    <div className="stack gap-sm">
      <div className="row between center">
        <div className="section-title" style={{ margin: 0 }}>
          <Paperclip size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Anhänge{attachments.length ? ` (${attachments.length})` : ''}
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={15} /> {busy ? 'Lädt…' : 'Datei anhängen'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void doUpload(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      <div
        className={`att-drop${dragOver ? ' att-drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void doUpload(Array.from(e.dataTransfer.files));
        }}
      >
        {attachments.length === 0 ? (
          <span className="text-muted">Dateien hierher ziehen oder „Datei anhängen". Screenshots fügst du direkt im Text ein.</span>
        ) : (
          <ul className="att-list">
            {attachments.map((att) => (
              <li key={att.id} className="att-row">
                <button type="button" className="att-row__main" onClick={() => void view(att)} title="Ansehen">
                  <Thumb att={att} resolveUrl={resolveUrl} />
                  <span className="att-row__meta">
                    <span className="att-row__name">{att.filename || 'Datei'}</span>
                    <span className="att-row__sub">
                      {att.inline ? 'im Text · ' : ''}
                      {formatBytes(att.size_bytes)}
                    </span>
                  </span>
                </button>
                <span className="att-row__actions">
                  <button type="button" className="icon-btn icon-btn--sm" title="Ansehen" onClick={() => void view(att)}>
                    <Eye size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    title="Herunterladen"
                    onClick={async () => {
                      const url = await resolveUrl(att).catch(() => null);
                      if (url) window.open(url, '_blank', 'noopener');
                    }}
                  >
                    <Download size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    title={att.inline ? 'Löschen (auch aus dem Text)' : 'Löschen'}
                    onClick={() => void onDelete(att)}
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightbox !== null && images[lightbox] && (
        <Lightbox
          images={images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          resolveUrl={resolveUrl}
        />
      )}
    </div>
  );
}

function Lightbox<T extends AttachmentLike>({
  images,
  index,
  onIndex,
  onClose,
  resolveUrl,
}: {
  images: T[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  resolveUrl: ResolveUrl<T>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const att = images[index];
  const go = useCallback(
    (d: number) => onIndex((index + d + images.length) % images.length),
    [index, images.length, onIndex],
  );

  useEffect(() => {
    let alive = true;
    setUrl(null);
    resolveUrl(att).then((u) => alive && setUrl(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [att, resolveUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  return createPortal(
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox__close icon-btn" title="Schließen" onClick={onClose}>
        <X size={22} />
      </button>
      {images.length > 1 && (
        <button
          className="lightbox__nav lightbox__nav--prev icon-btn"
          title="Zurück"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
        >
          <ChevronLeft size={26} />
        </button>
      )}
      <figure className="lightbox__figure" onClick={(e) => e.stopPropagation()}>
        {url ? <img src={url} alt={att.filename} /> : <span className="text-muted">Lädt…</span>}
        <figcaption>
          {att.filename} {images.length > 1 ? `· ${index + 1}/${images.length}` : ''}
        </figcaption>
      </figure>
      {images.length > 1 && (
        <button
          className="lightbox__nav lightbox__nav--next icon-btn"
          title="Weiter"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
        >
          <ChevronRight size={26} />
        </button>
      )}
    </div>,
    document.body,
  );
}
