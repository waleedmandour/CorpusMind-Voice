"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Pencil, Loader2 } from "lucide-react";
import { confBand, type UtteranceView } from "@/lib/types";
import type { Dict, Lang } from "@/lib/i18n";
import { SaveRow } from "@/components/save-row";

interface EditorProps {
  lang: Lang;
  d: Dict;
  audioId: string | null;
}

export function Editor({ lang, d, audioId }: EditorProps) {
  const [utts, setUtts] = useState<UtteranceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ uttIdx: number; tokId: string; text: string } | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<{ uttIdx: number; uttId: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const ar = lang === "ar";
  const t = d.editor;

  const load = useCallback(async () => {
    if (!audioId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/audio/${audioId}`);
      if (!r.ok) throw new Error("load failed");
      const data = await r.json();
      setUtts(
        (data.utterances as UtteranceView[]).map((u) => ({
          ...u,
          disfluencies: u.disfluencies ?? null,
          prosody: u.prosody ?? null,
        }))
      );
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [audioId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveToken = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/tokens/${editing.tokId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editing.text }),
      });
      if (!r.ok) throw new Error("save failed");
      setUtts((prev) =>
        prev.map((u, ui) =>
          ui === editing.uttIdx
            ? {
                ...u,
                tokens: u.tokens.map((tk) =>
                  tk.id === editing.tokId ? { ...tk, text: editing.text.trim(), confidence: 1, edited: true } : tk
                ),
              }
            : u
        )
      );
      toast({ title: t.saved });
      setEditing(null);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveSpeaker = async () => {
    if (!editingSpeaker) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/utterances/${editingSpeaker.uttId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker: editingSpeaker.text }),
      });
      if (!r.ok) throw new Error("save failed");
      setUtts((prev) =>
        prev.map((u, ui) =>
          ui === editingSpeaker.uttIdx ? { ...u, speaker: editingSpeaker.text.trim() } : u
        )
      );
      toast({ title: t.speakerSaved });
      setEditingSpeaker(null);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const ms = (v: number) => `${(v / 1000).toFixed(2)}s`;

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
        <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline" className="tok-high border">{t.legendHigh}</Badge>
          <Badge variant="outline" className="tok-mid border">{t.legendMid}</Badge>
          <Badge variant="outline" className="tok-low border">{t.legendLow}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
          </div>
        ) : utts.length === 0 ? (
          <p className={`py-8 text-center text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.noData}</p>
        ) : (
          <div className="cm-scroll max-h-[34rem] overflow-y-auto pe-1">
            <ul className="grid gap-3">
              {utts.map((u, ui) => (
                <li key={u.id} className="rounded-xl border border-border/60 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className={ar ? "font-arabic" : ""}>
                      {t.utterance} {u.index + 1}
                    </Badge>
                    <span dir="ltr" className="tabular-nums">
                      {ms(u.startMs)} → {ms(u.endMs)}
                    </span>
                    <button
                      onClick={() => setEditingSpeaker({ uttIdx: ui, uttId: u.id, text: u.speaker })}
                      title={`${t.editSpeaker}: ${u.speaker}`}
                      className="ms-auto cursor-pointer rounded px-1.5 py-0.5 underline decoration-dotted underline-offset-2 hover:bg-muted"
                      dir="ltr"
                    >
                      {u.speaker}
                    </button>
                  </div>

                  <div className={`flex flex-wrap gap-1.5 ${ar ? "font-arabic" : ""}`}>
                    {u.tokens.map((tk) => (
                      <button
                        key={tk.id}
                        title={`${t.confidence} ${tk.confidence.toFixed(2)} · ${ms(tk.startMs)}→${ms(tk.endMs)}`}
                        onClick={() => setEditing({ uttIdx: ui, tokId: tk.id, text: tk.text })}
                        className={`tok-${confBand(tk.confidence)} group inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-sm transition-transform hover:scale-[1.04]`}
                      >
                        {tk.text}
                        {tk.edited && <Pencil className="h-2.5 w-2.5 opacity-70" />}
                      </button>
                    ))}
                  </div>

                  {(u.disfluencies || u.prosody) && (
                    <Collapsible open={!!openDetails[u.id]} onOpenChange={(o) => setOpenDetails((s) => ({ ...s, [u.id]: o }))}>
                      <CollapsibleTrigger className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline">
                        {openDetails[u.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {t.disfluencies} / {t.prosody}
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 grid gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
                          {u.disfluencies && (
                            <ul className="grid gap-1" dir={ar ? "rtl" : "ltr"}>
                              <li><span className="text-muted-foreground">{t.pauses}:</span> {u.disfluencies.pauses.length}</li>
                              <li><span className="text-muted-foreground">{t.fillers}:</span> {u.disfluencies.fillers.join(", ") || "—"}</li>
                              <li><span className="text-muted-foreground">{t.repeats}:</span> {u.disfluencies.repeats.join(", ") || "—"}</li>
                              <li><span className="text-muted-foreground">{t.falseStarts}:</span> {u.disfluencies.falseStarts.join(", ") || "—"}</li>
                              <li><span className="text-muted-foreground">{t.interruptions}:</span> {u.disfluencies.interruptions.join(", ") || "—"}</li>
                              <li><span className="text-muted-foreground">{t.lengthenings}:</span> {u.disfluencies.lengthenings.join(", ") || "—"}</li>
                            </ul>
                          )}
                          {u.prosody && (
                            <ul className="grid gap-1" dir="ltr">
                              <li><span className="text-muted-foreground">{t.f0}:</span> {u.prosody.f0MeanHz} Hz ({u.prosody.f0MinHz}–{u.prosody.f0MaxHz})</li>
                              <li><span className="text-muted-foreground">{t.intensity}:</span> {u.prosody.intensityMeanDb} dB</li>
                              <li><span className="text-muted-foreground">{t.jitter}:</span> {u.prosody.jitterPct}%</li>
                              <li><span className="text-muted-foreground">{t.shimmer}:</span> {u.prosody.shimmerPct}%</li>
                              <li><span className="text-muted-foreground">{t.hnr}:</span> {u.prosody.hnrDb} dB</li>
                            </ul>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editingSpeaker} onOpenChange={(o) => !o && setEditingSpeaker(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className={ar ? "font-arabic" : ""}>
              {t.editSpeaker} · {t.utterance} {(editingSpeaker?.uttIdx ?? 0) + 1}
            </DialogTitle>
          </DialogHeader>
          <Input
            dir="auto"
            value={editingSpeaker?.text ?? ""}
            onChange={(e) => setEditingSpeaker((s) => (s ? { ...s, text: e.target.value } : s))}
            onKeyDown={(e) => e.key === "Enter" && void saveSpeaker()}
            autoFocus
          />
          <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.speakerHint}</p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEditingSpeaker(null)} className={ar ? "font-arabic" : ""}>{t.cancel}</Button>
            <Button onClick={() => void saveSpeaker()} disabled={saving || !editingSpeaker?.text.trim()} className={ar ? "font-arabic" : ""}>
              {saving && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className={ar ? "font-arabic" : ""}>{t.editToken}</DialogTitle>
          </DialogHeader>
          <Input
            dir="auto"
            value={editing?.text ?? ""}
            onChange={(e) => setEditing((s) => (s ? { ...s, text: e.target.value } : s))}
            onKeyDown={(e) => e.key === "Enter" && void saveToken()}
            autoFocus
          />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} className={ar ? "font-arabic" : ""}>{t.cancel}</Button>
            <Button onClick={() => void saveToken()} disabled={saving || !editing?.text.trim()} className={ar ? "font-arabic" : ""}>
              {saving && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="border-t border-border/60 pt-4">
        <SaveRow d={d} audioId={audioId} ar={ar} />
      </div>
    </Card>
  );
}
