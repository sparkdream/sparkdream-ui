import type { NextConfig } from "next";
import { execSync } from "node:child_process";
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

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_SHA: gitSha(),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 10),
  },
};

export default nextConfig;
