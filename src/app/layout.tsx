import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Cairo - the Arabic typeface used by the CorpusMind project site
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

const APP_NAME = "CorpusMind Voice";
const APP_DESC =
  "Local-first, fully offline audio-to-corpus pipeline: ASR, forced alignment, prosody and disfluency annotation, a companion tool for CorpusMind.";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: "CorpusMind Voice: Offline Audio to Annotated Corpus",
    template: "%s · CorpusMind Voice",
  },
  description: APP_DESC,
  keywords: [
    "CorpusMind",
    "corpus linguistics",
    "forced alignment",
    "faster-whisper",
    "Montreal Forced Aligner",
    "prosody",
    "disfluency",
    "Arabic",
    "TEI XML",
  ],
  authors: [
    { name: "Dr. Waleed Mandour", url: "https://waleedmandour.org/" },
    { name: "Prof. Wesam Ibrahim" },
  ],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: "CorpusMind Voice",
    description: APP_DESC,
    siteName: "CorpusMind Voice",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CorpusMind Voice",
    description: APP_DESC,
  },
};

export const viewport: Viewport = {
  themeColor: "#0A1C3C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} antialiased`}
      >
        <ThemeProvider>
          {children}
          <Toaster />
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
