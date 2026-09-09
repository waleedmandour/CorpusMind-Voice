"use client";

// Research Assistant - chat + per-transcript AI tools (summary / clean
// preview / topic tags), all served by the local LLM (Ollama or LM Studio).
// Provider & model are picked in Settings and remembered in localStorage.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Eraser, Loader2, Info, Wand2, FileText, Tags, ListFilter } from "lucide-react";
import type { LlmState } from "@/lib/types";
import type { Dict, Lang } from "@/lib/i18n";

interface Msg {
  role: "user" | "assistant";
  content: string;
  offline?: boolean;
}

const PREF_KEY = "cmv-llm-pref";

function loadPref(): { provider?: "ollama" | "lmstudio"; model?: string } {
  try {
    return JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function Assistant({ lang, d, audioId }: { lang: Lang; d: Dict; audioId: string | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmState | null>(null);
  const [pref, setPref] = useState<{ provider?: "ollama" | "lmstudio"; model?: string }>({});
  const endRef = useRef<HTMLDivElement>(null);
  const ar = lang === "ar";
  const t = d.chat;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    setPref(loadPref());
    void (async () => {
      try {
        const r = await fetch("/api/llm");
        if (r.ok) setLlm((await r.json()) as LlmState);
      } catch { /* offline */ }
    })();
  }, []);

  const activeProvider = pref.provider ?? (llm?.ollama.detected ? "ollama" : llm?.lmstudio.detected ? "lmstudio" : undefined);
  const providerModels = activeProvider === "lmstudio" ? llm?.lmstudio.models ?? [] : llm?.ollama.models ?? [];
  const llmOnline = !!(activeProvider && (activeProvider === "ollama" ? llm?.ollama.detected : llm?.lmstudio.detected));

  const call = useCallback(
    async (body: Record<string, unknown>): Promise<{ content?: string; offline?: boolean; error?: string } | null> => {
      try {
        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...pref, ...body }),
        });
        return (await r.json()) as { content?: string; offline?: boolean; error?: string };
      } catch {
        return { offline: true };
      }
    },
    [pref]
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    const res = await call({
      messages: msgs.concat({ role: "user", content: text }).map((m) => ({ role: m.role, content: m.content })),
    });
    if (!res || res.offline) {
      setMsgs((m) => [...m, { role: "assistant", content: t.offline, offline: true }]);
    } else {
      setMsgs((m) => [...m, { role: "assistant", content: res.content ?? "" }]);
    }
    setBusy(false);
  };

  const runTool = async (task: "summary" | "clean" | "tags") => {
    if (!audioId) {
      toast({ title: t.noTranscript, variant: "destructive" });
      return;
    }
    setToolBusy(task);
    setMsgs((m) => [...m, { role: "user", content: `${t.tools}: ${
      task === "summary" ? t.summary : task === "clean" ? t.clean : t.tags
    }` }]);
    try {
      const r = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioId, task, ...pref }),
      });
      const data = (await r.json()) as { content?: string; offline?: boolean };
      setMsgs((m) => [
        ...m,
        data.offline
          ? { role: "assistant", content: t.offline, offline: true }
          : { role: "assistant", content: data.content ?? "" },
      ]);
    } catch {
      toast({ title: t.offline, variant: "destructive" });
    } finally {
      setToolBusy(null);
    }
  };

  const tools = [
    { id: "summary" as const, label: t.summary, icon: FileText },
    { id: "clean" as const, label: t.clean, icon: ListFilter },
    { id: "tags" as const, label: t.tags, icon: Tags },
  ];

  return (
    <Card className="border-border/70">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
          {llm && (
            <Badge variant="outline" dir="ltr" className={llmOnline ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"}>
              {activeProvider ? `${activeProvider} · ${activeProvider === "ollama" ? (llm.ollama.detected ? "online" : "offline") : llm.lmstudio.detected ? "online" : "offline"}` : "offline"}
            </Badge>
          )}
        </div>
        <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {providerModels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{d.settings.modelLabel}:</span>
            <select
              value={pref.model ?? providerModels[0]?.name ?? ""}
              onChange={(e) => {
                const next = { ...pref, model: e.target.value || undefined };
                setPref(next);
                try { window.localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
              }}
              className="max-w-64 rounded-md border border-input bg-background px-2 py-1 text-xs"
              dir="ltr"
            >
              {providerModels.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className={`flex items-center gap-1 text-xs font-medium text-muted-foreground ${ar ? "font-arabic" : ""}`}>
            <Wand2 className="h-3.5 w-3.5" />
            {t.tools}
          </span>
          {tools.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              size="sm"
              variant="outline"
              disabled={toolBusy !== null || busy || !audioId}
              onClick={() => void runTool(id)}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              {toolBusy === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
              <span className={ar ? "font-arabic" : ""}>{label}</span>
            </Button>
          ))}
        </div>

        <ScrollArea className="cm-scroll h-[22rem] rounded-lg border border-border/60 p-3">
          {msgs.length === 0 ? (
            <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span dir={ar ? "rtl" : "ltr"} className={ar ? "font-arabic" : ""}>{t.placeholder}</span>
            </p>
          ) : (
            <ul className="grid gap-3 pe-3">
              {msgs.map((m, i) => (
                <li key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    dir="auto"
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed
                      ${m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-ee-sm"
                        : m.offline
                          ? "cm-offline-bubble border border-amber-500/40 bg-amber-500/10 rounded-es-sm"
                          : "border border-border bg-secondary/60 rounded-es-sm"}`}
                  >
                    {m.content}
                  </div>
                </li>
              ))}
              {busy && (
                <li className="flex justify-start">
                  <div className="rounded-2xl border border-border bg-secondary/60 px-3.5 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                  </div>
                </li>
              )}
            </ul>
          )}
          <div ref={endRef} />
        </ScrollArea>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.placeholder}
            className={ar ? "font-arabic" : ""}
            disabled={busy}
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label={t.send}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 flip-x" />}
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={() => setMsgs([])} aria-label={t.clear}>
            <Eraser className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
