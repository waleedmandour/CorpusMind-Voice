"use client";

// Reusable "Save to device" row - the per-format exports that used to live in
// the dedicated Export tab are now embedded directly in the Transcript Editor,
// Metadata and Linguistic Analysis tabs.
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  FileJson, FileSpreadsheet, FileCode2, Database, FileCode, Network, FileText, FileVideo,
} from "lucide-react";
import type { Dict } from "@/lib/i18n";

export function SaveRow({
  d, audioId, ar,
}: {
  d: Dict;
  audioId: string | null;
  ar: boolean;
}) {
  const t = d.saveRow;
  if (!audioId)
    return (
      <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.disabled}</p>
    );

  const items = [
    { format: "json", icon: FileJson, label: t.json },
    { format: "csv", icon: FileSpreadsheet, label: t.csv },
    { format: "tei", icon: FileCode2, label: t.tei },
    { format: "textgrid", icon: FileCode, label: t.textgrid },
    { format: "eaf", icon: Network, label: t.eaf },
    { format: "srt", icon: FileText, label: t.srt },
    { format: "vtt", icon: FileVideo, label: t.vtt },
    { format: "sqlite", icon: Database, label: t.sqlite },
  ];

  const download = (format: string) => {
    window.location.assign(`/api/export/${audioId}?format=${format}`);
    toast({ title: t.saved });
  };

  return (
    <div className="grid gap-2">
      <p className={`text-xs font-semibold uppercase tracking-wide text-muted-foreground ${ar ? "font-arabic" : ""}`}>
        {t.label}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ format, icon: Icon, label }) => (
          <Button
            key={format}
            variant="outline"
            size="sm"
            onClick={() => download(format)}
            className="h-auto justify-start gap-2.5 px-3 py-2.5 text-start"
          >
            <Icon className="h-5 w-5 shrink-0 text-cyan-500 dark:text-cyan-400" />
            <span className={`min-w-0 truncate text-xs ${ar ? "font-arabic" : ""}`}>{label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
