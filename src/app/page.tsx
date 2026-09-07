"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dict, type Dict } from "@/lib/i18n";
import { useLang } from "@/lib/lang-store";
import type { JobView } from "@/lib/types";
import { Header } from "@/components/header";
import { Studio } from "@/components/studio";
import { Editor } from "@/components/editor";
import { MetadataForm } from "@/components/metadata-form";
import { ExportPanel } from "@/components/export-panel";
import { Diagnostics } from "@/components/diagnostics";
import { Assistant } from "@/components/assistant";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudioLines, PenLine, ClipboardList, FileDown, Stethoscope, MessageSquareText, Github } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function Home() {
  const [lang, setLang] = useLang();
  const [tab, setTab] = useState("studio");
  const [jobId, setJobId] = useState<string | null>(null);
  const [audioId, setAudioId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  const d: Dict = useMemo(() => dict[lang], [lang]);
  const ar = lang === "ar";

  // keep <html> lang/dir in sync with the selected UI language
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = ar ? "rtl" : "ltr";
  }, [lang, ar]);

  // PWA install prompt
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const install = async () => {
    if (!installEvt) return;
    await installEvt.prompt();
    setInstallEvt(null);
  };

  // job polling
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (r.ok) {
          const data = (await r.json()) as JobView;
          if (!alive) return;
          setJob(data);
          if (data.status === "running" || data.status === "queued") {
            timer = setTimeout(poll, 800);
          } else if (data.status === "done") {
            // editor fills automatically through its own effect
          }
        }
      } catch { /* retry next tick */ }
      if (alive && !timer) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  const onUploaded = useCallback((aId: string, jId: string) => {
    setAudioId(aId);
    setJobId(jId);
    setJob(null);
  }, []);

  const onOpenJob = useCallback((aId: string, jId: string) => {
    setAudioId(aId);
    setJobId(jId);
    setJob(null);
  }, []);

  const navItems = [
    { id: "studio", label: d.nav.studio, icon: AudioLines },
    { id: "editor", label: d.nav.editor, icon: PenLine },
    { id: "metadata", label: d.nav.metadata, icon: ClipboardList },
    { id: "export", label: d.nav.export, icon: FileDown },
    { id: "diagnostics", label: d.nav.diagnostics, icon: Stethoscope },
    { id: "assistant", label: d.nav.assistant, icon: MessageSquareText },
  ];

  return (
    <div className="flex min-h-screen flex-col brand-gradient">
      <Header
        lang={lang}
        onToggleLang={() => setLang(lang === "en" ? "ar" : "en")}
        d={d}
        installReady={!!installEvt}
        onInstall={() => void install()}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-10 pt-6 sm:px-6">
        {/* hero */}
        <section className="mb-6 text-center">
          <h2
            className={`mx-auto max-w-3xl bg-gradient-to-r from-cyan-300 via-sky-200 to-amber-300 bg-clip-text text-2xl font-extrabold leading-tight text-transparent sm:text-3xl ${ar ? "font-arabic" : ""}`}
          >
            {d.heroTitle}
          </h2>
          <p className={`mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base ${ar ? "font-arabic" : ""}`}>
            {d.heroDesc}
          </p>
        </section>

        <Tabs value={tab} onValueChange={setTab} dir={ar ? ("rtl" as const) : ("ltr" as const)}>
          <TabsList className="mb-5 grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-secondary/40 p-1 sm:grid-cols-6">
            {navItems.map(({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className={`flex h-9 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium sm:h-10 sm:flex-row sm:gap-1.5 sm:text-xs ${ar ? "font-arabic" : ""}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="studio" className="mt-0">
            <Studio lang={lang} d={d} job={job} onUploaded={onUploaded} onOpenJob={onOpenJob} />
          </TabsContent>
          <TabsContent value="editor" className="mt-0">
            <Editor lang={lang} d={d} audioId={audioId} />
          </TabsContent>
          <TabsContent value="metadata" className="mt-0">
            <MetadataForm lang={lang} d={d} audioId={audioId} />
          </TabsContent>
          <TabsContent value="export" className="mt-0">
            <ExportPanel lang={lang} d={d} audioId={audioId} />
          </TabsContent>
          <TabsContent value="diagnostics" className="mt-0">
            <Diagnostics lang={lang} d={d} />
          </TabsContent>
          <TabsContent value="assistant" className="mt-0">
            <Assistant lang={lang} d={d} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-background/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p className={ar ? "font-arabic" : ""}>
            © 2026 Dr. Waleed Mandour · {d.footer.rights}
          </p>
          <p className={`flex items-center gap-2 ${ar ? "font-arabic" : ""}`}>
            {d.footer.companion} ·{" "}
            <a
              className="text-cyan-400 underline-offset-2 hover:underline"
              href="https://waleedmandour.org/projects/CorpusMind/"
              target="_blank"
              rel="noreferrer"
            >
              waleedmandour.org/projects/CorpusMind
            </a>
            <a
              href="https://github.com/waleedmandour/CorpusMind"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="hover:text-foreground"
            >
              <Github className="h-3.5 w-3.5" />
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
