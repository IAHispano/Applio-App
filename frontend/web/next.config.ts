import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Keep the running development server from replacing release build files.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Each mode checks only its own generated route types. Old development
  // validators must not enter production builds after a route is renamed.
  typescript: {
    tsconfigPath: process.env.NODE_ENV === "development" ? "tsconfig.dev.json" : "tsconfig.json",
  },
  // Rust serves the exported UI and native API; production needs no Node server.
  output: "export",
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    // /api/* is proxied to the Rust API via rewrites below. Next
    // buffers proxied request bodies (default 10MB) — model/audio uploads
    // (.pth, datasets, samples) are hundreds of MB, so raise the limit to
    // match the API's 1GB multer cap. Without this, uploads are silently
    // truncated to the first 10MB and imports fail.
    middlewareClientMaxBodySize: "1024mb",
  },
  // Next dev still proxies local requests; exported production routes live in Rust.
  ...(process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          const api = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
          return ["api", "outputs", "assets", "voicefocus"].map((prefix) => ({
            source: `/${prefix}/:path*`,
            destination: `${api}/${prefix}/:path*`,
          }));
        },
      }
    : {}),
};

export default nextConfig;
