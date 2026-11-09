// Profilbild kommt als statische Datei aus dem public-Ordner:
//   apps/web/public/profilbild.jpg  →  ausgeliefert unter /profilbild.jpg
// Kein Storage-Bucket, kein Upload. Datei austauschen = Bild ändern.
// Fehlt die Datei, rendert die UI den Initial-Buchstaben (onError-Fallback).
export const PROFILE_IMAGE_SRC = '/profilbild.jpg';
