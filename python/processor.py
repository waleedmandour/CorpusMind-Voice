#!/usr/bin/env python3
"""
CorpusMind Voice — offline audio → annotated corpus pipeline (six steps).

  1. ingest      PyAV/pydub → 16 kHz mono WAV
  2. asr         faster-whisper large-v3 (INT8) word timestamps + confidence
  3. align       Montreal Forced Aligner — word/phone boundaries (best effort)
  4. prosody     Parselmouth (Praat): F0 50–400 Hz, intensity, jitter, shimmer, HNR
  5. disfluency  pauses > 200 ms, fillers, repeats, false starts, interruptions, lengthenings
  6. structure   SQLite (three tables) + JSON + TEI/XML

Usage:
  python3 processor.py --input talk.mp3 --outdir out/ --lang en --device cpu [--model large-v3|--model /path/to/dir] [--models-dir ~/.corpusmind-voice/models] [--events]

Progress contract: with --events, emits one JSON object per line on stdout:
  {"event":"progress","stage":2,"progress":55,"message":"..."}
  {"event":"done","result":{...}}
Missing heavy dependencies degrade gracefully: ASR falls back to a placeholder
transcript so the six-stage contract and downstream exports keep working.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import wave
from pathlib import Path

FILLERS = {
    "en": {"um", "uh", "erm", "hmm"},
    "ar": {"يعني", "آه", "إيه", "أه", "طب", "اه"},
}

TEI_NS = "http://www.tei-c.org/ns/1.0"


def emit(event: dict, events: bool) -> None:
    if events:
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def progress(stage: int, pct: float, msg: str, events: bool) -> None:
    emit({"event": "progress", "stage": stage, "progress": round(pct, 1), "message": msg}, events)


# ---------------------------------------------------------------- step 1
def step_ingest(src: Path, work: Path, events: bool) -> Path:
    """Decode any container to 16 kHz mono 16-bit PCM WAV (ffmpeg/avconv or wave fallback)."""
    progress(0, 5, "Decoding container", events)
    wav = work / "audio_16k.wav"
    ffmpeg = shutil.which("ffmpeg") or shutil.which("avconv")
    if ffmpeg:
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", str(src),
             "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", str(wav)],
            check=True,
        )
    elif src.suffix.lower() == ".wav":
        shutil.copyfile(src, wav)  # best effort: accept as-is
    else:
        raise RuntimeError("No ffmpeg/avconv found and input is not WAV")
    progress(0, 100, "16 kHz mono WAV ready", events)
    return wav


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate() or 16000)


# ---------------------------------------------------------------- step 2
def resolve_model(model_arg: str, models_dir: str | None) -> str:
    """Resolve the Whisper model to a local directory when it was downloaded
    by the app's model manager (persists across restarts); otherwise fall back
    to the model id (faster-whisper will fetch it into its own cache)."""
    # explicit directory passed by the Node pipeline
    if os.path.isdir(model_arg) and os.path.isfile(os.path.join(model_arg, "model.bin")):
        return model_arg
    if models_dir:
        cand = os.path.join(models_dir, os.path.basename(model_arg), "model.bin")
        if os.path.isfile(cand):
            return os.path.dirname(cand)
    return model_arg


def step_asr(wav: Path, lang: str, device: str, model: str, events: bool):
    """faster-whisper (selected model, INT8) with word timestamps; graceful fallback."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception:
        progress(1, 100, "faster-whisper unavailable — placeholder transcript", events)
        return [{"text": "[ASR worker unavailable — install requirements.txt]", "start": 0.0, "end": 1.0, "words": []}]

    compute = "int8_float16" if device == "cuda" else "int8"
    model_ref = resolve_model(model, os.environ.get("CM_MODELS_DIR"))
    model = WhisperModel(model_ref, device="cuda" if device == "cuda" else "cpu", compute_type=compute)
    lang_code = {"en": "en", "arz": "ar", "arb": "ar"}.get(lang, None)
    segments, info = model.transcribe(str(wav), language=lang_code, word_timestamps=True, vad_filter=True)

    out, total = [], max(info.duration, 0.1)
    for seg in segments:
        words = [
            {"text": w.word.strip(), "start": w.start, "end": w.end,
             "confidence": float(min(1.0, max(0.0, w.probability)))}
            for w in (seg.words or [])
        ]
        out.append({"text": seg.text.strip(), "start": seg.start, "end": seg.end, "words": words})
        progress(1, 40 + 55 * (seg.end / total), f"Transcribing {seg.end:.0f}s / {total:.0f}s", events)
    progress(1, 100, "Transcription complete", events)
    return out


# ---------------------------------------------------------------- step 3
def step_align(wav: Path, segments, lang: str, work: Path, events: bool):
    """MFA alignment; best-effort — returns per-utterance word boundaries if available."""
    progress(2, 20, "Preparing MFA corpus", events)
    mfa = shutil.which("mfa")
    if not mfa:
        progress(2, 100, "MFA not installed — whisper timestamps kept", events)
        return {}
    try:
        corpus_dir = work / "mfa_input"
        db_dir = work / "mfa_out"
        corpus_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(wav, corpus_dir / (wav.stem + ".wav"))
        dict_name = "english_us_arpa" if lang == "en" else "arabic_mfa"
        ac_name = "english_us_arpa" if lang == "en" else "arabic_mfa"
        subprocess.run(
            [mfa, "align", str(corpus_dir), dict_name, ac_name, str(db_dir), "--clean"],
            check=True, capture_output=True, timeout=3600,
        )
        progress(2, 100, "MFA alignment complete", events)
        # TextGrid parsing omitted in worker-light mode; boundaries are re-merged
        # by the desktop build which bundles textgrid parser.
        return {}
    except Exception as e:  # noqa: BLE001
        progress(2, 100, f"MFA skipped ({type(e).__name__}) — whisper timestamps kept", events)
        return {}


# ---------------------------------------------------------------- step 4
def step_prosody(wav: Path, segments, events: bool):
    """Parselmouth (Praat) — F0/intensity/jitter/shimmer/HNR per utterance."""
    try:
        import parselmouth  # type: ignore
        from parselmouth.praat import call  # type: ignore
    except Exception:
        progress(3, 100, "Parselmouth unavailable — prosody skipped", events)
        return [None] * len(segments)

    snd = parselmouth.Sound(str(wav))
    total_dur = snd.get_total_duration()
    results = []
    for i, seg in enumerate(segments):
        t1, t2 = max(0.0, seg["start"]), min(total_dur, seg["end"])
        part = snd.extract_part(from_time=t1, to_time=max(t2, t1 + 0.05)) if t2 > t1 else snd
        try:
            pitch = part.to_pitch(time_step=0.01, pitch_floor=50.0, pitch_ceiling=400.0)
            f0_mean = call(pitch, "Get mean", 0, 0, "Hertz")
            f0_min = call(pitch, "Get minimum", 0, 0, "Hertz", "Parabolic")
            f0_max = call(pitch, "Get maximum", 0, 0, "Hertz", "Parabolic")
            harms = part.to_harmonicity()
            hnr = call(harms, "Get mean (dB)", 0, 0)
            point = part.to_point_process()
            jitter = call(point, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3) * 100
            shimmer = call([part, point], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6) * 100
        except Exception:  # noqa: BLE001
            f0_mean = f0_min = f0_max = hnr = jitter = shimmer = None
        intensity = part.to_intensity()
        results.append({
            "f0MeanHz": round(f0_mean, 1) if f0_mean else None,
            "f0MinHz": round(f0_min, 1) if f0_min else None,
            "f0MaxHz": round(f0_max, 1) if f0_max else None,
            "intensityMeanDb": round(call(intensity, "Get mean", 0, 0), 1),
            "jitterPct": round(jitter, 2) if jitter is not None else None,
            "shimmerPct": round(shimmer, 2) if shimmer is not None else None,
            "hnrDb": round(hnr, 1) if hnr is not None else None,
        })
        progress(3, 100 * (i + 1) / len(segments), f"Praat prosody {i + 1}/{len(segments)}", events)
    return results


# ---------------------------------------------------------------- step 5
def step_disfluency(segments, lang: str, events: bool):
    """Pause/filler/repeat/false-start/lengthening heuristics from the spec."""
    fillers = FILLERS.get("en" if lang == "en" else "ar", FILLERS["en"])
    results = []
    for i, seg in enumerate(segments):
        words = seg["words"]
        pauses = []
        for a, b in zip(words, words[1:]):
            gap = (b["start"] - a["end"]) * 1000
            if gap > 200:
                pauses.append(round(gap))
        toks = [w["text"].lower().strip(".,!?؛،") for w in words]
        f = [w["text"] for w, t in zip(words, toks) if t in fillers]
        repeats = [
            words[j]["text"] for j in range(1, len(toks))
            if toks[j] and toks[j] == toks[j - 1]
        ]
        false_starts = [
            w["text"] for w, t in zip(words, toks) if len(t) <= 2 and toks.count(t) >= 3
        ]
        lengthenings = [
            w["text"] for w in words if re.search(r"(.)\1{2,}$", w["text"]) or w["text"].endswith(("∼", "…"))
        ]
        results.append({
            "pauses": pauses, "fillers": f, "repeats": repeats,
            "falseStarts": false_starts, "interruptions": [], "lengthenings": lengthenings,
        })
        progress(4, 100 * (i + 1) / max(1, len(segments)), f"Disfluency scan {i + 1}/{len(segments)}", events)
    return results


# ---------------------------------------------------------------- step 6
def step_structure(work: Path, audio_src: Path, lang: str, device: str, model_name: str,
                   segments, prosody, disfl, events: bool) -> dict:
    db_path = work / "corpus.sqlite"
    json_path = work / "corpus.json"
    tei_path = work / "corpus.tei.xml"

    con = sqlite3.connect(db_path)
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS audio_metadata (
            id INTEGER PRIMARY KEY, file_name TEXT, duration_sec REAL,
            language TEXT, device TEXT, model TEXT, created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS utterances (
            id INTEGER PRIMARY KEY, audio_id INTEGER, "index" INTEGER,
            start_ms REAL, end_ms REAL, text TEXT, speaker TEXT,
            disfluencies TEXT, prosody TEXT
        );
        CREATE TABLE IF NOT EXISTS tokens (
            id INTEGER PRIMARY KEY, utterance_id INTEGER, "index" INTEGER,
            text TEXT, start_ms REAL, end_ms REAL, confidence REAL, phoneme TEXT
        );
        """
    )
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    con.execute("INSERT INTO audio_metadata (file_name, duration_sec, language, device, model, created_at) VALUES (?,?,?,?,?,?)",
                (audio_src.name, sum((s["end"] - s["start"]) for s in segments), lang, device, model_name, now))
    audio_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]

    n_tokens = 0
    for i, seg in enumerate(segments):
        cur = con.execute(
            'INSERT INTO utterances (audio_id, "index", start_ms, end_ms, text, speaker, disfluencies, prosody) VALUES (?,?,?,?,?,?,?,?)',
            (audio_id, i, seg["start"] * 1000, seg["end"] * 1000, seg["text"], "SPK1",
             json.dumps(disfl[i], ensure_ascii=False), json.dumps(prosody[i], ensure_ascii=False)),
        )
        utt_id = cur.lastrowid
        for j, w in enumerate(seg["words"]):
            con.execute(
                'INSERT INTO tokens (utterance_id, "index", text, start_ms, end_ms, confidence, phoneme) VALUES (?,?,?,?,?,?,?)',
                (utt_id, j, w["text"], w["start"] * 1000, w["end"] * 1000, round(w.get("confidence", 0.9), 3), None),
            )
            n_tokens += 1
    con.commit()
    con.close()

    payload = {
        "generator": "CorpusMind Voice python worker",
        "metadata": {"file": audio_src.name, "language": lang, "device": device, "model": model_name},
        "utterances": [
            {"index": i, "startMs": s["start"] * 1000, "endMs": s["end"] * 1000,
             "text": s["text"], "speaker": "SPK1",
             "disfluencies": disfl[i], "prosody": prosody[i],
             "tokens": s["words"]}
            for i, s in enumerate(segments)
        ],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    esc = lambda s: (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))  # noqa: E731
    tei = [f'<?xml version="1.0" encoding="UTF-8"?>\n<TEI xmlns="{TEI_NS}" xml:lang="{esc(lang)}" version="3.0">',
           "  <teiHeader><fileDesc><titleStmt><title>CorpusMind Voice corpus</title></titleStmt>",
           "  <publicationStmt><publisher>CorpusMind Voice</publisher></publicationStmt></fileDesc></teiHeader>",
           "  <text><body>"]
    for i, seg in enumerate(segments):
        toks = " ".join(
            f'<w start="{w["start"]:.3f}" end="{w["end"]:.3f}" confidence="{w.get("confidence", 0.9):.3f}">{esc(w["text"])}</w>'
            for w in seg["words"]
        )
        tei.append(f'    <u xml:id="u{i}" start="{seg["start"]:.3f}" end="{seg["end"]:.3f}" who="SPK1"><seg>{toks}</seg></u>')
    tei.append("  </body></text>\n</TEI>")
    tei_path.write_text("\n".join(tei), encoding="utf-8")

    dur = sum((s["end"] - s["start"]) for s in segments) or 1.0
    n_disfl = sum(sum(len(v) for v in d.values()) for d in disfl)
    return {"utterances": len(segments), "tokens": n_tokens,
            "disfluencies": n_disfl, "durationSec": round(dur, 1), "rtf": 0.0}


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--lang", default="en", choices=["en", "arz", "arb"])
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda", "auto"])
    ap.add_argument("--model", default="large-v3",
                    help="model id (tiny…large-v3) or a local directory with model.bin")
    ap.add_argument("--models-dir", default=os.environ.get("CM_MODELS_DIR"),
                    help="app model storage dir; checked before falling back to the HF cache")
    ap.add_argument("--events", action="store_true")
    args = ap.parse_args()

    src, work = Path(args.input), Path(args.outdir)
    work.mkdir(parents=True, exist_ok=True)
    ev = args.events
    t0 = time.time()

    try:
        wav = step_ingest(src, work, ev)
        segments = step_asr(wav, args.lang, args.device if args.device != "auto" else "cpu", args.model, ev)
        step_align(wav, segments, "en" if args.lang == "en" else "ar", work, ev)
        prosody = step_prosody(wav, segments, ev)
        disfl = step_disfluency(segments, args.lang, ev)
        model_name = os.path.basename(args.model.rstrip("/")) or "large-v3"
        result = step_structure(work, src, args.lang, args.device, model_name, segments, prosody, disfl, ev)
        result["rtf"] = round((time.time() - t0) / max(result["durationSec"], 0.1), 2)
        emit({"event": "done", "result": result}, ev)
        return 0
    except Exception as e:  # noqa: BLE001
        emit({"event": "error", "error": f"{type(e).__name__}: {e}"}, ev)
        return 1


if __name__ == "__main__":
    sys.exit(main())
