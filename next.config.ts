import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin output tracing to this directory: a stray lockfile in any parent
  // folder otherwise re-roots the standalone into <root>/<repo>/ nesting,
  // which breaks the Tauri resources layout (server.js must sit at the root).
  outputFileTracingRoot: __dirname,
  // NEXT_DIST_DIR lets verification builds run without clobbering the dev server's .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Keep the Whisper inference stack as runtime requires: onnxruntime-node
  // ships native .node binaries that must not pass through the bundler.
  // sharp is required EAGERLY by transformers.js's node build at runtime, so
  // it must resolve from node_modules exactly the same way (copy-standalone
  // guarantees the package + the target platform's @img binaries are real
  // files in the standalone).
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "@ffmpeg-installer/ffmpeg", "sharp"],
  // Local-first app with static icons — skip the sharp optimizer and keep
  // ~35 MB of native libvips binaries out of the desktop bundle.
  images: { unoptimized: true },
  // Service worker must be served from the scope root
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
