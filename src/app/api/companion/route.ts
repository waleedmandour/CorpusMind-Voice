import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import QRCode from "qrcode";
import selfsigned from "selfsigned";
import {
  COMPANION_CERT,
  COMPANION_DIR,
  COMPANION_JSON,
  COMPANION_KEY,
  ensureDirSync,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phone companion control: Settings (desktop) enables/disables LAN access
// for the PWA on the user's phone. Enabling generates a pairing token and a
// self-signed certificate (https is what makes phone-side microphone
// recording possible - browsers only expose getUserMedia on secure pages),
// then writes companion.json which the Tauri shell reads at next launch to
// spawn the token-gated proxy (scripts/companion.mjs).

interface CompanionConfig {
  enabled: boolean;
  token: string;
  port: number;
  tlsPort: number;
  cert?: string;
  key?: string;
  certIp?: string;
}

const DEFAULT_PORT = 34568;
const DEFAULT_TLS_PORT = 34569;

function readConfig(): CompanionConfig | null {
  try {
    const raw = JSON.parse(readFileSync(COMPANION_JSON, "utf8")) as Partial<CompanionConfig>;
    if (typeof raw.token !== "string" || !raw.token) return null;
    return {
      enabled: !!raw.enabled,
      token: raw.token,
      port: raw.port || DEFAULT_PORT,
      tlsPort: raw.tlsPort || DEFAULT_TLS_PORT,
      cert: raw.cert,
      key: raw.key,
      certIp: raw.certIp,
    };
  } catch {
    return null;
  }
}

function writeConfig(cfg: CompanionConfig): void {
  ensureDirSync(path.dirname(COMPANION_JSON));
  writeFileSync(COMPANION_JSON, JSON.stringify(cfg, null, 2));
}

/** First private IPv4 address of this machine (what the phone will dial). */
function lanIp(): string | null {
  const tables = os.networkInterfaces();
  const isPrivate = (ip: string) =>
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  let any: string | null = null;
  for (const list of Object.values(tables)) {
    for (const ni of list ?? []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      if (isPrivate(ni.address)) return ni.address;
      any ??= ni.address;
    }
  }
  return any;
}

async function ensureCert(cfg: CompanionConfig, ip: string | null): Promise<void> {
  if (!ensureDirSync(COMPANION_DIR)) return;
  const ipChanged = cfg.certIp !== (ip ?? "");
  if (existsSync(COMPANION_CERT) && existsSync(COMPANION_KEY) && !ipChanged) return;
  const altNames: { type: number; ip?: string; value?: string }[] = [
    { type: 2, value: "localhost" },
  ];
  if (ip) altNames.push({ type: 7, ip });
  // selfsigned v5 resolves to the PEM bundle when no callback is given
  const pems = await selfsigned.generate(
    [{ name: "commonName", value: "CorpusMind Voice" }],
    {
      keySize: 2048,
      days: 3650,
      algorithm: "sha256",
      extensions: [{ name: "subjectAltName", altNames }],
    }
  );
  writeFileSync(COMPANION_KEY, pems.private);
  writeFileSync(COMPANION_CERT, pems.cert);
  cfg.cert = COMPANION_CERT;
  cfg.key = COMPANION_KEY;
  cfg.certIp = ip ?? "";
}

async function status(cfg: CompanionConfig | null): Promise<Record<string, unknown>> {
  const active = !!process.env.CM_TOKEN;
  if (!cfg || !cfg.enabled) return { enabled: false, active };
  const ip = lanIp();
  const httpUrl = ip ? `http://${ip}:${cfg.port}/?token=${cfg.token}` : null;
  const tlsUp = cfg.cert && cfg.key && existsSync(cfg.cert) && existsSync(cfg.key);
  const httpsUrl = ip && tlsUp ? `https://${ip}:${cfg.tlsPort}/?token=${cfg.token}` : null;
  const qr = httpUrl
    ? await QRCode.toDataURL(httpUrl, { margin: 1, scale: 6 })
    : null;
  return {
    enabled: true,
    active,
    restartRequired: enabledButNotSpawned(cfg),
    url: httpUrl,
    httpsUrl,
    qr,
    port: cfg.port,
    tlsPort: cfg.tlsPort,
    lanIp: ip,
  };
}

// The proxy only runs when the shell spawned it with CM_TOKEN. A dev server
// or plain `npm start` reports enabled-but-inactive so the UI can ask for a
// restart (or document the env knobs).
function enabledButNotSpawned(cfg: CompanionConfig): boolean {
  return !activeMatches(cfg);
}

function activeMatches(cfg: CompanionConfig): boolean {
  return process.env.CM_TOKEN === cfg.token;
}

export async function GET() {
  return NextResponse.json(await status(readConfig()));
}

export async function POST(req: NextRequest) {
  let body: { enabled?: boolean } = {};
  try {
    body = (await req.json()) as { enabled?: boolean };
  } catch {
    /* treated as { } */
  }
  const enable = !!body.enabled;

  if (!enable) {
    const cfg = readConfig();
    if (cfg) {
      cfg.enabled = false;
      writeConfig(cfg);
    }
    return NextResponse.json({ enabled: false, active: false });
  }

  const cfg: CompanionConfig =
    readConfig() ??
    {
      enabled: false,
      token: crypto.randomBytes(24).toString("hex"),
      port: DEFAULT_PORT,
      tlsPort: DEFAULT_TLS_PORT,
    };
  cfg.enabled = true;
  await ensureCert(cfg, lanIp());
  writeConfig(cfg);
  return NextResponse.json(await status(cfg));
}
