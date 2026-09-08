"use client";

// Corpus view — cross-session aggregates over everything stored in this app:
// session inventory with counts, corpus-wide frequency with DP dispersion
// across sessions, and a cross-session KWIC concordance with audio playback.
// All computed server-side from the local database; nothing leaves the device.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useAudioPlay } from "@/hooks/use-audio-play";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";
import {
  Loader2, FileDown, Search, Sigma, Database, Play, Square, FolderOpen,
} from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";

// ---------------------------------------------------------------- csv utils
function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function saveCsv(name: string, headers: string[], rows: (string | number)[][]) {
  const text = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
  const blob = new Blob(["\ufeff" + text], { type: "text/csv; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- data types
interface SessionRow {
  id: string; fileName: string; language: string; durationSec: number;
  corpusTitle: string | null; speakerName: string | null;
  createdAt: string; utterances: number; tokens: number;
}

interface CorpusData {
  sessions: SessionRow[];
  totals: { sessions: number; tokens: number; types: number; durationSec: number };
  frequency: { items: { word: string; count: number; perK: number; dp: number; stop: boolean }[] };
}

interface KwicRow {
  audioId: string; fileName: string; language: string;
  utt: number; startMs: number; endMs: number;
  left: string[]; node: string; right: string[];
}

// ---------------------------------------------------------------- component
export function Corpus({
  lang, d, onSelectSession,
}: {
  lang: Lang;
  d: Dict;
  onSelectSession: (audioId: string) => void;
}) {
  const [data, setData] = useState<CorpusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hideStops, setHideStops] = useState(true);
  const [topN, setTopN] = useState(50);
  const player = useAudioPlay(null);
  const ar = lang === "ar";
  const t = d.corpus;

  // KWIC state
  const [query, setQuery] = useState("");
  const [win, setWin] = useState(5);
  const [normMode, setNormMode] = useState(true);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [kwicRows, setKwicRows] = useState<KwicRow[]>([]);
  const [kwicTotal, setKwicTotal] = useState(0);
  const [kwicCapped, setKwicCapped] = useState(false);
  const [kwicBad, setKwicBad] = useState(false);
  const [kwicBusy, setKwicBusy] = useState(false);
  const [kwicRan, setKwicRan] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/corpus");
      if (r.ok) setData((await r.json()) as CorpusData);
    } catch { /* offline */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const freqItems = useMemo(
    () =>
      data
        ? (hideStops ? data.frequency.items.filter((f) => !f.stop) : data.frequency.items).slice(0, topN)
        : [],
    [data, hideStops, topN]
  );

  const runKwic = async () => {
    if (!query.trim()) return;
    setKwicBusy(true);
    try {
      const p = new URLSearchParams({
        q: query, win: String(win),
        norm: normMode ? "1" : "0",
        whole: wholeWord ? "1" : "0",
        regex: regexMode ? "1" : "0",
        limit: "300",
      });
      const r = await fetch(`/api/corpus/kwic?${p.toString()}`);
      if (r.ok) {
        const data2 = (await r.json()) as { rows: KwicRow[]; total: number; capped: boolean; badRegex: boolean };
        setKwicRows(data2.rows);
        setKwicTotal(data2.total);
        setKwicCapped(data2.capped);
        setKwicBad(data2.badRegex);
        setKwicRan(true);
      }
    } catch { /* offline */ } finally {
      setKwicBusy(false);
    }
  };

  const saveFreq = () => {
    if (!data) return;
    saveCsv("corpus.frequency.csv", ["word", "count", "per_1000", "dispersion_DP", "function_word"],
      freqItems.map((f) => [f.word, f.count, f.perK, f.dp, f.stop ? 1 : 0]));
  };

  const saveSessions = () => {
    if (!data) return;
    saveCsv("corpus.sessions.csv", ["file_name", "language", "duration_sec", "utterances", "tokens", "created_at"],
      data.sessions.map((s) => [s.fileName, s.language, s.durationSec, s.utterances, s.tokens, s.createdAt]));
  };

  const saveKwic = () =>
    saveCsv("corpus.kwic.csv", ["file_name", "left_context", "node", "right_context", "utterance", "start_ms", "end_ms"],
      kwicRows.map((m) => [m.fileName, m.left.join(" "), m.node, m.right.join(" "), m.utt, m.startMs, m.endMs]));

  if (loading && !data)
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );

  if (!data)
    return (
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
          <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.noData}</p>
        </CardContent>
      </Card>
    );

  const totals = data.totals;

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums" dir="ltr">{value}</p>
    </div>
  );

  const Th = ({ children }: { children: React.ReactNode }) => (
    <th className="border-b border-border/60 px-3 py-2 text-start text-xs font-semibold text-muted-foreground">{children}</th>
  );
  const Td = ({ children, num }: { children: React.ReactNode; num?: boolean }) => (
    <td className="border-b border-border/40 px-3 py-1.5 text-sm" dir={num ? "ltr" : undefined}>
      {children}
    </td>
  );

  return (
    <div className="grid gap-4">
      <Card className="border-border/70">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
            <Badge variant="secondary" dir="ltr">{totals.sessions} {t.sessions}</Badge>
            <Badge variant="outline" dir="ltr">{totals.tokens.toLocaleString()} tok</Badge>
          </div>
          <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label={t.statSessions} value={totals.sessions} />
            <Stat label={t.statTokens} value={totals.tokens.toLocaleString()} />
            <Stat label={t.statTypes} value={totals.types.toLocaleString()} />
            <Stat label={t.statDuration} value={`${(totals.durationSec / 60).toFixed(1)} min`} />
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} className="w-fit gap-1.5">
            <Loader2 className={`h-3.5 w-3.5 ${loading ? "animate-spin" : "hidden"}`} />
            <FolderOpen className={`h-3.5 w-3.5 ${loading ? "hidden" : ""}`} />
            <span className={ar ? "font-arabic" : ""}>{t.refresh}</span>
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="sessions" dir={ar ? ("rtl" as const) : ("ltr" as const)}>
        <TabsList className="mb-4 grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-secondary/40 p-1">
          {([
            ["sessions", t.tabSessions, Database],
            ["freq", t.tabFreq, Sigma],
            ["kwic", t.tabKwic, Search],
          ] as const).map(([id, label, Icon]) => (
            <TabsTrigger key={id} value={id}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium sm:h-10 ${ar ? "font-arabic" : ""}`}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ---------------- sessions ---------------- */}
        <TabsContent value="sessions" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-3 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.sessionsHint}</p>
                <Button size="sm" variant="outline" onClick={saveSessions} className="ms-auto gap-1.5">
                  <FileDown className="h-3.5 w-3.5" />{t.saveCsv}
                </Button>
              </div>
              {data.sessions.length === 0 ? (
                <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.noData}</p>
              ) : (
                <ScrollArea className="max-h-96 cm-scroll">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th>{t.colFile}</Th><Th>{t.colLang}</Th><Th>{t.colDuration}</Th>
                        <Th>{t.colUtterances}</Th><Th>{t.colTokens}</Th><Th> </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sessions.map((s) => (
                        <tr key={s.id}>
                          <Td>
                            <span dir="auto" className="font-medium">{s.corpusTitle || s.fileName}</span>
                            <span dir="ltr" className="ms-2 text-xs text-muted-foreground">{s.fileName}</span>
                          </Td>
                          <Td num>{s.language}</Td>
                          <Td num>{s.durationSec ? `${(s.durationSec / 60).toFixed(1)} min` : "-"}</Td>
                          <Td num>{s.utterances}</Td>
                          <Td num>{s.tokens.toLocaleString()}</Td>
                          <Td>
                            <Button size="sm" variant="ghost" className={`h-7 px-2 text-xs ${ar ? "font-arabic" : ""}`}
                              onClick={() => {
                                onSelectSession(s.id);
                                toast({ title: t.sessionOpened });
                              }}>
                              {t.open}
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- frequency ---------------- */}
        <TabsContent value="freq" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-4 pt-4">
              <div className="flex flex-wrap items-center gap-4">
                <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                  <Switch checked={hideStops} onCheckedChange={setHideStops} />
                  {t.stopToggle}
                </label>
                <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                  {t.range}
                  <select value={topN} onChange={(e) => setTopN(+e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                    {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <Button size="sm" variant="outline" onClick={saveFreq} className="ms-auto gap-1.5">
                  <FileDown className="h-3.5 w-3.5" />{t.saveCsv}
                </Button>
              </div>
              <div className="h-72" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={freqItems.slice(0, 30)} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="word" interval={0} angle={-45} textAnchor="end" height={70} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ScrollArea className="max-h-80 cm-scroll">
                <table className="w-full">
                  <thead><tr><Th>{t.colWord}</Th><Th>{t.colCount}</Th><Th>{t.colPerK}</Th><Th>{t.colDispersion}</Th></tr></thead>
                  <tbody>
                    {freqItems.map((f) => (
                      <tr key={f.word}>
                        <Td><span dir="auto" className="font-medium">{f.word}</span></Td>
                        <Td num>{f.count}</Td>
                        <Td num>{f.perK}</Td>
                        <Td num>{f.dp}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
              <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.dpNote}</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- corpus KWIC ---------------- */}
        <TabsContent value="kwic" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-3 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-56 flex-1">
                  <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input dir="auto" value={query} onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void runKwic()}
                    placeholder={t.kwicSearch} className="ps-8" />
                </div>
                <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                  {t.kwicWindow}
                  <input type="number" min={1} max={15} value={win}
                    onChange={(e) => setWin(Math.max(1, Math.min(15, +e.target.value || 5)))}
                    className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums" dir="ltr" />
                </label>
                <Button size="sm" onClick={() => void runKwic()} disabled={kwicBusy || !query.trim()} className="gap-1.5">
                  {kwicBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  <span className={ar ? "font-arabic" : ""}>{t.search}</span>
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-sm" title={t.kwicNorm}>
                  <Switch checked={normMode} onCheckedChange={setNormMode} />
                  <span className={ar ? "font-arabic" : ""}>{t.kwicNormShort}</span>
                </label>
                <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                  <Switch checked={wholeWord} onCheckedChange={setWholeWord} />
                  {t.kwicWhole}
                </label>
                <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                  <Switch checked={regexMode} onCheckedChange={setRegexMode} />
                  {t.kwicRegex}
                </label>
              </div>
              {kwicBad ? (
                <p className="text-sm text-red-500" dir="auto">{t.kwicBadRegex}</p>
              ) : !kwicRan ? (
                <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.kwicHint}</p>
              ) : kwicRows.length === 0 ? (
                <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.kwicEmpty}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {kwicTotal.toLocaleString()} {t.kwicMatches}
                    {kwicCapped ? ` · ${t.kwicCap}` : ""}
                  </p>
                  <ScrollArea className="max-h-96 cm-scroll">
                    <table className="w-full">
                      <thead>
                        <tr><Th>{t.colFile}</Th><Th>{t.kwicLeft}</Th><Th>{t.kwicNode}</Th><Th>{t.kwicRight}</Th><Th>{t.kwicAt}</Th><Th> </Th></tr>
                      </thead>
                      <tbody>
                        {kwicRows.map((m, i) => (
                          <tr key={`${m.audioId}-${i}`}>
                            <Td><span dir="auto" className="text-xs text-muted-foreground">{m.fileName}</span></Td>
                            <Td><span dir="auto" className="text-muted-foreground">{m.left.join(" ")}</span></Td>
                            <Td><span dir="auto" className="font-bold text-cyan-500 dark:text-cyan-300">{m.node}</span></Td>
                            <Td><span dir="auto" className="text-muted-foreground">{m.right.join(" ")}</span></Td>
                            <Td num>u{m.utt + 1} · {(m.startMs / 1000).toFixed(1)}s</Td>
                            <Td>
                              <button
                                title={t.kwicPlay}
                                aria-label={t.kwicPlay}
                                onClick={() =>
                                  player.playing === `ckwic-${i}`
                                    ? player.stop()
                                    : player.play(Math.max(0, m.startMs - 800), m.endMs, `ckwic-${i}`, m.audioId)
                                }
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-cyan-500 hover:bg-muted dark:text-cyan-300"
                              >
                                {player.playing === `ckwic-${i}` ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              </button>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                  <Button size="sm" variant="outline" onClick={saveKwic} className="w-fit gap-1.5">
                    <FileDown className="h-3.5 w-3.5" />{t.saveCsv}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
