// How the Status page judges TLS certificates: each address the app reads
// through (the chain's REST API and RPC, the explorer, where images are
// served from) sits behind one, and one that expires takes its service away
// from every browser at once, with nothing else wrong. Certificates renew
// on their own nearly always, which is why the day one doesn't goes
// unnoticed until it is too late. This file only judges; lib/siteStatus.ts
// asks each host for its certificate.

import { formatAge, type ServiceFact, type ServiceReport } from "./serviceStatus";

export interface CertReading {
  host: string;
  /** When the certificate stops being valid, epoch ms. Null when it couldn't be read. */
  expiresAt: number | null;
  /**
   * Why a browser would refuse it now (expired, wrong name, unknown issuer),
   * in the TLS library's short words. Null when it is accepted.
   */
  refused: string | null;
  /** True when the host didn't answer at all. */
  unreachable: boolean;
}

// Automatic renewal happens about a month before expiry. A certificate this
// close to its end has missed its renewal.
export const CERT_WARN_MS = 14 * 86_400_000;

export function assessCerts(readings: CertReading[], now: number): ServiceReport {
  const id = "certificates";
  if (readings.length === 0) {
    return { id, state: "off", issues: ["No https address is set up to check."], latency_ms: null, facts: [] };
  }
  const issues: string[] = [];
  const facts: ServiceFact[] = [];
  for (const r of readings) {
    const left = r.expiresAt !== null ? r.expiresAt - now : null;
    if (r.unreachable) {
      facts.push({ label: r.host, value: "Not checked, the host didn't answer" });
    } else if (left !== null && left <= 0) {
      facts.push({ label: r.host, value: `Expired ${formatAge(-left)} ago` });
      issues.push(`The certificate of ${r.host} expired ${formatAge(-left)} ago, so browsers refuse to connect to it.`);
    } else if (r.refused) {
      facts.push({ label: r.host, value: "Not accepted" });
      issues.push(`The certificate of ${r.host} isn't accepted (${r.refused}), so browsers refuse to connect to it.`);
    } else if (left !== null) {
      facts.push({ label: r.host, value: `Expires in ${formatAge(left)}` });
      if (left < CERT_WARN_MS) {
        issues.push(`The certificate of ${r.host} expires in ${formatAge(left)} and hasn't been renewed.`);
      }
    } else {
      facts.push({ label: r.host, value: "Unreadable" });
    }
  }
  return { id, state: issues.length ? "degraded" : "ok", issues, latency_ms: null, facts };
}

/** The distinct https hosts among some addresses, in the order given. Port 443 only. */
export function httpsHosts(urls: (string | undefined)[]): string[] {
  const hosts: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const u = new URL(raw.replace("{id}", "x"));
      if (u.protocol === "https:" && (!u.port || u.port === "443") && !hosts.includes(u.hostname)) hosts.push(u.hostname);
    } catch {
      // Not an address: nothing to check.
    }
  }
  return hosts;
}
