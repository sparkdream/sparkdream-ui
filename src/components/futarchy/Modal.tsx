"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Lightweight modal shell used by the futarchy action flows. Locks scroll,
 * dismisses on Esc / backdrop click, and renders into document.body so the
 * page-grid stacking context can't clip it.
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      className="sd-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sd-modal" role="dialog" aria-modal="true">
        <div className="sd-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <span className="sub">{subtitle}</span>}
          </div>
          <button type="button" className="sd-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        <div className="sd-modal-body">{children}</div>
        {footer && <div className="sd-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
