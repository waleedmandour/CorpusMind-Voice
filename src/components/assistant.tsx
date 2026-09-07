"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Eraser, Loader2, Info } from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";

interface Msg {
  role: "user" | "assistant";
  content: string;
  offline?: boolean;
}

export function Assistant({
  lang, d,
}: {
  lang: Lang;
  d: Dict;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const ar = lang === "ar";
  const t = d.chat;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs.concat({ role: "user", content: text }).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await r.json();
      if (data.offline) {
        setMsgs((m) => [...m, { role: "assistant", content: t.offline, offline: true }]);
      } else {
        setMsgs((m) => [...m, { role: "assistant", content: data.content ?? "" }]);
      }
    } catch {
      toast({ title: "Chat failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
        <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ScrollArea className="cm-scroll h-[24rem] rounded-lg border border-border/60 p-3">
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
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed
                      ${m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-ee-sm"
                        : m.offline
                          ? "border border-amber-500/40 bg-amber-500/10 text-amber-200 rounded-es-sm"
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
