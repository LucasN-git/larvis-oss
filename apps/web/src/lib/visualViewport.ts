// Bildschirmtastatur auf Touch-Geräten.
//
// iOS verkleinert beim Öffnen der Tastatur nur den sichtbaren Ausschnitt (Visual
// Viewport), nicht das Layout: der feste body und alle Sheets bleiben so hoch wie
// der Bildschirm, ihr unterer Teil liegt hinter der Tastatur, und Safari schiebt den
// Ausschnitt dazu noch nach oben. Das `interactive-widget` im Viewport-Meta wirkt dort
// nicht. Deshalb spiegelt diese Datei den sichtbaren Ausschnitt in CSS-Variablen
// (`--vv-top`, `--vv-h`, dazu `--kb` für das Verdeckte), an denen body und die Overlay-Ebenen auf Touch-Geräten hängen
// (theme/global.css, theme/components.css) — und hält das fokussierte Feld in seinem
// Scrollbereich sichtbar, sobald die Tastatur den Platz verändert.

const TOUCH = '(pointer: coarse)';

function isTextField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(el.type);
}

/** Nächster Vorfahre, der selbst scrollt (overflow auto/scroll und mehr Inhalt als Platz). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Schiebt das Feld nur innerhalb seines Scrollbereichs ins Bild — nie body oder html. */
function revealFocused() {
  const el = document.activeElement;
  if (!isTextField(el)) return;
  const box = scrollParent(el);
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const vv = window.visualViewport;
  const bottom = Math.min(b.bottom, vv ? vv.offsetTop + vv.height : b.bottom);
  const margin = 12;
  // Ein Feld, höher als der Platz (lange Notiz), zeigt seinen Anfang statt des Endes.
  if (r.height > bottom - b.top - 2 * margin) box.scrollTop -= b.top + margin - r.top;
  else if (r.bottom > bottom - margin) box.scrollTop += r.bottom - bottom + margin;
  else if (r.top < b.top + margin) box.scrollTop -= b.top + margin - r.top;
}

export function installVisualViewport() {
  const vv = window.visualViewport;
  if (!vv || !window.matchMedia(TOUCH).matches) return;
  const root = document.documentElement;
  let lastH = vv.height;
  let frame = 0;

  const apply = () => {
    frame = 0;
    // Beim Pinch-Zoom schrumpft der Ausschnitt auch; dann bleibt das Layout stehen.
    if (Math.abs(vv.scale - 1) > 0.01) return;
    root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    root.style.setProperty('--vv-h', `${vv.height}px`);
    // Was unten von der Tastatur verdeckt ist — für Ebenen, die am unteren Rand hängen (Toasts).
    root.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.offsetTop - vv.height)}px`);
    // Höhe geändert = Tastatur auf oder zu: nach dem Layout das Feld nachziehen.
    if (Math.abs(vv.height - lastH) > 1) requestAnimationFrame(revealFocused);
    lastH = vv.height;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  apply();
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  // Wechsel zwischen Feldern bei schon offener Tastatur ändert die Höhe nicht.
  document.addEventListener('focusin', () => setTimeout(revealFocused, 50));
}
