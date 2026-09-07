"use client";

import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileJson, FileSpreadsheet, FileCode2, Database } from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";

export function ExportPanel({
  lang, d, audioId,
}: {
  lang: Lang;
  d: Dict;
  audioId: string | null;
}) {
  const t = d.exportTab;
  const ar = lang === "ar";

  const items = [
    { format: "json", icon: FileJson, label: t.json, file: ".corpusmind.json" },
    { format: "csv", icon: FileSpreadsheet, label: t.csv, file: ".tokens.csv" },
    { format: "tei", icon: FileCode2, label: t.tei, file: ".tei.xml" },
    { format: "sqlite", icon: Database, label: t.sqlite, file: ".sqlite" },
  ];

  const download = (format: string) => {
    if (!audioId) return;
    window.location.assign(`/api/export/${audioId}?format=${format}`);
    toast({ title: t.exported });
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
        <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
      </CardHeader>
      <CardContent>
        {!audioId ? (
          <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.disabled}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map(({ format, icon: Icon, label, file }) => (
              <Button
                key={format}
                variant="outline"
                onClick={() => download(format)}
                className="h-auto justify-start gap-3 p-4 text-start"
              >
                <Icon className="h-6 w-6 shrink-0 text-cyan-400" />
                <span className="min-w-0">
                  <span className={`block font-semibold ${ar ? "font-arabic" : ""}`}>{label}</span>
                  <span className="block truncate text-xs text-muted-foreground" dir="ltr">{file}</span>
                </span>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
