"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress } from "@/lib/utils";
import SessionModeSwitcher from "@/components/SessionModeSwitcher";

type NavLeaf = { href: string; label: string; desc?: string; icon: React.ReactNode };
type NavGroup = { id: string; label: string; items: NavLeaf[] };

const PRIMARY_LINKS: { href: string; label: string }[] = [
  { href: "/blog", label: "Scrolls" },
  { href: "/forum", label: "Forum" },
  { href: "/collections", label: "Collections" },
  { href: "/season", label: "Season" },
];

const CONTRIBUTE_GROUP: NavGroup = {
  id: "contribute",
  label: "Contribute",
  items: [
    {
      href: "/contribute",
      label: "Contribute hub",
      desc: "Profile · Staking · Projects · Initiatives",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
        </svg>
      ),
    },
    {
      href: "/reveal",
      label: "Reveal",
      desc: "Commit-reveal rounds for code",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
  ],
};

const GOVERN_GROUP: NavGroup = {
  id: "govern",
  label: "Govern",
  items: [
    {
      href: "/governance",
      label: "Governance",
      desc: "Council & chain proposals",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 21h18M6 21V10l6-4 6 4v11M10 21v-6h4v6" />
        </svg>
      ),
    },
    {
      href: "/futarchy",
      label: "Futarchy",
      desc: "Decision markets",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 3v18h18" />
          <polyline points="7 14 11 10 14 13 20 7" />
        </svg>
      ),
    },
    {
      href: "/federation",
      label: "Federation",
      desc: "Interchain governance & bridges",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
      ),
    },
  ],
};

const SYSTEM_GROUP: NavGroup = {
  id: "system",
  label: "System",
  items: [
    {
      href: "/names",
      label: "Names",
      desc: "Human-readable on-chain",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 4h16v6H4zM4 14h16v6H4z" />
          <circle cx="8" cy="7" r="1" fill="currentColor" />
          <circle cx="8" cy="17" r="1" fill="currentColor" />
        </svg>
      ),
    },
    {
      href: "/sessions",
      label: "Sessions",
      desc: "Keys & scoped access",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ),
    },
  ],
};

const CHEVRON = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function useDropdown<T extends HTMLElement>(onClose?: () => void) {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return { ref, open, setOpen };
}

function Dropdown({
  group,
  align = "left",
  trigger,
  activeHref,
}: {
  group: NavGroup;
  align?: "left" | "right";
  trigger: "text" | "icon";
  activeHref: string;
}) {
  const { ref, open, setOpen } = useDropdown<HTMLDivElement>();
  const hasActive = group.items.some(
    (i) => activeHref === i.href || activeHref.startsWith(i.href + "/")
  );
  return (
    <div ref={ref} className={`sd-nav-group ${open ? "open" : ""}`}>
      {trigger === "text" ? (
        <button
          className={`sd-nav-group-btn${hasActive ? " active" : ""}`}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {group.label}
          {CHEVRON}
        </button>
      ) : (
        <button
          className="sd-icon-btn"
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={group.label}
          title={group.label}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}
      <div className={`sd-nav-menu${align === "right" ? " right" : ""}`}>
        {group.items.map((it) => (
          <Link key={it.href} href={it.href} onClick={() => setOpen(false)}>
            {it.icon}
            <div>
              <span className="label">{it.label}</span>
              {it.desc && <span className="desc">{it.desc}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Header() {
  const pathname = usePathname();
  const {
    address,
    signerAddress,
    name,
    connected,
    connecting,
    connect,
    disconnect,
    sessionActive,
  } = useWallet();

  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <header className="sd-topnav">
      <div className="sd-topnav-inner">
        <button
          type="button"
          className="sd-hamburger"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Link href="/" className="sd-wordmark">
          <span className="sd-glyph" aria-hidden="true" />
          Spark Dream
        </Link>

        <nav className="sd-primary-nav">
          {PRIMARY_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={isActive(l.href) ? "active" : undefined}
            >
              {l.label}
            </Link>
          ))}
          <Dropdown group={CONTRIBUTE_GROUP} trigger="text" activeHref={pathname} />
          <Dropdown group={GOVERN_GROUP} trigger="text" activeHref={pathname} />
        </nav>

        <div className="sd-topnav-right">
          {connected ? (
            <>
              <SessionModeSwitcher />
              <div className="sd-identity">
                {name && <div className="name">{name}</div>}
                <div className="addr">
                  {sessionActive
                    ? truncateAddress(signerAddress!)
                    : truncateAddress(address!)}
                </div>
              </div>
              <Dropdown group={SYSTEM_GROUP} trigger="icon" align="right" activeHref={pathname} />
              <button className="sd-btn-ghost" onClick={disconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="sd-btn sd-btn-primary"
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>

      {mobileOpen && (
        <MobileMenu
          pathname={pathname}
          onClose={() => setMobileOpen(false)}
          connected={connected}
          connecting={connecting}
          connect={connect}
          disconnect={disconnect}
          name={name}
          address={address}
          signerAddress={signerAddress}
          sessionActive={sessionActive}
        />
      )}
    </header>
  );
}

function MobileMenu({
  pathname,
  onClose,
  connected,
  connecting,
  connect,
  disconnect,
  name,
  address,
  signerAddress,
  sessionActive,
}: {
  pathname: string;
  onClose: () => void;
  connected: boolean;
  connecting: boolean;
  connect: () => void;
  disconnect: () => void;
  name: string | null;
  address: string | null;
  signerAddress: string | null;
  sessionActive: boolean;
}) {
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const renderLeaf = (l: NavLeaf) => (
    <Link
      key={l.href}
      href={l.href}
      className={`sd-mobile-link${isActive(l.href) ? " active" : ""}`}
      onClick={onClose}
    >
      {l.icon}
      <div>
        <span className="label">{l.label}</span>
        {l.desc && <span className="desc">{l.desc}</span>}
      </div>
    </Link>
  );

  return (
    <div className="sd-mobile-menu" role="dialog" aria-modal="true">
      <div className="sd-mobile-backdrop" onClick={onClose} />
      <div className="sd-mobile-panel">
        <div className="sd-mobile-head">
          <span className="sd-mobile-title">Menu</span>
          <button
            type="button"
            className="sd-mobile-close"
            aria-label="Close menu"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        <div className="sd-mobile-body">
          <div className="sd-mobile-section">
            {PRIMARY_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`sd-mobile-link${isActive(l.href) ? " active" : ""}`}
                onClick={onClose}
              >
                <span className="label">{l.label}</span>
              </Link>
            ))}
          </div>

          <div className="sd-mobile-section">
            <div className="sd-mobile-heading">{CONTRIBUTE_GROUP.label}</div>
            {CONTRIBUTE_GROUP.items.map(renderLeaf)}
          </div>

          <div className="sd-mobile-section">
            <div className="sd-mobile-heading">{GOVERN_GROUP.label}</div>
            {GOVERN_GROUP.items.map(renderLeaf)}
          </div>

          <div className="sd-mobile-section">
            <div className="sd-mobile-heading">{SYSTEM_GROUP.label}</div>
            {SYSTEM_GROUP.items.map(renderLeaf)}
          </div>
        </div>

        <div className="sd-mobile-foot">
          {connected ? (
            <>
              <div className="sd-mobile-identity">
                {name && <div className="name">{name}</div>}
                <div className="addr">
                  {sessionActive
                    ? truncateAddress(signerAddress!)
                    : truncateAddress(address!)}
                </div>
              </div>
              <button
                className="sd-btn-ghost"
                onClick={() => {
                  disconnect();
                  onClose();
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                connect();
                onClose();
              }}
              disabled={connecting}
              className="sd-btn sd-btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
