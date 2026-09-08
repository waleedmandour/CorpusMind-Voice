# CorpusMind Voice v1.2.0

**Offline audio → linguistically annotated corpus.** A companion tool for [CorpusMind](https://waleedmandour.org/projects/CorpusMind/).

- App (PWA, works on iOS / Android — record & analyse on your phone): **https://corpus-mind-voice.vercel.app**
- Project page: **https://waleedmandour.org/projects/CorpusMindVoice/**
- DOI: [10.5281/zenodo.22649310](https://doi.org/10.5281/zenodo.22649310)

## Highlights in v1.2.0

- **New Corpus tab (cross-session view)** — everything processed so far, aggregated:
  - **Sessions** table with language, duration, utterance/token counts and a one-click open.
  - **Corpus frequency** over the whole corpus with **DP dispersion measured across
    sessions** (0 = evenly spread, 1 = concentrated in a single session).
  - **Cross-session KWIC concordance** with normalized (Arabic-aware), whole-word and
    regex match modes; every hit plays the audio around the match.
- **Academic export formats** — save from every tab as
  JSON / CSV / TEI/XML / **Praat TextGrid** (utterance + token interval tiers) /
  **ELAN EAF 3.0** (per-speaker tiers with token sub-tiers) / **SRT** / **WebVTT** / SQLite.
- **Deeper Linguistic Analysis**
  - **Node-word collocates explorer** — windowed collocates (span 1-5, left/right/both,
    minimum co-occurrence) with **MI**, **t-score** and **logDice**, sortable and exportable.
  - **Zipf rank-frequency curve** (log-log) over the top 200 types.
  - **%DIFF** effect size (Hardie 2014) added to the Keywords table and CSV.
- **Retrieval upgrades** — KWIC gains **normalized matching** (strips Arabic diacritics
  and unifies alef variants), **whole-word** and **regular-expression** modes, a live
  match count with a cap note, and precise token timestamps in the CSV export.
- **Audio playback everywhere** — new media endpoint with HTTP Range support; play
  utterances in the editor and any KWIC hit in the analysis and corpus views.
- **Annotation integrity**
  - Editing a token now rebuilds the utterance text, so TEI/CSV/JSON exports always
    match the corrected tokens.
  - **Speaker relabeling** per utterance (click the speaker label in the editor).
- **Editable filler lexicon** — the hesitation markers tagged by the disfluency stage
  are now user-editable per language (Settings and Diagnostics) and are passed to the
  Python worker and the simulation engine for new recordings.
- **Bilingual throughout** — every new surface ships in English and Arabic (RTL).

## Installers

| Platform | File |
| --- | --- |
| Windows x64 | `CorpusMind.Voice_1.2.0_x64-setup.exe` (NSIS) |
| Windows x64 | `CorpusMind.Voice_1.2.0_x64_en-US.msi` |
| macOS Apple Silicon | `CorpusMind.Voice_1.2.0_aarch64.dmg` |
| macOS Intel | `CorpusMind.Voice_1.2.0_x64.dmg` |
| Linux x64 | `CorpusMind.Voice_1.2.0_amd64.deb` |

*Documentation:* the two-page **User Guide (English)** ships with the release as
`CorpusMind-Voice-User-Guide-EN.pdf` (source: `docs/user-guide-en.md`), and the
clean app icon ships alongside the installers. The `.msi` is built on the
`windows-2022` runner (the windows-2025 image dropped .NET Framework 3.5, which
WiX 3 `candle.exe` needs); it remains a best-effort job so NSIS always ships.

MIT License · © 2026 Dr. Waleed Mandour (Sultan Qaboos University) & Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University)

## Cite

> Mandour, W., & Ibrahim, W. (2026). *CorpusMind Voice: A local-first audio-to-corpus pipeline for corpus linguistics* (Version 1.2.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22649310
