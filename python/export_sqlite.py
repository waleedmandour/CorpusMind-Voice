#!/usr/bin/env python3
"""CorpusMind Voice — SQLite corpus export.

Builds a standalone three-table corpus database (audio_metadata / utterances /
tokens) for one audio record, copied from the app's Prisma SQLite store.
Uses only the Python standard library so the export works on any machine.
"""
import sqlite3
import sys


def main(src_db: str, audio_id: str, out_path: str) -> int:
    src = sqlite3.connect(src_db)
    src.row_factory = sqlite3.Row

    dst = sqlite3.connect(out_path)
    dst.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE audio_metadata (
            id TEXT PRIMARY KEY, file_name TEXT, format TEXT, duration_sec REAL,
            sample_rate INTEGER, channels INTEGER, language TEXT, device TEXT,
            model TEXT, corpus_title TEXT, speaker_name TEXT, speaker_dialect TEXT,
            speaker_gender TEXT, speaker_age TEXT, recording_date TEXT,
            recording_place TEXT, genre TEXT, license TEXT, notes TEXT,
            created_at TEXT
        );
        CREATE TABLE utterances (
            id TEXT PRIMARY KEY, audio_id TEXT REFERENCES audio_metadata(id),
            "index" INTEGER, start_ms REAL, end_ms REAL, text TEXT, speaker TEXT,
            disfluencies TEXT, prosody TEXT
        );
        CREATE TABLE tokens (
            id TEXT PRIMARY KEY, utterance_id TEXT REFERENCES utterances(id),
            "index" INTEGER, text TEXT, start_ms REAL, end_ms REAL,
            confidence REAL, phoneme TEXT, edited INTEGER, realigned INTEGER
        );
        CREATE INDEX idx_utt_audio ON utterances(audio_id);
        CREATE INDEX idx_tok_utt ON tokens(utterance_id);
        """
    )

    audio = src.execute(
        'SELECT * FROM "AudioMetadata" WHERE id = ?', (audio_id,)
    ).fetchone()
    if audio is None:
        print(f"audio {audio_id} not found", file=sys.stderr)
        return 1

    dst.execute(
        "INSERT INTO audio_metadata VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            audio["id"], audio["fileName"], audio["format"], audio["durationSec"],
            audio["sampleRate"], audio["channels"], audio["language"], audio["device"],
            audio["model"], audio["corpusTitle"], audio["speakerName"],
            audio["speakerDialect"], audio["speakerGender"], audio["speakerAge"],
            audio["recordingDate"], audio["recordingPlace"], audio["genre"],
            audio["license"], audio["notes"], audio["createdAt"],
        ),
    )

    utts = src.execute(
        'SELECT * FROM "Utterance" WHERE "audioId" = ? ORDER BY "index"', (audio_id,)
    ).fetchall()
    for u in utts:
        dst.execute(
            "INSERT INTO utterances VALUES (?,?,?,?,?,?,?,?,?)",
            (
                u["id"], u["audioId"], u["index"], u["startMs"], u["endMs"],
                u["text"], u["speaker"],
                u["disfluencies"], u["prosody"],
            ),
        )
        for t in src.execute(
            'SELECT * FROM "Token" WHERE "utteranceId" = ? ORDER BY "index"', (u["id"],)
        ):
            dst.execute(
                "INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    t["id"], t["utteranceId"], t["index"], t["text"],
                    t["startMs"], t["endMs"], t["confidence"], t["phoneme"],
                    1 if t["edited"] else 0, 1 if t["realigned"] else 0,
                ),
            )

    dst.commit()
    dst.close()
    src.close()
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("usage: export_sqlite.py SRC_DB AUDIO_ID OUT_PATH", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
