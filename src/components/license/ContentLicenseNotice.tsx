import Link from "next/link";

interface ContentLicenseNoticeProps {
  /** What is being published, for the sentence: "Your dream", "This reply". */
  what?: string;
  className?: string;
}

/**
 * One line beside every submit button that publishes text: everything on
 * Spark Dream is public domain (CC0), so the author should know before they
 * publish, and should only submit what they have the right to give away.
 */
export default function ContentLicenseNotice({ what = "What you publish", className = "" }: ContentLicenseNoticeProps) {
  return (
    <p className={`sd-license-notice ${className}`}>
      <span className="sd-license-badge" aria-hidden>CC0</span>
      <span>
        {what} goes into the public domain under{" "}
        <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">
          CC0 1.0
        </a>
        : anyone may reuse it for any purpose. Only submit work you have the right to give away.{" "}
        <Link href="/license">Why?</Link>
      </span>
    </p>
  );
}
