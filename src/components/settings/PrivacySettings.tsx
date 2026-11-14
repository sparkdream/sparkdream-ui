"use client";

import Link from "next/link";
import { useAutoLoadImages } from "@/hooks/useAutoLoadImages";

/** The Privacy section of the Settings page. */
export default function PrivacySettings() {
  const [autoLoad, setAutoLoad] = useAutoLoadImages();
  return (
    <section id="privacy" className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-lg font-semibold text-white">Privacy</h2>

      <div className="mt-4 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="autoLoadImages" className="text-sm font-medium text-white">
            Load images automatically
          </label>
          <p id="autoLoadImagesHelp" className="mt-1 text-sm text-zinc-400">
            Images in dreams and collections are hosted on other sites. Loading one tells that site your IP address
            and that you opened the page. Turn this off to load each image only when you ask.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Either way, an image only loads after content scanners have cleared it.
          </p>
        </div>
        <button
          id="autoLoadImages"
          type="button"
          role="switch"
          aria-checked={autoLoad}
          aria-describedby="autoLoadImagesHelp"
          onClick={() => setAutoLoad(!autoLoad)}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            autoLoad ? "bg-indigo-600" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              autoLoad ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className="mt-6 border-t border-zinc-800 pt-4">
        <p className="text-sm font-medium text-white">Anonymous identity</p>
        <p className="mt-1 text-sm text-zinc-400">
          Members can post, reply, vote and curate as Anonymous. It is set up with your wallet on the{" "}
          <Link href="/permissions#anonymous" className="underline hover:text-white">
            Permissions page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
