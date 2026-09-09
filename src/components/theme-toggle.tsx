"use client";

// Header theme switcher - Light / Dark / System dropdown.
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Dict, Lang } from "@/lib/i18n";

const emptySubscribe = () => () => {};

export function ThemeToggle({ lang, d }: { lang: Lang; d: Dict }) {
  const { theme, setTheme } = useTheme();
  // false during SSR, true once hydrated - no setState-in-effect needed
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const items = [
    { id: "light", label: d.theme.light, icon: Sun },
    { id: "dark", label: d.theme.dark, icon: Moon },
    { id: "system", label: d.theme.system, icon: Monitor },
  ] as const;

  const active = mounted ? theme : undefined;
  const Icon = active === "light" ? Sun : active === "dark" ? Moon : Monitor;

  return (
    <DropdownMenu dir={lang === "ar" ? "rtl" : "ltr"}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={d.theme.label}
          title={d.theme.label}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Icon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {items.map(({ id, label, icon: I }) => (
          <DropdownMenuItem
            key={id}
            onClick={() => setTheme(id)}
            className={`gap-2 ${active === id ? "bg-accent text-accent-foreground" : ""}`}
          >
            <I className="h-4 w-4" />
            <span className={lang === "ar" ? "font-arabic" : ""}>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
