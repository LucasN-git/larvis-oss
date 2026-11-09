#!/usr/bin/env python3
"""Standalone-Transkription einer Audiodatei mit lokalem faster-whisper.

Läuft im larvis-voice-venv unter ~/.local/share/larvis-voice/.venv (faster-whisper
ist dort schon installiert). Kein Längenlimit (anders als listen.py, das fürs
Mikrofon bei 60 s kappt) — geeignet für 2-Stunden-Vorlesungen. Keine API-Kosten.

Aufruf:
    python transcribe.py --audio lecture.wav [--model small] [--language auto]

--language auto lässt Whisper die Sprache erkennen (ein Kurs kann Englisch sein, andere
Kurse ggf. Deutsch). stdout: ein JSON-Objekt
    {"language": "en", "duration": 6600.0, "segments": [{"start":0.0,"end":4.2,"text":"…"}, …]}
stderr: Fortschritt (alle paar Segmente).
Exit-Codes: 0 = ok, 1 = Fehler.
"""

import argparse
import json
import os
import sys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True, help="Pfad zur Audio-/Videodatei")
    ap.add_argument("--model", default=os.environ.get("LEARNWEB_WHISPER_MODEL", "small"))
    ap.add_argument("--language", default=os.environ.get("LEARNWEB_WHISPER_LANGUAGE", "auto"))
    args = ap.parse_args()

    if not os.path.exists(args.audio):
        print(f"Audiodatei nicht gefunden: {args.audio}", file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "faster_whisper fehlt. Setup: python3 -m venv ~/.local/share/larvis-voice/.venv && "
            "~/.local/share/larvis-voice/.venv/bin/pip install faster-whisper",
            file=sys.stderr,
        )
        sys.exit(1)

    lang = None if args.language in ("auto", "", None) else args.language
    print(f"Lade Modell {args.model} (cpu/int8) …", file=sys.stderr)
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    segments, info = model.transcribe(args.audio, language=lang, vad_filter=True)

    out = []
    for i, seg in enumerate(segments):
        out.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        if i % 25 == 0:
            mm = int(seg.start // 60)
            ss = int(seg.start % 60)
            print(f"  Segment {i} @ {mm:02d}:{ss:02d}", file=sys.stderr)

    json.dump(
        {"language": info.language, "duration": round(info.duration, 2), "segments": out},
        sys.stdout,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
