"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useDisplayName } from "@/hooks/useDisplayName";
import CopyableAddress from "@/components/CopyableAddress";
import SessionModeSwitcher from "@/components/SessionModeSwitcher";

type NavLeaf = {
  href: string;
  label: string;
  desc?: string;
  icon: React.ReactNode;
  external?: boolean;
};
type NavGroup = { id: string; label: string; items: NavLeaf[] };

const PRIMARY_LINKS: { href: string; label: string }[] = [
  { href: "/season", label: "Season" },
];

const PUBLISH_GROUP: NavGroup = {
  id: "publish",
  label: "Publish",
  items: [
    {
      href: "/imaginarium",
      label: "Imaginarium",
      desc: "Long-form dreams & self-published works",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      ),
    },
    {
      href: "/swarm",
      label: "Swarm",
      desc: "Discussions, bounties, and moderation",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
    },
    {
      href: "/wonders",
      label: "Wonders",
      desc: "Curated collections — NFTs, links & refs",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>
      ),
    },
  ],
};

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
      href: "/contribute?view=delegate",
      label: "Delegate SPARK",
      desc: "Stake SPARK with a validator · earn rewards",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
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
      desc: "Human-readable onchain",
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
    {
      href: "/rss",
      label: "RSS feed",
      desc: "Subscribe to onchain updates",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 11a9 9 0 0 1 9 9" />
          <path d="M4 4a16 16 0 0 1 16 16" />
          <circle cx="5" cy="19" r="1" fill="currentColor" />
        </svg>
      ),
    },
    {
      href: "/archive",
      label: "Archive",
      desc: "Browse past testnet snapshots",
      icon: (
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 7h18v4H3z" />
          <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
          <path d="M10 15h4" />
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
        {group.items.map((it) =>
          it.external ? (
            <a
              key={it.href}
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              {it.icon}
              <div>
                <span className="label">{it.label}</span>
                {it.desc && <span className="desc">{it.desc}</span>}
              </div>
            </a>
          ) : (
            <Link key={it.href} href={it.href} onClick={() => setOpen(false)}>
              {it.icon}
              <div>
                <span className="label">{it.label}</span>
                {it.desc && <span className="desc">{it.desc}</span>}
              </div>
            </Link>
          )
        )}
      </div>
    </div>
  );
}

export default function Header() {
  const pathname = usePathname();
  const {
    address,
    signerAddress,
    connected,
    connecting,
    connect,
    disconnect,
    sessionActive,
  } = useWallet();
  const { config } = useChainConfig();
  const { name } = useDisplayName(address);

  const [mobileOpen, setMobileOpen] = useState(false);

  const systemGroup: NavGroup = useMemo(
    () => ({
      ...SYSTEM_GROUP,
      items: [
        ...SYSTEM_GROUP.items,
        {
          href: config.explorerUrl,
          label: "Block explorer",
          desc: "Browse blocks, txs, and accounts",
          external: true,
          icon: (
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M14 3h7v7" />
              <path d="M10 14L21 3" />
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </svg>
          ),
        },
      ],
    }),
    [config.explorerUrl]
  );

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  // Close the mobile menu whenever the route changes, without an effect:
  // React allows adjusting state during render as long as it's guarded by a
  // condition that eventually settles. Tracking pathname in state lets us
  // detect the transition the same way an effect would, but the setState
  // call runs in the same render the user navigated in — no extra commit,
  // no `react-hooks/set-state-in-effect` warning.
  const [navPathname, setNavPathname] = useState(pathname);
  if (pathname !== navPathname) {
    setNavPathname(pathname);
    setMobileOpen(false);
  }

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
    <>
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
          <Dropdown group={PUBLISH_GROUP} trigger="text" activeHref={pathname} />
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
          {connected && (
            <>
              <SessionModeSwitcher />
              <div className="sd-identity">
                {name && <div className="name">{name}</div>}
                <CopyableAddress
                  className="addr"
                  address={sessionActive ? signerAddress! : address!}
                />
              </div>
            </>
          )}
          <div className="sd-topnav-icons">
            <Dropdown group={systemGroup} trigger="icon" align="right" activeHref={pathname} />
            <Link
              href="/rss"
              className="sd-icon-btn"
              aria-label="RSS feed"
              title="RSS feed"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 11a9 9 0 0 1 9 9" />
                <path d="M4 4a16 16 0 0 1 16 16" />
                <circle cx="5" cy="19" r="1" fill="currentColor" />
              </svg>
            </Link>
          </div>
          {connected ? (
            <button
              className="sd-btn-ghost sd-disconnect-btn"
              onClick={disconnect}
              aria-label="Disconnect"
              title="Disconnect"
            >
              <svg className="sd-disconnect-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="sd-disconnect-label">Disconnect</span>
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="sd-btn sd-btn-primary sd-connect-btn"
              aria-label={connecting ? "Connecting" : "Connect wallet"}
              title="Connect wallet"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
              </svg>
              <span className="sd-connect-label">
                {connecting ? "Connecting..." : "Connect Wallet"}
              </span>
            </button>
          )}
        </div>
      </div>
    </header>

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
        systemGroup={systemGroup}
      />
    )}
    </>
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
  systemGroup,
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
  systemGroup: NavGroup;
}) {
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const renderLeaf = (l: NavLeaf) =>
    l.external ? (
      <a
        key={l.href}
        href={l.href}
        target="_blank"
        rel="noopener noreferrer"
        className="sd-mobile-link"
        onClick={onClose}
      >
        {l.icon}
        <div>
          <span className="label">{l.label}</span>
          {l.desc && <span className="desc">{l.desc}</span>}
        </div>
      </a>
    ) : (
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
            <div className="sd-mobile-heading">{PUBLISH_GROUP.label}</div>
            {PUBLISH_GROUP.items.map(renderLeaf)}
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
            <div className="sd-mobile-heading">{systemGroup.label}</div>
            {systemGroup.items.map(renderLeaf)}
          </div>
        </div>

        <div className="sd-mobile-foot">
          {connected ? (
            <>
              <div className="sd-mobile-identity">
                {name && <div className="name">{name}</div>}
                <CopyableAddress
                  className="addr"
                  address={sessionActive ? signerAddress! : address!}
                />
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
