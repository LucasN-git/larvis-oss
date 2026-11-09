import type { Upload } from '@larvis/shared';
import { signedUploadUrl } from '../../lib/api';
import {
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
  type LucideIcon,
} from 'lucide-react';
/** Pick a file-type icon for an attachment or upload from its mime type (and kind, where known). */
export function attachmentIcon(att: { mime_type: string; kind?: string }): LucideIcon {
  const m = att.mime_type || '';
  if (att.kind === 'image' || m.startsWith('image/')) return FileImage;
  if (m.startsWith('video/')) return FileVideo;
  if (m.startsWith('audio/')) return FileAudio;
  if (m === 'application/pdf' || m.startsWith('text/')) return FileText;
  if (/(zip|compressed|tar|rar|7z)/.test(m)) return FileArchive;
  if (/(sheet|excel|csv)/.test(m)) return FileSpreadsheet;
  return FileIcon;
}

/** Human-readable byte size (0 B / 12 KB / 3.4 MB). */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / 1024 ** i;
  return `${i === 0 ? val : val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

/** Open a dump/entry upload in a new tab via a short-lived signed URL. */
export async function openUpload(u: Pick<Upload, 'storage_path'>) {
  const url = await signedUploadUrl(u.storage_path).catch(() => null);
  if (url) window.open(url, '_blank', 'noopener');
}
