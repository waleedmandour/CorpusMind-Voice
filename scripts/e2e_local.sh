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

# fuser is absent on some hosts (psmisc optional); fall back to lsof/ss so a
# kill that silently no-ops can never leave a stale server squatting on the
# test port (that failure mode poisoned every later phase silently).
kill_port() {
  local port="$1" pids=""
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null
    return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti tcp:"$port" 2>/dev/null)
  elif command -v ss >/dev/null 2>&1; then
    pids=$(ss -tlnp 2>/dev/null | awk -v Suffix=":$port" 'substr($4, length($4)-length(Suffix)+1) == Suffix {print $NF}' \
            | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  fi
  if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null; fi
  return 0
}

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

kill_port $PORT; sleep 1
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
  TRANSCRIPT_CHECK=$(echo "$RES" | python3 -c "
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
print('PASS' if ('fellow' in blob or 'americans' in blob or len(blob.split()) > 8) else 'FAIL: transcript looks empty or demo: ' + blob[:120])
" 2>&1)
  case "$TRANSCRIPT_CHECK" in
    PASS) ok "REAL transcript produced";;
    *) bad "$TRANSCRIPT_CHECK";;
  esac
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

# --- v1.3 phase 2: read-only install dir simulation -------------------------
# The packaged app used to write audio into <cwd>/data (the INSTALL dir,
# read-only under MSI per-machine installs) which broke upload and recording.
# A second server boots with the repo's data dirs chmod 555 (standing in for
# the install dir) and CM_DATA_DIR pointed at a writable temp folder; upload
# must succeed and land in CM_DATA_DIR/audio.
RO_TMP="$(mktemp -d /tmp/cmv_ro.XXXXXX)"
chmod 555 "$ROOT/data/audio" 2>/dev/null; chmod 555 "$ROOT/data/output" 2>/dev/null; chmod 555 "$ROOT/data" 2>/dev/null
RO_SKIPPED=0
if [ "$(id -u)" = "0" ]; then
  echo "note: running as root - read-only simulation is void, skipping phase 2 upload assertion"
  RO_SKIPPED=1
fi
PORT2=34591
cp "$ROOT/db/custom.db" "$RO_TMP/custom.db"
kill_port $PORT2; sleep 1
PORT=$PORT2 CM_DATA_DIR="$RO_TMP/cmdata" CM_MODELS_DIR="$ROOT/data/models" \
  DATABASE_URL="file:$RO_TMP/custom.db" NODE_ENV=production \
  nohup node scripts/serve.mjs > /tmp/cmv_e2e_ro.log 2>&1 &
READY2=0
for i in $(seq 1 20); do
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT2/api/models" && READY2=1 && break
  sleep 1
done
[ $READY2 -eq 1 ] && ok "phase-2 server boots with CM_DATA_DIR override" || { bad "phase-2 boot"; tail -5 /tmp/cmv_e2e_ro.log; }
UP2=""
if [ $READY2 -eq 1 ] && [ $RO_SKIPPED -eq 0 ]; then
  UP2=$(curl -s -m 60 -X POST "http://127.0.0.1:$PORT2/api/upload" -F "file=@$AUDIO" -F "language=en" -F "device=cpu" -F "model=tiny")
  echo "$UP2" | grep -q "audioId" && ok "upload works with read-only install dir (CM_DATA_DIR storage)" || bad "phase-2 upload: $UP2"
  [ -n "$(find "$RO_TMP/cmdata/audio" -type f 2>/dev/null | head -1)" ] \
    && ok "audio file stored under CM_DATA_DIR" \
    || bad "audio file not found in CM_DATA_DIR/audio"
  if [ "${CMV_DEBUG:-0}" = "1" ]; then
    echo "debug: RO_TMP=$RO_TMP"
    ls -la "$RO_TMP" "$RO_TMP/cmdata" "$RO_TMP/cmdata/audio" 2>&1 | head -20
    ls "$ROOT/data" 2>&1
  fi
  RO_AID=$(echo "$UP2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('audioId',''))" 2>/dev/null)
  [ -n "$RO_AID" ] && curl -s -m 15 -X DELETE "http://127.0.0.1:$PORT2/api/audio/$RO_AID" | grep -qi "deleted" \
    && ok "phase-2 delete" || { [ -n "$RO_AID" ] && bad "phase-2 delete"; }
fi
chmod 755 "$ROOT/data" 2>/dev/null; chmod 755 "$ROOT/data/audio" 2>/dev/null; chmod 755 "$ROOT/data/output" 2>/dev/null
kill_port $PORT2
rm -rf "$RO_TMP"

# --- v1.3 phase 3: phone companion proxy smoke -------------------------------
# The desktop shell spawns the server with CM_TOKEN + CM_DESKTOP when the
# companion is enabled (main.rs). Restart the e2e server that way, then
# check the direct (webview) and proxied (phone) sides of /api/config, the
# token gate, cookie pairing and a streaming upload through the proxy.
# (https listener is exercised manually - no cert here.)
COMP_TOKEN="e2e-token-$(date +%s)"
kill $SRV 2>/dev/null; kill_port $PORT; sleep 1
PORT=$PORT CM_TOKEN="$COMP_TOKEN" CM_DESKTOP=1 CM_MODELS_DIR="$ROOT/data/models" \
  DATABASE_URL="file:$ROOT/db/custom.db" NODE_ENV=production \
  nohup node scripts/serve.mjs > /tmp/cmv_e2e_p3.log 2>&1 &
SRV=$!
READY3=0
for i in $(seq 1 20); do
  curl -s -m 2 -o /dev/null "$BASE/api/models" && READY3=1 && break
  sleep 1
done
[ $READY3 -eq 1 ] && ok "server reboots with companion env (CM_TOKEN + CM_DESKTOP)" || { bad "phase-3 boot"; tail -5 /tmp/cmv_e2e_p3.log; }
if [ $READY3 -eq 1 ]; then
  DIRECT=$(curl -s -m 5 "$BASE/api/config")
  DCHECK=$(echo "$DIRECT" | python3 -c "
import json, sys
try:
    cfg = json.load(sys.stdin)
    assert cfg['desktop'] is True, 'webview session must look desktop'
    assert cfg['companion']['active'] is True, 'companion must be active server-side'
    print('PASS')
except Exception as e:
    print('FAIL: ' + str(e))
" 2>&1)
  [ "$DCHECK" = "PASS" ] && ok "direct /api/config: desktop=true, companion.active=true" || bad "direct config: $DCHECK"
fi
COMP_PORT=34592
COMP_LOG=/tmp/cmv_e2e_comp.log
CM_TOKEN="$COMP_TOKEN" CM_PORT=$COMP_PORT CM_TLS_PORT=34593 \
  CM_UPSTREAM="$BASE" nohup node .next/standalone/companion.cjs > "$COMP_LOG" 2>&1 &
COMP_PID=$!
COMPREADY=0
for i in $(seq 1 10); do
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$COMP_PORT/" && COMPREADY=1 && break
  sleep 1
done
if [ $COMPREADY -eq 1 ]; then
  CODE_NOAUTH=$(curl -s -m 5 -o /tmp/cmv_comp1.out -w "%{http_code}" "http://127.0.0.1:$COMP_PORT/api/models")
  [ "$CODE_NOAUTH" = "401" ] && ok "companion rejects requests without the pairing token" || bad "companion no-token code=$CODE_NOAUTH"
  curl -s -m 5 -D /tmp/cmv_comp_hdrs -o /dev/null "http://127.0.0.1:$COMP_PORT/?token=$COMP_TOKEN"
  grep -qi "set-cookie: cm_token=" /tmp/cmv_comp_hdrs && ok "pairing link sets the cm_token cookie" || bad "no cookie from pairing link"
  curl -s -m 5 -o /dev/null -w "%{http_code}" --cookie "cm_token=$COMP_TOKEN" "http://127.0.0.1:$COMP_PORT/api/models" > /tmp/cmv_comp_code
  [ "$(cat /tmp/cmv_comp_code)" = "200" ] && ok "cookie-authenticated API access works" || bad "cookie auth code=$(cat /tmp/cmv_comp_code)"
  curl -s -m 5 --cookie "cm_token=$COMP_TOKEN" "http://127.0.0.1:$COMP_PORT/api/config" > /tmp/cmv_comp_cfg
  CFGCHECK=$(python3 -c "
import json
try:
    cfg = json.load(open('/tmp/cmv_comp_cfg'))
    assert cfg['desktop'] is False, 'phone session must not look desktop'
    assert cfg['companion']['active'] is True, 'companion flag must be active'
    print('PASS')
except Exception as e:
    print('FAIL: ' + str(e))
" 2>&1)
  [ "$CFGCHECK" = "PASS" ] && ok "/api/config via proxy: desktop=false, companion.active=true" || bad "config via proxy: $CFGCHECK"
  CPU=$(curl -s -m 60 --cookie "cm_token=$COMP_TOKEN" -X POST "http://127.0.0.1:$COMP_PORT/api/upload" \
    -F "file=@$AUDIO" -F "language=en" -F "device=cpu" -F "model=tiny")
  echo "$CPU" | grep -q "audioId" && ok "streaming upload through the proxy works" || bad "proxy upload: $CPU"
  C_AID=$(echo "$CPU" | python3 -c "import sys,json; print(json.load(sys.stdin).get('audioId',''))" 2>/dev/null)
  [ -n "$C_AID" ] && curl -s -m 15 --cookie "cm_token=$COMP_TOKEN" -X DELETE "http://127.0.0.1:$COMP_PORT/api/audio/$C_AID" | grep -qi "deleted" && ok "delete through the proxy works"
  kill $COMP_PID 2>/dev/null
else
  bad "companion proxy did not start"
  tail -5 "$COMP_LOG"
fi

kill $SRV 2>/dev/null; kill_port $PORT
echo "=== E2E RESULT: $PASS passed, $FAIL failed ==="
exit $FAIL
