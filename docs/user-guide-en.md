# CorpusMind Voice — User Guide (English)

**Page 1 of 2 · Setup, recording and the six-step pipeline**

CorpusMind Voice is the audio companion of [CorpusMind](https://waleedmandour.org/projects/CorpusMind/), the local-first research environment for corpus linguistics and multimodal discourse analysis. It converts recordings (MP3, MP4, WAV, M4A, WEBM, OGG, FLAC) or live microphone input into a linguistically annotated corpus on your own machine. No account is needed, nothing is uploaded, and no cloud API is ever contacted — the privacy model is absolute by design. This two-page guide walks you through installation, the six-stage pipeline, and the editorial workflow; terminology follows the conventions used on the [project site](https://waleedmandour.org/projects/CorpusMind/).

## 1. Installation

The web build runs anywhere Node.js (or Bun) runs: `bun install`, `bun run db:push`, then `bun run dev` and open `http://localhost:3000`. Installable as a **PWA** from your browser's address bar (or the in-app *Install app* button) so the interface loads fully offline afterwards. Native **desktop builds** for Windows, macOS and Linux are attached to each GitHub release; they bundle their own server and need no Python installed. For research-grade output also install the Python worker: `pip install -r python/requirements.txt` (faster-whisper, ParSelmouth). Montreal Forced Aligner is optional and adds phoneme-grade boundaries (`conda install -c conda-forge montreal-forced-aligner`, then download the `arabic_mfa` / `english_us_arpa` acoustic models and dictionaries). On first run the app downloads the Whisper `large-v3` model (~1.5 GB) with an in-app progress bar.

## 2. Hardware check

Open **Diagnostics** before your first job. The panel reads your CPU, RAM and — via `nvidia-smi` — your NVIDIA GPU. With CUDA present, ASR runs `large-v3` in INT8-float16 on the GPU; without it, the app explicitly warns that processing falls back to CPU (INT8) and can take up to ≈ 2 × real time. Ten minutes of English audio finish within ≈ 15 minutes on an RTX 3060. You can also pin the device per job in the **Studio** tab (Auto / CPU / GPU).

## 3. Record and process (the six steps)

1. In **Studio**, drop a file or click the drop zone to browse; or click **Record from microphone** to capture live speech (press *Stop recording* to upload the take).
2. Pick the **language**: English, Arabic — Egyptian vernacular (عامية), or Arabic — MSA (فصحى).
3. Click **Start pipeline**. Progress is shown per stage, streamed live from the local task queue:

| # | Stage | What happens |
|---|-------|--------------|
| 1 | **Ingest & preprocess** | container decoded to 16 kHz mono PCM WAV (PyAV/pydub) |
| 2 | **ASR** | faster-whisper `large-v3` INT8; word timestamps + confidence |
| 3 | **Forced alignment** | MFA refines word/phoneme boundaries (when installed) |
| 4 | **Prosody** | Praat via ParSelmouth: F0 (50–400 Hz), intensity, jitter, shimmer, HNR |
| 5 | **Disfluency** | pauses > 200 ms, fillers (`um`, `uh`, `يعني`, `آه`, `إيه`), repeats, false starts, interruptions, lengthenings |
| 6 | **Structured output** | SQLite (3 tables) + JSON + TEI/XML written locally |

If the Python worker is not installed, the app runs its **simulation engine** instead — the same six stages with a demo corpus — and labels the job *Simulation* so demo data is never mistaken for real transcriptions.

---

**Page 2 of 2 · Editing, metadata and export**

## 4. Correct the transcript (confidence-coded editor)

Open the **Transcript Editor** tab. Every token carries the ASR confidence as a background colour: **green ≥ 0.85**, **amber 0.60–0.85**, **red < 0.60** — skim the red tokens first. Click any token to correct it: saving marks the token *edited* and queues the containing utterance for a **single-utterance re-alignment pass**, so a one-word fix never re-processes the whole file. Each utterance also exposes its detected disfluencies (pause counts, fillers, repeats, false starts, interruptions, lengthenings) and prosody summary (mean/min/max F0, intensity, jitter, shimmer, HNR).

## 5. Corpus metadata (TEI header)

In **Corpus Metadata** describe the session: title, speaker name or pseudonym, dialect, gender, age, recording date and place, genre, licence and free notes. These fields are embedded into the `<teiHeader>` of every TEI/XML export, exactly the fields CorpusMind expects when importing — see the metadata chapter on the [project site](https://waleedmandour.org/projects/CorpusMind/). Arabic metadata is fully supported (the whole UI switches to right-to-left Arabic with the Cairo typeface from the *العربية* toggle).

## 6. Export to CorpusMind

The **Export** tab writes four artefacts, generated locally from the corpus store:

- **JSON** — full records; loads directly with `pandas.json_normalize(corpus["utterances"], record_path="tokens")`.
- **CSV** — flat token table (utterance index, token index, text, start/end ms, confidence, edited flags).
- **TEI/XML** — TEI P5 document with your `<teiHeader>` and time-aligned `<w>` elements.
- **SQLite** — standalone three-table database (`audio_metadata`, `utterances`, `tokens`).

On the machine where CorpusMind is installed, the **Launch CorpusMind** button in Diagnostics opens the companion app with this corpus ready to query — concordances, collocations and frequency lists as documented on the project site.

## 7. Local AI assistant (optional)

The **Assistant** tab chats with a *local* Ollama model (`http://127.0.0.1:11434`) about your transcripts — e.g. "list utterances with more than two fillers". Start it once with `ollama serve` and pull any model (`ollama run llama3.1`). If Ollama is not running, the panel says so and never substitutes a cloud service.

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Job labelled *Simulation* | Python worker missing → `pip install -r python/requirements.txt` |
| *MFA skipped* in stage 3 | Optional: install MFA + dictionaries (see §1) |
| *No NVIDIA GPU detected* | Expected on CPU-only machines; INT8 CPU mode is used |
| Microphone button does nothing | Grant mic permission in the browser, or upload a file |
| Assistant says Ollama unreachable | `ollama serve`, then re-open the tab |
| Model download stalls | The large-v3 download resumes on the next job |
