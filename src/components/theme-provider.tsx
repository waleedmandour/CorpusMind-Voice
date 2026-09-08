"use client";

// Theme provider — light / dark / system, persisted by next-themes.
// `attribute="class"` toggles the `.dark` class that globals.css keys on.
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
