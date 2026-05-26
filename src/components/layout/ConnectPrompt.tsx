"use client";

import type { ReactNode } from "react";

export default function ConnectPrompt({
  message,
  align = "center",
}: {
  message: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div className={`sd-hull-tile rounded-xl p-12 ${align === "center" ? "text-center" : ""}`}>
      <p className="text-zinc-400">{message}</p>
    </div>
  );
}
