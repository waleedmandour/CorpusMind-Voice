"use client";

// Linguistic Analysis — academic corpus analysis of the current transcript.
// Eight modules: Overview · Frequency (w/ DP dispersion) · KWIC concordance ·
// Keywords (log-likelihood G² + LogRatio) · Collocations & N-grams ·
// Lexical diversity (TTR/MATTR/MTLD) · Readability (Flesch/FK/LIX) ·
// Speech & Prosody. Every table can be saved to the device as CSV, and the
// full report as JSON — all computed locally.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { SaveRow } from "@/components/save-row";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, LineChart, Line,
} from "recharts";
import {
  Loader2, Save, FileDown, Search, Sigma, ScanText, Network, BookOpen,
  Activity, Gauge, Info, Play, Square,
} from "lucide-react";
import type { AnalysisReport } from "@/lib/types";
import { normalize } from "@/lib/analysis";
import { useAudioPlay } from "@/hooks/use-audio-play";
import type { Dict, Lang } from "@/lib/i18n";

// ---------------------------------------------------------------- csv utils
function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadText(name: string, text: string, mime = "text/csv; charset=utf-8") {
  const blob = new Blob(["\ufeff" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function saveCsv(name: string, headers: string[], rows: (string | number)[][]) {
  downloadText(name, [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n"));
}

// ---------------------------------------------------------------- component
export function Analysis({ lang, d, audioId }: { lang: Lang; d: Dict; audioId: string | null }) {
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [hideStops, setHideStops] = useState(false);
  const [topN, setTopN] = useState(50);
  const [query, setQuery] = useState("");
  const [win, setWin] = useState(5);
  const [caseSensitive, setCaseSensitive] = useState(false);
  // retrieval modes: normalized matching (Arabic-aware) / whole word / regex
  const [normMode, setNormMode] = useState(true);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const player = useAudioPlay(audioId);
  // node-word collocation explorer
  const [node, setNode] = useState("");
  const [collSpan, setCollSpan] = useState(3);
  const [collDir, setCollDir] = useState<"both" | "left" | "right">("both");
  const [collMin, setCollMin] = useState(2);
  const [collSort, setCollSort] = useState<"logdice" | "mi" | "tscore" | "count">("logdice");
  const ar = lang === "ar";
  const t = d.analysis;

  const base = useMemo(
    () => (report ? report.meta.fileName.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_") || "corpus" : "corpus"),
    [report]
  );

  const load = useCallback(async () => {
    if (!audioId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/analysis/${audioId}`);
      if (r.ok) setReport((await r.json()) as AnalysisReport);
    } catch { /* offline */ } finally {
      setLoading(false);
    }
  }, [audioId]);

  useEffect(() => {
    setReport(null);
    void load();
  }, [load]);

  const saveReport = () => {
    if (!report) return;
    downloadText(`${base}.analysis.json`, JSON.stringify(report, null, 2), "application/json; charset=utf-8");
    toast({ title: t.copiedNote });
  };

  if (!audioId || (!report && !loading)) {
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
  }

  if (loading || !report)
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );

  // ---------------- data prep ----------------
  const freqItems = (hideStops ? report.frequency.items.filter((f) => !f.stop) : report.frequency.items).slice(0, topN);
  const kwicResult = (() => {
    const rows: { left: string[]; node: string; right: string[]; utt: number; startMs: number; endMs: number }[] = [];
    if (!query.trim()) return { rows, total: 0, capped: false, badRegex: false };
    let re: RegExp | null = null;
    if (regexMode) {
      try {
        re = new RegExp(query, caseSensitive ? "" : "i");
      } catch {
        return { rows, total: 0, capped: false, badRegex: true };
      }
    }
    const qNorm = normalize(query);
    const toks = report.tokens;
    let total = 0;
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      let hit = false;
      if (regexMode && re) {
        hit = re.test(tok.raw);
      } else if (normMode) {
        const hay = tok.text; // already normalized by the engine
        hit = wholeWord ? hay === qNorm : qNorm.length > 0 && hay.includes(qNorm);
      } else {
        const hay = caseSensitive ? tok.raw : tok.raw.toLowerCase();
        const qRaw = caseSensitive ? query : query.toLowerCase();
        const qN = normalize(qRaw);
        hit = wholeWord ? (qN && normalize(tok.raw) === qN) || (qRaw.length > 0 && hay === qRaw) : hay.includes(qRaw);
      }
      if (!hit) continue;
      total++;
      if (rows.length < 200) {
        rows.push({
          left: toks.slice(Math.max(0, i - win), i).map((x) => x.raw),
          node: tok.raw,
          right: toks.slice(i + 1, i + 1 + win).map((x) => x.raw),
          utt: tok.utt,
          startMs: tok.startMs,
          endMs: tok.endMs,
        });
      }
    }
    return { rows, total, capped: total > rows.length, badRegex: false };
  })();

  // ---------------- node-word collocates (windowed) ----------------
  const collocates = (() => {
    const q = normalize(node);
    if (!q || q.length === 0) return [];
    const toks = report.tokens;
    const N = toks.length;
    const freq = new Map<string, number>();
    for (const tk of toks) freq.set(tk.text, (freq.get(tk.text) ?? 0) + 1);
    const fNode = freq.get(q);
    if (!fNode) return [];
    const co = new Map<string, number>();
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].text !== q) continue;
      const u = toks[i].utt;
      for (let j = Math.max(0, i - collSpan); j <= Math.min(toks.length - 1, i + collSpan); j++) {
        if (j === i || toks[j].utt !== u) continue;
        if (collDir === "left" && j > i) continue;
        if (collDir === "right" && j < i) continue;
        const c = toks[j].text;
        co.set(c, (co.get(c) ?? 0) + 1);
      }
    }
    const out = [...co.entries()]
      .filter(([, c]) => c >= Math.max(1, collMin))
      .map(([word, c]) => {
        const fc = freq.get(word) ?? 1;
        const mi = Math.log2((c * N) / (fNode * fc));
        const expected = (fNode * fc) / Math.max(N, 1);
        const tscore = (c - expected) / Math.sqrt(c);
        const logdice = (2 * c) / (fNode + fc);
        return { word, count: c, nodeFreq: fNode, mi: +mi.toFixed(2), tscore: +tscore.toFixed(2), logdice: +logdice.toFixed(3) };
      });
    out.sort((x, y) => (y[collSort] as number) - (x[collSort] as number));
    return out.slice(0, 100);
  })();

  // ---------------- Zipf rank-frequency data ----------------
  const zipfData = report
    ? report.frequency.items.slice(0, 200).map((f, i) => ({ rank: i + 1, count: f.count, word: f.word }))
    : [];

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

  const saveFreq = () =>
    saveCsv(`${base}.frequency.csv`, ["word", "count", "per_1000", "dispersion_DP", "function_word"],
      (hideStops ? report.frequency.items.filter((f) => !f.stop) : report.frequency.items).map((f) => [f.word, f.count, f.perK, f.dp, f.stop ? 1 : 0]));
  const saveKwic = () =>
    saveCsv(`${base}.kwic.csv`, ["left_context", "node", "right_context", "utterance", "start_ms", "end_ms"],
      kwicResult.rows.map((m) => [m.left.join(" "), m.node, m.right.join(" "), m.utt, m.startMs, m.endMs]));
  const saveKeywords = () =>
    saveCsv(`${base}.keywords.csv`, ["word", "count", "ref_per_1000", "log_likelihood_G2", "log_ratio", "percent_diff"],
      (report.keywords?.items ?? []).map((k) => [k.word, k.count, k.refPerK, k.g2, k.logRatio, k.diffPct ?? ""]));
  const saveNodeColl = () =>
    saveCsv(`${base}.collocates-of-${normalize(node) || "node"}.csv`, ["collocate", "co_occurrence", "node_freq", "mutual_information", "t_score", "logDice"],
      collocates.map((c) => [c.word, c.count, c.nodeFreq, c.mi, c.tscore, c.logdice]));
  const saveColl = () =>
    saveCsv(`${base}.collocations.csv`, ["bigram", "count", "mutual_information", "t_score", "logDice"],
      report.collocations.map((c) => [c.gram, c.count, c.mi, c.tscore, c.logdice]));
  const saveDisfl = () =>
    saveCsv(`${base}.disfluency.csv`, ["type", "count", "per_1000"], [
      [t.fillersRate, report.disfluency.byType.fillers, report.disfluency.byType.fillersPerK],
      [t.repeatsRate, report.disfluency.byType.repeats, report.disfluency.byType.repeatsPerK],
      [t.falseStartsRate, report.disfluency.byType.falseStarts, report.disfluency.byType.falseStartsPerK],
      [t.interruptionsRate, report.disfluency.byType.interruptions, report.disfluency.byType.interruptionsPerK],
      [t.lengtheningsRate, report.disfluency.byType.lengthenings, report.disfluency.byType.lengtheningsPerK],
      [t.pausesCount, report.disfluency.pauses, report.disfluency.pausesPerK],
    ]);

  const o = report.overview;
  const cx = report.disfluency;
  const totalConf = Math.max(1, report.confidence.high + report.confidence.mid + report.confidence.low);

  const subtabs: { id: string; label: string; icon: typeof Gauge }[] = [
    { id: "overview", label: t.tabOverview, icon: Gauge },
    { id: "freq", label: t.tabFreq, icon: Sigma },
    { id: "kwic", label: t.tabKwic, icon: Search },
    { id: "keywords", label: t.tabKeywords, icon: ScanText },
    { id: "coll", label: t.tabColl, icon: Network },
    { id: "lexical", label: t.tabLexical, icon: BookOpen },
    { id: "readab", label: t.tabReadab, icon: FileDown },
    { id: "speech", label: t.tabSpeech, icon: Activity },
  ];

  return (
    <div className="grid gap-4">
      <Card className="border-border/70">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
            <Badge variant="outline" dir="ltr">{report.meta.language}</Badge>
            <Badge variant="secondary" dir="ltr">{o.tokens.toLocaleString()} tok</Badge>
          </div>
          <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveReport} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              <span className={ar ? "font-arabic" : ""}>{t.saveJson}</span>
            </Button>
          </div>
          <SaveRow d={d} audioId={audioId} ar={ar} />
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" dir={ar ? ("rtl" as const) : ("ltr" as const)}>
        <TabsList className="mb-4 grid h-auto w-full grid-cols-4 gap-1 rounded-xl bg-secondary/40 p-1 sm:grid-cols-8">
          {subtabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id}
              className={`flex h-9 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-medium sm:h-10 sm:flex-row sm:text-xs ${ar ? "font-arabic" : ""}`}>
              <Icon className="h-3.5 w-3.5" />
              <span className="truncate">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ---------------- overview ---------------- */}
        <TabsContent value="overview" className="mt-0">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label={t.tokens} value={o.tokens.toLocaleString()} />
            <Stat label={t.types} value={o.types.toLocaleString()} />
            <Stat label={t.ttr} value={report.lexical.ttr} />
            <Stat label={t.wpm} value={o.wpm} />
            <Stat label={t.utterances} value={o.utterances} />
            <Stat label={t.meanSentenceLen} value={o.meanSentenceLen} />
            <Stat label={t.meanWordLen} value={o.meanWordLen} />
            <Stat label={`${t.hapax} (%)`} value={`${o.hapaxPct}%`} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 p-3">
              <p className={`mb-2 text-xs font-semibold text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.disflTotal} · {cx.perK} {t.disflPerK}</p>
              <div className="grid grid-cols-2 gap-1.5 text-sm">
                <span className="text-muted-foreground">{t.fillersRate}</span><span className="tabular-nums" dir="ltr">{cx.byType.fillers}</span>
                <span className="text-muted-foreground">{t.repeatsRate}</span><span className="tabular-nums" dir="ltr">{cx.byType.repeats}</span>
                <span className="text-muted-foreground">{t.pausesCount}</span><span className="tabular-nums" dir="ltr">{cx.pauses}</span>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className={`mb-2 text-xs font-semibold text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.confidenceDist}</p>
              {([
                [report.confidence.high, "bg-emerald-500", t.confHigh],
                [report.confidence.mid, "bg-amber-500", t.confMid],
                [report.confidence.low, "bg-red-500", t.confLow],
              ] as const).map(([v, color, label]) => (
                <div key={label} className="mb-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                  <span className="w-28 truncate text-muted-foreground">{label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span className={`block h-full ${color}`} style={{ width: `${(v / totalConf) * 100}%` }} />
                  </span>
                  <span className="tabular-nums" dir="ltr">{Math.round((v / totalConf) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ---------------- frequency ---------------- */}
        <TabsContent value="freq" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-4 pt-4">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={hideStops} onCheckedChange={setHideStops} />
                  <span className={ar ? "font-arabic" : ""}>{t.stopToggle}</span>
                </label>
                <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                  {t.range}
                  <select
                    value={topN}
                    onChange={(e) => setTopN(+e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  >
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
              <div className="h-56" dir="ltr">
                <p className={`mb-1 text-xs font-semibold text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.zipfTitle}</p>
                <ResponsiveContainer width="100%" height="85%">
                  <LineChart data={zipfData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="rank" type="number" scale="log" domain={["dataMin", "dataMax"]}
                      ticks={[1, 10, 100]} tick={{ fontSize: 10 }} allowDataOverflow />
                    <YAxis type="number" scale="log" domain={["auto", "auto"]} ticks={[1, 10, 100, 1000]}
                      tick={{ fontSize: 10 }} allowDataOverflow />
                    <Tooltip
                      formatter={(v: number) => [v, t.count]}
                      labelFormatter={(r: number) => {
                        const item = zipfData[r - 1];
                        return item ? `#${r} · ${item.word}` : `#${r}`;
                      }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#f59f00" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ScrollArea className="max-h-80 cm-scroll">
                <table className="w-full">
                  <thead><tr><Th>{t.word}</Th><Th>{t.count}</Th><Th>{t.permill}</Th><Th>{t.dispersion}</Th></tr></thead>
                  <tbody>
                    {freqItems.map((f) => (
                      <tr key={f.word}>
                        <Td><span dir="auto" className="font-medium">{f.word}</span> {f.stop && <span className="ms-1 text-[10px] text-muted-foreground">fx</span>}</Td>
                        <Td num>{f.count}</Td>
                        <Td num>{f.perK}</Td>
                        <Td num>{f.dp}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- kwic ---------------- */}
        <TabsContent value="kwic" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-3 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-56 flex-1">
                  <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.kwicSearch} className="ps-8" />
                </div>
                <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                  {t.kwicWindow}
                  <input type="number" min={1} max={15} value={win} onChange={(e) => setWin(Math.max(1, Math.min(15, +e.target.value || 5)))}
                    className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums" dir="ltr" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={caseSensitive} onCheckedChange={setCaseSensitive} />
                  <span className={ar ? "font-arabic" : ""}>{t.kwicCase}</span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-sm" title={t.kwicNorm}>
                  <Switch checked={normMode} onCheckedChange={setNormMode} />
                  <span className={ar ? "font-arabic" : ""}>{t.kwicNorm}</span>
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
              {kwicResult.badRegex ? (
                <p className="text-sm text-red-500" dir="auto">{t.kwicBadRegex}</p>
              ) : kwicResult.rows.length === 0 ? (
                <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.kwicEmpty}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {kwicResult.total.toLocaleString()} {t.kwicMatches}
                    {kwicResult.capped ? ` · ${t.kwicCap}` : ""}
                  </p>
                  <ScrollArea className="max-h-96 cm-scroll">
                    <table className="w-full">
                      <thead><tr><Th>{t.kwicLeft}</Th><Th>{t.kwicNode}</Th><Th>{t.kwicRight}</Th><Th>{t.kwicAt}</Th><Th> </Th></tr></thead>
                      <tbody>
                        {kwicResult.rows.map((m, i) => (
                          <tr key={i}>
                            <Td><span dir="auto" className="text-muted-foreground">{m.left.join(" ")}</span></Td>
                            <Td><span dir="auto" className="font-bold text-cyan-500 dark:text-cyan-300">{m.node}</span></Td>
                            <Td><span dir="auto" className="text-muted-foreground">{m.right.join(" ")}</span></Td>
                            <Td num>u{m.utt + 1} · {(m.startMs / 1000).toFixed(1)}s</Td>
                            <Td>
                              <button
                                title={t.kwicPlay}
                                aria-label={t.kwicPlay}
                                onClick={() =>
                                  player.playing === `kwic-${i}`
                                    ? player.stop()
                                    : player.play(Math.max(0, m.startMs - 800), m.endMs, `kwic-${i}`)
                                }
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-cyan-500 hover:bg-muted dark:text-cyan-300"
                              >
                                {player.playing === `kwic-${i}` ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
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

        {/* ---------------- keywords ---------------- */}
        <TabsContent value="keywords" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-3 pt-4">
              {!report.keywords ? (
                <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.noData}</p>
              ) : (
                <>
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {report.keywords.source === "siblings" ? t.keynessVsSiblings : t.keynessVsRef} — {t.keynessNote}
                    </span>
                  </p>
                  <ScrollArea className="max-h-96 cm-scroll">
                    <table className="w-full">
                      <thead><tr><Th>{t.word}</Th><Th>{t.count}</Th><Th>{t.refFreq}</Th><Th>{t.ll}</Th><Th>{t.effect}</Th><Th>{t.diffPct}</Th></tr></thead>
                      <tbody>
                        {report.keywords.items.map((k) => (
                          <tr key={k.word}>
                            <Td><span dir="auto" className="font-medium">{k.word}</span></Td>
                            <Td num>{k.count}</Td>
                            <Td num>{k.refPerK}</Td>
                            <Td num>{k.g2.toFixed(1)}</Td>
                            <Td num>{k.logRatio > 0 ? "+" : ""}{k.logRatio.toFixed(2)}</Td>
                            <Td num>{k.diffPct === null ? "-" : `${k.diffPct > 0 ? "+" : ""}${k.diffPct}%`}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                  <Button size="sm" variant="outline" onClick={saveKeywords} className="w-fit gap-1.5">
                    <FileDown className="h-3.5 w-3.5" />{t.saveCsv}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- collocations ---------------- */}
        <TabsContent value="coll" className="mt-0">
          <div className="grid gap-4">
            <Card className="border-border/70">
              <CardHeader className="pb-1">
                <CardTitle className={`text-base ${ar ? "font-arabic" : ""}`}>{t.collNode} · MI / t / logDice</CardTitle>
                <CardDescription className={ar ? "font-arabic" : ""}>{t.collNote}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-48 flex-1">
                    <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input dir="auto" value={node} onChange={(e) => setNode(e.target.value)} placeholder={t.collNode} className="ps-8" />
                  </div>
                  <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                    {t.collSpan}
                    <input type="number" min={1} max={5} value={collSpan}
                      onChange={(e) => setCollSpan(Math.max(1, Math.min(5, +e.target.value || 3)))}
                      className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums" dir="ltr" />
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                    {t.collDirection}
                    <select value={collDir} onChange={(e) => setCollDir(e.target.value as typeof collDir)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                      <option value="both">{t.collBoth}</option>
                      <option value="left">{t.collLeft}</option>
                      <option value="right">{t.collRight}</option>
                    </select>
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                    {t.collMin}
                    <input type="number" min={1} max={20} value={collMin}
                      onChange={(e) => setCollMin(Math.max(1, Math.min(20, +e.target.value || 2)))}
                      className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums" dir="ltr" />
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${ar ? "font-arabic" : ""}`}>
                    {t.collMeasure}
                    <select value={collSort} onChange={(e) => setCollSort(e.target.value as typeof collSort)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                      <option value="logdice">logDice</option>
                      <option value="mi">MI</option>
                      <option value="tscore">t</option>
                      <option value="count">{t.count}</option>
                    </select>
                  </label>
                </div>
                {node.trim() === "" ? (
                  <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.collEmpty}</p>
                ) : collocates.length === 0 ? (
                  <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.kwicEmpty}</p>
                ) : (
                  <>
                    <ScrollArea className="max-h-80 cm-scroll">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <Th>{t.collCollocate}</Th><Th>{t.collCoFreq}</Th><Th>{t.collNodeFreq}</Th>
                            <Th>MI</Th><Th>t</Th><Th>logDice</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {collocates.map((c) => (
                            <tr key={c.word}>
                              <Td><span dir="auto" className="font-medium">{c.word}</span></Td>
                              <Td num>{c.count}</Td>
                              <Td num>{c.nodeFreq}</Td>
                              <Td num>{c.mi.toFixed(2)}</Td>
                              <Td num>{c.tscore.toFixed(2)}</Td>
                              <Td num>{c.logdice.toFixed(3)}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    <Button size="sm" variant="outline" onClick={saveNodeColl} className="w-fit gap-1.5">
                      <FileDown className="h-3.5 w-3.5" />{t.saveCsv}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader className="pb-1">
                <CardTitle className={`text-base ${ar ? "font-arabic" : ""}`}>{t.bigrams} · MI / t / logDice</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0">
                <ScrollArea className="max-h-80 cm-scroll">
                  <table className="w-full">
                    <thead><tr><Th>{t.word}</Th><Th>{t.count}</Th><Th>{t.mi}</Th><Th>{t.tscore}</Th><Th>{t.logdice}</Th></tr></thead>
                    <tbody>
                      {report.collocations.map((c) => (
                        <tr key={c.gram}>
                          <Td><span dir="auto" className="font-medium">{c.gram}</span></Td>
                          <Td num>{c.count}</Td>
                          <Td num>{c.mi.toFixed(2)}</Td>
                          <Td num>{c.tscore.toFixed(2)}</Td>
                          <Td num>{c.logdice.toFixed(3)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
                <Button size="sm" variant="outline" onClick={saveColl} className="w-fit gap-1.5">
                  <FileDown className="h-3.5 w-3.5" />{t.saveCsv}
                </Button>
              </CardContent>
            </Card>
            <div className="grid content-start gap-4">
              {([["bigrams", t.bigrams], ["trigrams", t.trigrams], ["fourgrams", t.fourgrams]] as const).map(([key, label]) => (
                <Card key={key} className="border-border/70">
                  <CardHeader className="pb-1">
                    <CardTitle className={`text-base ${ar ? "font-arabic" : ""}`}>{t.ngrams} — {label}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-1.5">
                      {report.ngrams[key].length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                      {report.ngrams[key].map((g) => (
                        <Badge key={g.gram} variant="secondary" dir="auto" className="gap-1.5">
                          <span>{g.gram}</span>
                          <span className="tabular-nums text-cyan-500 dark:text-cyan-300">{g.count}</span>
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            </div>
          </div>
        </TabsContent>

        {/* ---------------- lexical ---------------- */}
        <TabsContent value="lexical" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-3 pt-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label={t.ttr} value={report.lexical.ttr} />
                <Stat label={t.mattr} value={report.lexical.mattr} />
                <Stat label={t.mtld} value={report.lexical.mtld} />
                <Stat label={t.lexDensity} value={report.lexical.lexicalDensity} />
                <Stat label={t.contentWords} value={report.lexical.contentWords.toLocaleString()} />
                <Stat label={t.functionWords} value={report.lexical.functionWords.toLocaleString()} />
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className={ar ? "font-arabic" : ""}>{t.lexNote}</span>
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- readability ---------------- */}
        <TabsContent value="readab" className="mt-0">
          <Card className="border-border/70">
            <CardContent className="grid gap-3 pt-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label={t.flesch} value={report.readability.flesch ?? "—"} />
                <Stat label={t.fkGrade} value={report.readability.fkGrade ?? "—"} />
                <Stat label={t.lix} value={report.readability.lix} />
                <Stat label={t.longWordPct} value={`${report.readability.longWordPct}%`} />
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className={ar ? "font-arabic" : ""}>{t.fleschNote}</span>
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- speech & prosody ---------------- */}
        <TabsContent value="speech" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader className="pb-1">
                <CardTitle className={`text-base ${ar ? "font-arabic" : ""}`}>{t.disflTotal} — {cx.perK} {t.disflPerK}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0">
                <ScrollArea className="max-h-72 cm-scroll">
                  <table className="w-full">
                    <thead><tr><Th>—</Th><Th>{t.count}</Th><Th>{t.disflPerK}</Th></tr></thead>
                    <tbody>
                      {([
                        [t.fillersRate, cx.byType.fillers, cx.byType.fillersPerK],
                        [t.repeatsRate, cx.byType.repeats, cx.byType.repeatsPerK],
                        [t.falseStartsRate, cx.byType.falseStarts, cx.byType.falseStartsPerK],
                        [t.interruptionsRate, cx.byType.interruptions, cx.byType.interruptionsPerK],
                        [t.lengtheningsRate, cx.byType.lengthenings, cx.byType.lengtheningsPerK],
                        [t.pausesCount, cx.pauses, cx.pausesPerK],
                      ] as const).map(([label, count, per]) => (
                        <tr key={label}>
                          <Td><span className={ar ? "font-arabic" : ""}>{label}</span></Td>
                          <Td num>{count}</Td>
                          <Td num>{per}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {t.pauseMean}: {cx.pauseMeanMs} ms
                </p>
                <Button size="sm" variant="outline" onClick={saveDisfl} className="w-fit gap-1.5">
                  <FileDown className="h-3.5 w-3.5" />{t.saveCsv}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader className="pb-1">
                <CardTitle className={`text-base ${ar ? "font-arabic" : ""}`}>{t.prosodyAgg}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {report.prosody ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Stat label={t.f0Mean} value={report.prosody.f0MeanHz} />
                    <Stat label={t.f0Range} value={`${report.prosody.f0MinHz ?? "—"} – ${report.prosody.f0MaxHz ?? "—"}`} />
                    <Stat label={t.intensity} value={report.prosody.intensityDb} />
                    <Stat label={t.jitter} value={report.prosody.jitterPct} />
                    <Stat label={t.shimmer} value={report.prosody.shimmerPct} />
                    <Stat label={t.hnr} value={report.prosody.hnrDb} />
                  </div>
                ) : (
                  <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.prosodyMissing}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
