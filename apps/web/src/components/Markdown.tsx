import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx } from 'clsx';

// In-app markdown renderer (GFM: tables, task checkboxes, strikethrough).
// Notes/todos store markdown; this turns it into the styled `.markdown` block.
//
// `renderImage` lets a caller take over image rendering — used by the note
// editor and the wiki to resolve `larvis-att:` refs to signed URLs and make
// pasted screenshots resizable. When set, URL sanitisation is disabled so the
// custom scheme reaches the renderer (content is the owner's own, not untrusted).
// `renderLink` does the same for links, e.g. so the wiki can route internal
// `/learnings/<slug>` links client-side instead of reloading the app.
export function Markdown({
  children,
  className,
  renderImage,
  renderLink,
}: {
  children: string;
  className?: string;
  renderImage?: (src: string, alt: string) => ReactNode;
  renderLink?: (href: string, children: ReactNode) => ReactNode;
}) {
  const components = {
    ...(renderImage ? { img: ({ src, alt }: { src?: string; alt?: string }) => <>{renderImage(String(src ?? ''), String(alt ?? ''))}</> } : {}),
    ...(renderLink ? { a: ({ href, children }: { href?: string; children?: ReactNode }) => <>{renderLink(String(href ?? ''), children)}</> } : {}),
  };
  return (
    <div className={clsx('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={renderImage ? (url) => url : undefined}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
