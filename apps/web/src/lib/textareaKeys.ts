import type { KeyboardEvent } from 'react';

// Make Tab indent (2 spaces) inside textareas instead of moving focus.
// Shift+Tab outdents up to 2 leading spaces. Uses execCommand('insertText')
// so the change flows through React's onChange and stays in the undo stack.
export function handleTextareaTabKey(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const ta = e.currentTarget;
  if (e.shiftKey) {
    const start = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    const before = ta.value.slice(lineStart, start);
    const remove = before.endsWith('  ') ? 2 : before.endsWith(' ') ? 1 : 0;
    if (remove) {
      ta.setSelectionRange(start - remove, start);
      document.execCommand('delete');
    }
  } else {
    document.execCommand('insertText', false, '  ');
  }
}
