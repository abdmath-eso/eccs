import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server image (infra/docker/web.Dockerfile) runs `.next/standalone/apps/web/server.js`:
  // the console with only the files it needs, and no node_modules to install on the server.
  // `next dev` is unaffected.
  output: "standalone",
  // The repo root, so the shared packages (packages/*) are traced into that folder too.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
