#!/usr/bin/env node
// CorpusMind Voice - phone companion proxy.
//
// The desktop app keeps its API bound to 127.0.0.1 (nothing is exposed by
// default). When "Phone companion" is enabled in Settings, the Tauri shell
// spawns this script next to the standalone server. It:
//
//   1. listens on the LAN (default http :34568, and https :34569 when a
//      certificate was generated), so a phone can open the very same PWA;
//   2. gates EVERY request behind the pairing token created on the desktop
//      (accepted as ?token=... on the first visit - a cookie is then set -
//      or as the x-cm-token header / cm_token cookie afterwards);
//   3. relays requests to the local server unchanged (streaming both ways,
//      so 500 MB uploads and Range-based audio playback keep working) and
//      stamps them with x-cm-companion so the server can tell phone
//      sessions from the desktop webview.
//
// Deliberately dependency-free: it is bundled by esbuild into a single
// companion.cjs shipped as a Tauri resource (see scripts/build_companion.mjs).
import http from "node:http";
import https from "node:https";
import fs from "node:fs";

const TOKEN = process.env.CM_TOKEN || "";
if (!TOKEN) {
  console.error("[companion] CM_TOKEN is not set - refusing to start");
  process.exit(1);
}
const UPSTREAM = new URL(process.env.CM_UPSTREAM || "http://127.0.0.1:34567");
const PORT = Number(process.env.CM_PORT || 34568);
const TLS_PORT = Number(process.env.CM_TLS_PORT || 34569);
const CERT_FILE = process.env.CM_CERT || "";
const KEY_FILE = process.env.CM_KEY || "";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

function tokenOk(req, url) {
  const q = url.searchParams.get("token");
  if (q && q === TOKEN) return "query";
  const h = req.headers["x-cm-token"];
  if (h && h === TOKEN) return "header";
  const m = /(?:^|;\s*)cm_token=([^\s;]+)/.exec(String(req.headers.cookie || ""));
  if (m && decodeURIComponent(m[1]) === TOKEN) return "cookie";
  return null;
}

function deny(res) {
  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    "CorpusMind Voice companion: authorization required.\n" +
    "Open the pairing link shown in the desktop app (Settings > Phone companion)."
  );
}

async function handler(req, res) {
  let url;
  try {
    url = new URL(req.url, "http://local");
  } catch {
    return deny(res);
  }
  const via = tokenOk(req, url);
  if (!via) return deny(res);

  // never forward the pairing secret itself
  if (url.searchParams.has("token")) url.searchParams.delete("token");

  const headers = { ...req.headers };
  for (const k of HOP_BY_HOP) delete headers[k];
  headers.host = UPSTREAM.host;
  headers["x-cm-companion"] = "1";

  const transport = UPSTREAM.protocol === "https:" ? https : http;
  const preq = transport.request(
    {
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || (UPSTREAM.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
    },
    (pres) => {
      const out = {};
      for (const [k, v] of Object.entries(pres.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
      }
      if (via === "query") {
        // first visit: persist the pairing so subresources, media streaming
        // and later sessions authenticate transparently
        const pair = `cm_token=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
        out["set-cookie"] = pres.headers["set-cookie"]
          ? [pair, ...pres.headers["set-cookie"]]
          : [pair];
      }
      res.writeHead(pres.statusCode || 502, out);
      pres.pipe(res);
    }
  );
  preq.on("error", (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end(`CorpusMind Voice companion: upstream error (${e.message})`);
  });
  req.on("aborted", () => preq.destroy());
  req.pipe(preq);
}

// Large offline uploads must not be cut off by Node's default request
// timeout; the desktop pipeline can legitimately chew on 500 MB for a while.
const httpServer = http.createServer({ requestTimeout: 0 }, handler);
httpServer.on("error", (e) =>
  console.error(`[companion] http listen failed on :${PORT} - ${e.message}`)
);
httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`[companion] pairing proxy on http://0.0.0.0:${PORT} -> ${UPSTREAM.origin}`)
);

if (CERT_FILE && KEY_FILE) {
  try {
    const tlsOpts = {
      cert: fs.readFileSync(CERT_FILE),
      key: fs.readFileSync(KEY_FILE),
      requestTimeout: 0,
    };
    const tlsServer = https.createServer(tlsOpts, handler);
    tlsServer.on("error", (e) =>
      console.error(`[companion] https listen failed on :${TLS_PORT} - ${e.message}`)
    );
    tlsServer.listen(TLS_PORT, "0.0.0.0", () =>
      console.log(`[companion] secure pairing proxy on https://0.0.0.0:${TLS_PORT} -> ${UPSTREAM.origin}`)
    );
  } catch (e) {
    console.error(`[companion] certificate unreadable (${e.message}) - http only`);
  }
} else {
  console.log("[companion] no certificate configured - http only (phone recording needs https)");
}
