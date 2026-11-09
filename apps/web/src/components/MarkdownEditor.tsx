import { useEffect, useRef, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { Bold, IndentDecrease, IndentIncrease, List } from 'lucide-react';
import { attachmentRef } from '@larvis/shared';
import { handleTextareaTabKey } from '../lib/textareaKeys';

// Minimalist markdown editor: bold, bullets (single style: "- "), indent/outdent.
// Anything fancier is written with Claude. Write-only — no preview mode.
//
// Optional image support (used by notes): when `uploadImage` is supplied,
// pasting a screenshot uploads it and inserts an inline image ref
// (`![name](larvis-att:<id>)`) at the caret; viewing happens in the note's
// attachment list.

interface Edit {
  text: string;
  start: number;
  end: number;
}
type Transform = (text: string, start: number, end: number) => Edit;

// Wrap the selection (or a placeholder) with a marker, e.g. ** for bold.
const wrap = (marker: string): Transform => (text, s, e) => {
  const sel = text.slice(s, e) || 'Text';
  const out = text.slice(0, s) + marker + sel + marker + text.slice(e);
  return { text: out, start: s + marker.length, end: s + marker.length + sel.length };
};

// Apply a per-line function to every line touched by the selection.
const perLine = (fn: (line: string) => string): Transform => (text, s, e) => {
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  const nl = text.indexOf('\n', e);
  const lineEnd = nl === -1 ? text.length : nl;
  const block = text.slice(lineStart, lineEnd).split('\n').map(fn).join('\n');
  return { text: text.slice(0, lineStart) + block + text.slice(lineEnd), start: lineStart, end: lineStart + block.length };
};

const toggleBullet = perLine((l) => (/^\s*- /.test(l) ? l.replace(/^(\s*)- /, '$1') : '- ' + l));
const indent = perLine((l) => '  ' + l);
const outdent = perLine((l) => l.replace(/^ {1,2}/, ''));

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'In Markdown schreiben…',
  uploadImage,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Upload a pasted image; return its attachment id + display name (null = failed). */
  uploadImage?: (file: File) => Promise<{ id: string; filename: string } | null>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  // Always-current value so async paste-upload edits build on the latest body.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Restore caret/selection after a toolbar edit re-renders the textarea.
  useEffect(() => {
    if (pendingSel.current && ref.current) {
      const [s, e] = pendingSel.current;
      pendingSel.current = null;
      ref.current.focus();
      ref.current.setSelectionRange(s, e);
    }
  });

  function apply(transform: Transform) {
    const ta = ref.current;
    if (!ta) return;
    const res = transform(value, ta.selectionStart, ta.selectionEnd);
    pendingSel.current = [res.start, res.end];
    onChange(res.text);
  }

  const tool = (t: Transform) => (ev: React.MouseEvent) => {
    ev.preventDefault(); // keep textarea focus + selection
    apply(t);
  };

  const setValue = (v: string) => {
    valueRef.current = v;
    onChange(v);
  };

  async function handlePaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!uploadImage) return;
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    const at = ref.current?.selectionStart ?? valueRef.current.length;

    // Insert a plain-text placeholder per image at the caret, then swap it for
    // the real markdown once each upload resolves.
    const jobs = images.map((file) => ({ file, marker: `⏳ ${file.name || 'Bild'} … ${crypto.randomUUID()}` }));
    const block = '\n\n' + jobs.map((j) => j.marker).join('\n') + '\n';
    setValue(valueRef.current.slice(0, at) + block + valueRef.current.slice(at));

    await Promise.all(
      jobs.map(async ({ file, marker }) => {
        const res = await uploadImage(file).catch(() => null);
        const name = (res?.filename || file.name || 'grafik').replace(/[[\]()]/g, '');
        const replacement = res ? `![${name}](${attachmentRef(res.id)})` : '_⚠️ Bild-Upload fehlgeschlagen_';
        setValue(valueRef.current.replace(marker, replacement));
      }),
    );
  }

  return (
    <div className="md-editor">
      <div className="row gap-xs" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="icon-btn icon-btn--sm" title="Fett" onMouseDown={tool(wrap('**'))}>
          <Bold size={16} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" title="Stichpunkt" onMouseDown={tool(toggleBullet)}>
          <List size={16} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" title="Ausrücken" onMouseDown={tool(outdent)}>
          <IndentDecrease size={16} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" title="Einrücken" onMouseDown={tool(indent)}>
          <IndentIncrease size={16} />
        </button>
      </div>

      <textarea
        ref={ref}
        className="textarea md-editor__area"
        value={value}
        placeholder={uploadImage ? `${placeholder} · Screenshot einfügen zum Anhängen` : placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleTextareaTabKey}
        onPaste={handlePaste}
      />
    </div>
  );
}
