import { licenseLabel, licenseUrl } from "@/lib/contentLicense";

/** The license a federated record entered the chain under. */
export default function LicenseBadge({ license }: { license?: string }) {
  const url = licenseUrl(license);
  const label = licenseLabel(license);
  const body = (
    <span className="sd-license-badge" title={label}>
      {license === "PDM-1.0" ? "PD" : license === "CC0-1.0" ? "CC0" : license || "?"}
    </span>
  );
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={label} className="no-underline">
      {body}
    </a>
  ) : (
    body
  );
}
