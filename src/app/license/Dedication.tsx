"use client";

import { useContentLicense } from "@/hooks/useContentLicense";

/** The dedication statement as the chain serves it (Query/ContentLicense). */
export default function Dedication() {
  const license = useContentLicense();
  return (
    <blockquote className="sd-license-dedication">
      {license.dedication}{" "}
      <a href={license.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--violet-hi)", textDecoration: "underline" }}>
        {license.name}
      </a>
    </blockquote>
  );
}
