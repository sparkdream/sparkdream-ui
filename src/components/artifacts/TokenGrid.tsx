"use client";

import type { TokenView } from "@/types/artifact";
import { ArtifactMedia, LockBadge, isHidden, lockOf, tokenRef, tokenTitle } from "./shared";

interface Props {
  tokens: TokenView[];
  onSelect: (classId: string, tokenId: string) => void;
  /** Optional class names by id, shown under each token. */
  classNames?: Record<string, string>;
  empty: string;
}

export default function TokenGrid({ tokens, onSelect, classNames, empty }: Props) {
  if (tokens.length === 0) {
    return (
      <div className="sd-hull-tile rounded-xl p-10 text-center">
        <p className="text-sm text-zinc-400">{empty}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {tokens.map(({ token: t, withheld, class_status }) => {
        const hidden = withheld || isHidden(t.status) || isHidden(class_status);
        return (
          <button
            key={tokenRef(t.class_id, t.id)}
            onClick={() => onSelect(t.class_id, t.id)}
            className="sd-hull-tile interactive flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
          >
            <ArtifactMedia uri="" size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-zinc-100">{tokenTitle(t, withheld)}</span>
                <LockBadge lock={lockOf(t)} />
                {hidden && (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">Hidden</span>
                )}
              </div>
              <div className="truncate font-mono text-[11px] text-zinc-500">
                {tokenRef(t.class_id, t.id)}
                {classNames?.[t.class_id] && <span className="ml-2 font-sans">{classNames[t.class_id]}</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
