import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pkg from "./package.json";

// Short commit SHA for the footer tooltip. Docker builds have no .git in the
// context, so they pass GIT_SHA as a build arg instead.
function gitSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// Content hash of the shield prover worker, appended to its URL. public/ files
// are cached by the CDN and browsers (Cloudflare serves them with a 4 hour
// max-age), and a stale worker paired with new page code breaks every
// anonymous action, so each version of the worker gets its own URL.
function shieldWorkerHash(): string {
  try {
    const src = fs.readFileSync(path.join(process.cwd(), "public/zk/shield-worker.js"));
    return createHash("sha256").update(src).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_SHA: gitSha(),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 10),
    NEXT_PUBLIC_SHIELD_WORKER_HASH: shieldWorkerHash(),
  },
};

export default nextConfig;
