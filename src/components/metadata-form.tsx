"use client";

import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";
import { SaveRow } from "@/components/save-row";

interface MetaState {
  corpusTitle: string; speakerName: string; speakerDialect: string; speakerGender: string;
  speakerAge: string; recordingDate: string; recordingPlace: string; genre: string;
  license: string; notes: string;
}

const EMPTY: MetaState = {
  corpusTitle: "", speakerName: "", speakerDialect: "", speakerGender: "",
  speakerAge: "", recordingDate: "", recordingPlace: "", genre: "", license: "CC-BY-4.0", notes: "",
};

export function MetadataForm({
  lang, d, audioId,
}: {
  lang: Lang;
  d: Dict;
  audioId: string | null;
}) {
  const [m, setM] = useState<MetaState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const ar = lang === "ar";
  const t = d.metadata;

  useEffect(() => {
    if (!audioId) return;
    void fetch(`/api/metadata/${audioId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setM({ ...EMPTY, ...data }))
      .catch(() => {});
  }, [audioId]);

  const set = (k: keyof MetaState) => (v: string) => setM((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!audioId) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/metadata/${audioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m),
      });
      if (!r.ok) throw new Error();
      toast({ title: t.saved });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const F = ({
    k, label, placeholder, type = "text",
  }: { k: keyof MetaState; label: string; placeholder?: string; type?: string }) => (
    <div>
      <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{label}</label>
      <Input
        type={type} dir="auto" value={m[k]} placeholder={placeholder}
        onChange={(e) => set(k)(e.target.value)}
        className={ar ? "font-arabic" : ""}
      />
    </div>
  );

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
        <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <F k="corpusTitle" label={t.corpusTitle} />
          <F k="speakerName" label={t.speakerName} />
          <F k="speakerDialect" label={t.speakerDialect} />
          <div>
            <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t.speakerGender}</label>
            <Select value={m.speakerGender || " "} onValueChange={(v) => set("speakerGender")(v === " " ? "" : v)}>
              <SelectTrigger className={ar ? "font-arabic" : ""}><SelectValue /></SelectTrigger>
              <SelectContent dir={ar ? "rtl" : "ltr"}>
                <SelectItem value=" ">—</SelectItem>
                <SelectItem value="female">{ar ? "أنثى" : "Female"}</SelectItem>
                <SelectItem value="male">{ar ? "ذكر" : "Male"}</SelectItem>
                <SelectItem value="other">{ar ? "أخرى" : "Other"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <F k="speakerAge" label={t.speakerAge} type="number" />
          <F k="recordingDate" label={t.recordingDate} type="date" />
          <F k="recordingPlace" label={t.recordingPlace} />
          <F k="genre" label={t.genre} />
          <div>
            <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t.license}</label>
            <Select value={m.license || "CC-BY-4.0"} onValueChange={set("license")}>
              <SelectTrigger dir="ltr"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CC-BY-4.0">CC-BY-4.0</SelectItem>
                <SelectItem value="CC-BY-SA-4.0">CC-BY-SA-4.0</SelectItem>
                <SelectItem value="CC0-1.0">CC0-1.0</SelectItem>
                <SelectItem value="MIT">MIT</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t.notes}</label>
          <Textarea dir="auto" value={m.notes} onChange={(e) => set("notes")(e.target.value)} rows={3} className={ar ? "font-arabic" : ""} />
        </div>
        <Button onClick={() => void save()} disabled={saving || !audioId} className="w-fit gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span className={ar ? "font-arabic" : ""}>{t.save}</span>
        </Button>

        <div className="border-t border-border/60 pt-4">
          <SaveRow d={d} audioId={audioId} ar={ar} />
        </div>
      </CardContent>
    </Card>
  );
}
