// Optionale Module auf der Serverseite. Learnweb ist aus, solange LEARNWEB_ENABLED (oder, wenn
// das leer ist, VITE_LEARNWEB_ENABLED) nicht auf 1 steht; dann antworten die Learnweb-Endpunkte mit 404.
const on = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

export function learnwebEnabled(): boolean {
  return on(process.env.LEARNWEB_ENABLED?.trim() || process.env.VITE_LEARNWEB_ENABLED?.trim() || undefined);
}
