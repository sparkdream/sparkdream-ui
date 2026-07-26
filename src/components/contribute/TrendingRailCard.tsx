"use client";

/**
 * Right-rail "Trending onchain" card, styled like the Swarm rail cards
 * (`sd-rail-card` / `sd-trend-row`). Generic over what the trailing metric is:
 * Initiatives pass a conviction percentage, Projects pass a DREAM budget. Rows
 * are pre-ranked and pre-sliced by the caller.
 */
export interface TrendingItem {
  id: string;
  title: string;
  /** Preformatted trailing metric, e.g. "85%" or "80 DREAM". */
  metric: string;
}

export default function TrendingRailCard({
  heading = "Trending onchain",
  live = true,
  items,
  emptyText,
  onSelect,
}: {
  heading?: string;
  live?: boolean;
  items: TrendingItem[];
  emptyText: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="sd-rail-card">
      <h5>
        {heading}
        {live && (
          <span className="live">
            <span className="d" />
            live
          </span>
        )}
      </h5>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", padding: "4px 0" }}>{emptyText}</div>
      ) : (
        items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it.id)}
            className="sd-trend-row"
            style={{ background: "transparent", border: 0, width: "100%", textAlign: "left", cursor: "pointer" }}
          >
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <span className="title">{it.title}</span>
            <span className="c">{it.metric}</span>
          </button>
        ))
      )}
    </div>
  );
}
