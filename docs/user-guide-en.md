# CorpusMind Voice - User Guide (English)

**Version 1.3.0 · Two-page quick guide**

CorpusMind Voice is the audio companion of [CorpusMind](https://waleedmandour.org/projects/CorpusMind/), the local-first research environment for corpus linguistics and multimodal discourse analysis. It converts recordings (MP3, MP4, M4A, AAC, OGG, OPUS, WAV, FLAC, WEBM, WMA, AMR, 3GP, AIFF) or live microphone input into a linguistically annotated corpus on your own machine, and analyses it academically. No account is needed, nothing is uploaded, and no cloud API is ever contacted. This guide walks you through the six-stage pipeline and the editorial workflow; terminology follows the conventions used on the [project site](https://waleedmandour.org/projects/CorpusMind/).

## 1. Installation

The web build runs anywhere Node.js (or Bun) runs: `bun install`, `bun run db:push`, then `bun run dev` and open `http://localhost:3000`. It is installable as a **PWA** from your browser's address bar (or the in-app *Install app* button): on a phone or tablet the PWA lets you record and analyse on the go, entirely on-device. Native **desktop builds** for Windows (NSIS `.exe` and `.msi`), macOS (Apple Silicon and Intel `.dmg`) and Linux (`.deb`) are attached to each GitHub release. Desktop installs embed their own server, Whisper engine and ffmpeg decoder, so they need nothing else on your system.

**About the Windows SmartScreen warning.** The Windows installers are currently not code-signed with a paid Authenticode certificate, so Windows Defender SmartScreen shows "Windows protected your PC" (or "unidentified publisher") on first run. This is the standard warning for every unsigned installer, not a virus report: the app is MIT-licensed open source, reproducible from this repository. To install, click **More info**, then **Run anyway**; the installer itself verifies its files before continuing. Organisations that want a verified-publisher build can enable the optional Authenticode signing step (`scripts/sign-windows.ps1`) by adding `WINDOW_PFX_BASE64` and `WINDOW_PFX_PASSWORD` repository secrets; builds without those secrets stay unsigned and behave exactly as today.

A first-launch **Welcome window** (three short pages, English/Arabic) introduces the app, the offline privacy model and a quick start; a **Light / Dark / System theme** toggle lives in the header.

## 2. Set up first: Settings & Diagnostics

The tab strip starts with **Settings & Diagnostics** so every job begins configured. Four panels matter here:

- **Whisper models** - download any size on demand: `tiny` (about 75 MB), `base` (150 MB), `small` (330 MB), `medium` (950 MB) or `large-v3-turbo` (900 MB, recommended for research accuracy). Models are stored in the app's private data folder, survive restarts and updates, and are reused fully offline; downloads are resumable and show live progress. Delete a model at any time to reclaim space. Since v1.3.0 all recordings and app data live in the per-user application data folder (writable in every install mode, including per-machine MSI installs), and recordings saved by older versions are migrated there automatically.
- **Hardware & Diagnostics** - reads your CPU, RAM and NVIDIA GPU, and reports whether the optional Python accelerator (faster-whisper host) is available. The built-in engine runs on CPU and needs nothing else.
- **Local LLM** - Ollama (port 11434) and LM Studio (port 1234) are detected automatically, exactly like the parent CorpusMind; on desktop the app can start `ollama serve` for you. A custom **Ollama host** (for example `192.168.1.50:11434`) can be saved, so the app - and the phone companion - use a daemon running on another machine on your network; leave the field empty to use the Ollama installed on this machine.
- **Phone companion** (desktop only) - see section 9.

## 3. Record and process (the six steps)

1. In **Studio**, drop a file or click the drop zone to browse, or click **Record from microphone** to capture live speech (press *Stop recording* to upload the take). On desktop the microphone permission is handled inside the app: Windows WebView2 is pre-configured to grant it without an extra prompt, and macOS shows the standard system prompt once. If recording still silently fails, the OS-level privacy toggle is usually the cause (see troubleshooting); on mobile browsers a codec fallback chain (webm/opus, mp4/aac, ogg) keeps recording working everywhere.
2. Pick the **language** (English, Arabic: Egyptian vernacular عامية, Arabic: MSA فصحى), the **compute device** and the **Whisper model**.
3. The pipeline starts automatically after upload. Progress is streamed per stage from the local task queue:

| # | Stage | What happens |
|---|-------|--------------|
| 1 | **Ingest & preprocess** | container decoded to 16 kHz mono PCM by the bundled ffmpeg |
| 2 | **ASR** | local Whisper (chosen model, INT8/Q4); word timestamps via cross-attention DTW |
| 3 | **Alignment** | word boundaries aligned to the waveform from Whisper's attention heads |
| 4 | **Prosody** | Praat-style analysis of the waveform: F0 (50-400 Hz), intensity, jitter, shimmer, HNR |
| 5 | **Disfluency** | pauses > 200 ms, fillers (`um`, `uh`, `يعني`, `آه`, `إيه`), repeats, false starts, interruptions, lengthenings |
| 6 | **Structured output** | SQLite (3 tables) + JSON + TEI/XML written locally |

The job badge shows which engine ran: **Whisper (built-in, offline)** everywhere by default, or **Python worker (faster-whisper)** when that optional host environment is installed.

## 4. Correct the transcript (confidence-coded editor)

Open the **Transcript Editor** tab. Every token carries its confidence as a background colour: **green >= 0.85**, **amber 0.60-0.85**, **red < 0.60**, so skim the red tokens first. Click any token to correct it; the utterance text is rebuilt automatically so every export always matches the corrected tokens. Each utterance also exposes its detected disfluencies (pause counts, fillers, repeats, false starts, interruptions, lengthenings), its prosody summary (mean/min/max F0, intensity, jitter, shimmer, HNR), and a **click-to-play** button that plays that span straight from the recording. Multi-speaker recordings can be fixed with **speaker relabeling** per utterance, and the hesitation-marker lexicon is **editable per language** in Settings & Diagnostics.

## 5. Re-run, or delete a recording

Every entry in the Studio's **Recent jobs** list carries two buttons:

- **Re-run** opens a small dialog where you pick a different Whisper model, dialect or compute device, then reruns the whole pipeline for that recording. This is the recommended workflow after testing with `tiny`: re-run with `large-v3-turbo` for the final pass. The previous transcript of that recording is replaced.
- **Delete** removes the audio file together with its transcript, analysis and metadata, after a confirmation prompt.

The pipeline card itself also offers **Re-run** as soon as a job finishes (or fails), so a failed job can be retried with a corrected setup in one click.

## 6. Corpus Overview and metadata

Two tabs sit before Linguistic Analysis. In **Metadata** describe the session: title, speaker name or pseudonym, dialect, gender, age, recording date and place, genre, licence and free notes; these fields are embedded into the `<teiHeader>` of every saved file, exactly the fields CorpusMind expects when importing. The **Corpus Overview** tab aggregates every session on the device: an inventory with durations and token counts, corpus-wide frequency with **DP dispersion** across sessions, and a cross-session KWIC concordance with audio playback, so a project of many recordings can be queried as one corpus. Arabic metadata is fully supported: the whole UI switches to right-to-left Arabic with the Cairo typeface from the *العربية* toggle. On machines where CorpusMind is installed, the **Launch CorpusMind** button in Settings & Diagnostics opens the companion app with this corpus ready to query.

## 7. Linguistic analysis

The **Linguistic Analysis** tab computes a full academic report locally; nothing is uploaded. Eight modules:

- **Overview** - tokens, types, speech rate (wpm), utterances, hapax legomena, confidence distribution.
- **Frequency** - word list with counts, per-1,000 rates, Gries **DP dispersion**, function-word filter, bar chart and the **Zipf rank-frequency curve** (log-log, top 200 types).
- **KWIC** - concordancer with configurable context window, case toggle, timestamps, and three **match modes**: normalized (strips Arabic diacritics, unifies alef variants), whole-word and regular expression, with a live hit count and audio playback on every hit.
- **Keywords** - log-likelihood **G²**, **LogRatio** and **%DIFF** effect sizes (Hardie 2014) against your other sessions, or against a built-in function-word reference when only one session exists.
- **Collocations & N-grams** - a node-word **collocates explorer** (span 1-5, left/right/both, minimum co-occurrence) scoring **MI**, **t-score** and **logDice**, plus top bigram/trigram/4-gram lists.
- **Lexical diversity** - length-robust **MATTR** (window 50) and **MTLD** (>= 0.72), plus plain TTR and **lexical density**.
- **Readability** - Flesch Reading Ease and Flesch-Kincaid grade (English), language-neutral **LIX** and long-word share.
- **Speech & Prosody** - disfluency rates per 1,000 tokens by type, pause statistics, and prosody aggregates (F0 mean/range, intensity, jitter, shimmer, HNR).

Every table saves to CSV, and the whole report saves as JSON. A **Save to device** row at the bottom of the Editor and Corpus Overview tabs writes JSON / CSV / TEI/XML / SQLite, and the transcript itself exports as **Praat TextGrid**, **ELAN EAF**, **SRT** and **WebVTT** for phonetic and multimodal workbenches.

## 8. Local AI assistant (optional)

The **Assistant** tab chats with a *local* model through **Ollama** (`http://127.0.0.1:11434`) or **LM Studio** (`http://127.0.0.1:1234`), e.g. "list utterances with more than two fillers". Three per-transcript tools run through the same local model: **Summarise**, **Preview without fillers**, and **Suggest topic tags**. If no provider is reachable, the panel says so and never substitutes a cloud service.

## 9. Phone companion (optional, desktop)

The desktop app can open itself to your phone over Wi-Fi, so a phone becomes a recording and review client for the desktop engine:

1. In Settings & Diagnostics, open the **Phone companion** card and click **Enable**. The app generates a pairing token and a certificate, then asks to restart once; after the restart the card shows **Active**.
2. Scan the **QR code** with the phone camera (or type the link). Two links are shown: `http://` for browsing, uploading and playback, and `https://` which additionally allows **microphone recording** from the phone (browsers only expose the microphone on secure pages). The first time you open the `https://` link the phone warns about the self-signed certificate once; accept it to continue.
3. The phone gets the same app: record or upload on the phone, transcribe with the desktop's Whisper models, browse and export the corpus, and chat through the local LLM. "Add to Home screen" installs it like an app.

Everything stays on your local network: every request must carry the pairing token, nothing is exposed to the internet, and disabling the card (plus a restart) closes the service. If your desktop firewall asks, allow incoming connections for the app on **private** networks only.

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Job failed: model not downloaded | Settings & Diagnostics → Whisper models → **Download**, then **Re-run** the job |
| Job failed: decoding error | The container codec is unusual; convert to WAV/MP3 with any tool and re-upload |
| *No NVIDIA GPU detected* | Expected on CPU-only machines; the built-in engine runs on CPU |
| Whisper model missing in Studio | Settings & Diagnostics → Whisper models → **Download** |
| "Windows protected your PC" during install | Expected for unsigned open-source installers. Click **More info** → **Run anyway**; see section 1 |
| Upgrade fails with "Error opening file for writing" (v1.2.0 or earlier) | Fixed in v1.2.1: the new installer closes the app and any leftover background server itself. On an old build: close the app, end any `node.exe` running from the CorpusMind Voice folder in Task Manager, then retry |
| Recording silently fails, no prompt appears (Windows) | Windows Settings → **Privacy & security** → **Microphone** → enable *Let apps access your microphone* and *Let desktop apps access your microphone*, then restart the app. Managed/enterprise machines may need administrator help |
| Microphone button does nothing | Grant mic permission in the browser/OS, or upload a file; recording needs HTTPS or localhost |
| Upload or recording fails with a permission error (v1.2.x desktop) | Fixed in v1.3.0: app data now lives in the per-user application data folder instead of the read-only install directory. Update the app; recordings saved by older versions are migrated automatically on first launch |
| Phone cannot open the pairing link | Phone and desktop must be on the same Wi-Fi network; after enabling the companion, restart the desktop app once (the card must show **Active**); allow the app through the firewall on private networks when asked |
| Phone recording button does nothing | Use the `https://` pairing link instead of `http://`, and accept the self-signed certificate warning once; browsers only allow microphone capture on secure pages |
| Assistant unreachable | Start `ollama serve` or load a model in LM Studio (port 1234), then re-open the tab. Using a remote Ollama? Save its host in Settings & Diagnostics → Local LLM → **Ollama host** |
| Downloaded model "vanished" | It cannot: models persist in the app data folder; check the path shown in Settings |
