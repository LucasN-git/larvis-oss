import { useState } from 'react';
import { Check, Copy, TerminalSquare } from 'lucide-react';
import { claudeCodeUrl, terminalCommand, vscodeUrl } from '../../lib/openLocal';
import { VSCodeIcon } from '../../components/VSCodeIcon';

/**
 * "Open this project's local folder" actions. Only renders when a path is set.
 * The links use OS URL schemes (see lib/openLocal.ts) and only do anything on
 * the machine that actually holds the folder.
 */
export function ProjectOpenLinks({ localPath, size = 'md' }: { localPath: string | null; size?: 'md' | 'sm' }) {
  const [copied, setCopied] = useState(false);
  if (!localPath) return null;

  const cls = size === 'sm' ? 'icon-btn icon-btn--sm' : 'icon-btn';

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(terminalCommand(localPath!));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="row gap-xs center">
      <a className={cls} href={vscodeUrl(localPath)} title={`In VS Code öffnen — ${localPath}`} aria-label="In VS Code öffnen">
        <VSCodeIcon size={18} />
      </a>
      <a
        className={cls}
        href={claudeCodeUrl(localPath)}
        title={`In Claude Code öffnen (Terminal) — ${localPath}`}
        aria-label="In Claude Code öffnen"
      >
        <TerminalSquare size={18} />
      </a>
      <button className={cls} onClick={copyCommand} title="Terminal-Befehl kopieren" aria-label="Terminal-Befehl kopieren">
        {copied ? <Check size={18} className="text-accent" /> : <Copy size={18} />}
      </button>
    </div>
  );
}
