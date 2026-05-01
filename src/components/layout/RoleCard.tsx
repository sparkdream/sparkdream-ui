"use client";

import { useState, type ReactNode } from "react";

/**
 * Compact info card used in the right rail (and inline) for "take a role" /
 * "participate" sections. Body is line-clamped to two lines by default so
 * three cards stack into a typical laptop viewport without needing scroll;
 * "More" reveals the full text.
 */
export function RoleCard({
  label,
  title,
  body,
  reqs,
}: {
  label: string;
  title: string;
  body: ReactNode;
  reqs: ReactNode[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`sd-fut-role${open ? " open" : ""}`}>
      <span className="lab">{label}</span>
      <h4>{title}</h4>
      <p className={open ? "" : "clamp-2"}>{body}</p>
      <div className="req">
        {reqs.map((r, i) => (
          <span className="r" key={i}>{r}</span>
        ))}
      </div>
      <button
        type="button"
        className="role-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "Less ▴" : "More ▾"}
      </button>
    </div>
  );
}
