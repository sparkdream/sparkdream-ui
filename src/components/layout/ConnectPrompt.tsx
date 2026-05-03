"use client";

export default function ConnectPrompt({ message }: { message: string }) {
  return (
    <div className="sd-hull-tile rounded-xl p-12 text-center">
      <p className="text-zinc-400">{message}</p>
    </div>
  );
}
