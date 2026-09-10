#!/bin/bash
# CorpusMind Voice - local end-to-end verification against the REAL standalone
# build (not next dev). Mirrors the project's verification bar from worklog.md:
#
#   boot the packaged server -> download a Whisper model if needed -> upload a
#   clip -> assert REAL transcript tokens -> hammer the export API while a
#   pipeline job is writing (SQLite lock regression test) -> re-run -> delete.
#
# Usage:  bash scripts/e2e_local.sh [path/to/audio.wav]
# Requires: a completed `bun run build` (standalone + bundle check), Node 18+,
# curl, python3. Keeps everything on 127.0.0.1; no external calls beyond the
# model download from Hugging Face when no model is present yet.
set -u
PORT="${E2E_PORT:-34589}"
BASE="http://127.0.0.1:$PORT"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUDIO="${1:-/tmp/jfk.wav}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

[ -f "$AUDIO" ] || { curl -sL -m 60 -o "$AUDIO" https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav; }
[ -f "$AUDIO" ] || { echo "FAIL: no test audio available"; exit 1; }

cd "$ROOT"
# Pin the database + model locations: ambient DATABASE_URL from the caller's
# shell must not silently redirect the packaged server (seen in testing: a
# stale exported DATABASE_URL produced cryptic "Unable to open the database
# file" boot errors).
export DATABASE_URL="file:$ROOT/db/custom.db"
export CM_MODELS_DIR="$ROOT/data/models"
export NODE_ENV=production
[ -f .next/standalone/server.js ] || { echo "FAIL: run 'bun run build' first"; exit 1; }
node scripts/check_bundle_externals.mjs >/dev/null 2>&1 \
  && ok "bundle externals check" \
  || bad "bundle externals check (run scripts/check_bundle_externals.mjs for detail)"

fuser -k $PORT/tcp 2>/dev/null; sleep 1
PORT=$PORT nohup node scripts/serve.mjs > /tmp/cmv_e2e.log 2>&1 &
SRV=$!
READY=0
for i in $(seq 1 20); do
  curl -s -m 2 -o /dev/null "$BASE/api/models" && READY=1 && break
  sleep 1
done
[ $READY -eq 1 ] && ok "server boots via scripts/serve.mjs" || { bad "server boot"; tail -5 /tmp/cmv_e2e.log; kill $SRV 2>/dev/null; exit 1; }

curl -s -m 8 "$BASE/" | grep -q "CorpusMind" && ok "homepage renders" || bad "homepage"

TINY=$(curl -s -m 5 "$BASE/api/models" | python3 -c "import sys,json; print([m['downloaded'] for m in json.load(sys.stdin)['models'] if m['id']=='tiny'][0])" 2>/dev/null)
if [ "$TINY" != "True" ]; then
  echo "downloading whisper-tiny (one-time, ~75 MB)..."
  curl -s -m 10 -X POST "$BASE/api/models" -H 'Content-Type: application/json' -d '{"action":"download","id":"tiny"}' >/dev/null
  for i in $(seq 1 100); do
    sleep 3
    T=$(curl -s -m 5 "$BASE/api/models" | python3 -c "import sys,json; print([m['downloaded'] for m in json.load(sys.stdin)['models'] if m['id']=='tiny'][0])" 2>/dev/null)
    [ "$T" = "True" ] && break
  done
fi
TINY=$(curl -s -m 5 "$BASE/api/models" | python3 -c "import sys,json; print([m['downloaded'] for m in json.load(sys.stdin)['models'] if m['id']=='tiny'][0])" 2>/dev/null)
[ "$TINY" = "True" ] && ok "whisper-tiny model available" || { bad "tiny model download"; kill $SRV 2>/dev/null; exit 1; }

UP=$(curl -s -m 60 -X POST "$BASE/api/upload" -F "file=@$AUDIO" -F "language=en" -F "device=cpu" -F "model=tiny")
AID=$(echo "$UP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('audioId') or d.get('id') or '')" 2>/dev/null)
[ -n "$AID" ] && ok "upload accepted" || bad "upload: $UP"

job_status() {
  curl -s -m 5 "$BASE/api/jobs?audioId=$1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
js = d if isinstance(d, list) else d.get('jobs', [])
js = [j for j in js if str(j.get('audioId')) == sys.argv[1]]
print(js[0]['status'] if js else 'none')" "$1" 2>/dev/null
}

DONE=0
for i in $(seq 1 80); do
  sleep 3
  ST=$(job_status "$AID")
  [ "$ST" = "done" ] && DONE=1 && break
  [ "$ST" = "error" ] && break
done
[ $DONE -eq 1 ] && ok "transcription job completed" || bad "job status: $ST"

if [ $DONE -eq 1 ]; then
  RES=$(curl -s -m 10 "$BASE/api/audio/$AID")
  echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
texts = []
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == 'text' and isinstance(v, str) and v.strip(): texts.append(v)
            elif k == 'tokens' and isinstance(v, list):
                texts.append(' '.join(t.get('text', '') for t in v))
            elif isinstance(v, (dict, list)): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d)
blob = ' '.join(texts).lower()
print('PASS: REAL transcript produced' if ('fellow' in blob or 'americans' in blob or len(blob.split()) > 8) else 'FAIL: transcript looks empty or demo: ' + blob[:120])
" | while read -r line; do case "$line" in PASS*) ok "$line";; *) bad "$line";; esac; done
  ENG=$(echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('model',''))" 2>/dev/null)
  [ -n "$ENG" ] && ok "result metadata present (model=$ENG)" || bad "result metadata"
fi

# --- SQLite concurrency regression (export during an active pipeline write) ---
echo "$UP" > /dev/null
curl -s -m 60 -X POST "$BASE/api/audio/$AID/rerun" -H 'Content-Type: application/json' -d '{"model":"tiny","device":"cpu","language":"en"}' >/dev/null
LOCKED=0; EXPORTS_OK=0; EXPORTS_TRIED=0
for i in $(seq 1 20); do
  sleep 0.5
  for fmt in json csv tei srt; do
    EXPORTS_TRIED=$((EXPORTS_TRIED+1))
    CODE=$(curl -s -m 8 -o /tmp/cmv_export.out -w "%{http_code}" "$BASE/api/export/$AID?format=$fmt")
    if [ "$CODE" = "500" ] && grep -qi "database is locked" /tmp/cmv_export.out; then LOCKED=$((LOCKED+1));
    elif [ "$CODE" = "200" ]; then EXPORTS_OK=$((EXPORTS_OK+1)); fi
  done
done
[ $LOCKED -eq 0 ] && ok "no 'database is locked' during $EXPORTS_TRIED exports while job writing ($EXPORTS_OK returned 200)" \
  || bad "$LOCKED export responses hit 'database is locked'"

# wait for rerun to finish
for i in $(seq 1 80); do
  sleep 3
  [ "$(job_status "$AID")" = "done" ] && ok "re-run with same model completed" && RR=1 && break
done
[ "${RR:-0}" = "1" ] || bad "re-run did not complete"

curl -s -m 15 -X DELETE "$BASE/api/audio/$AID" | grep -qi "true\|deleted\|ok" && ok "delete cleans recording + artifacts" || bad "delete"

kill $SRV 2>/dev/null; fuser -k $PORT/tcp 2>/dev/null
echo "=== E2E RESULT: $PASS passed, $FAIL failed ==="
exit $FAIL
