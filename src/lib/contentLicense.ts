import type { ContentLicense } from "@/types/contentLicense";

/**
 * Spark Dream is an open-content chain: everything published on it is
 * dedicated to the public domain under CC0 1.0, and bridged-in content must
 * already be public domain. The chain serves the authoritative text from
 * Query/ContentLicense; these are the same compiled constants
 * (x/common/types/content_license.go), used until that query answers or when
 * it can't (an older node, archive mode).
 */
export const FALLBACK_CONTENT_LICENSE: ContentLicense = {
  license: "CC0-1.0",
  name: "CC0 1.0 Universal (Public Domain Dedication)",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  dedication:
    "Everything published on Spark Dream is dedicated to the public domain under CC0 1.0 Universal. " +
    "By submitting content you waive all copyright and related rights in it, worldwide, to the extent " +
    "the law allows, so that anyone may copy, modify, distribute and build on it, for any purpose, " +
    "without asking permission. Submit only work you have the right to dedicate this way.",
  accepted_federated_licenses: ["CC0-1.0", "PDM-1.0"],
};

/** The license id a member agrees to when accepting an invitation. */
export const CHAIN_CONTENT_LICENSE = FALLBACK_CONTENT_LICENSE.license;

/** Licenses revealed code may be released under (x/reveal final_license). */
export const OPEN_CODE_LICENSES: { id: string; label: string }[] = [
  { id: "Apache-2.0", label: "Apache License 2.0" },
  { id: "MIT", label: "MIT License" },
  { id: "CC0-1.0", label: "CC0 1.0 (public domain)" },
  { id: "Unlicense", label: "The Unlicense (public domain)" },
  { id: "BSD-3-Clause", label: "BSD 3-Clause" },
  { id: "BSD-2-Clause", label: "BSD 2-Clause" },
  { id: "ISC", label: "ISC License" },
  { id: "0BSD", label: "BSD Zero Clause" },
];

/** Display text for a federated record's license. */
export function licenseLabel(id: string | undefined): string {
  switch (id) {
    case "CC0-1.0":
      return "CC0 1.0 (public domain)";
    case "PDM-1.0":
      return "Public Domain Mark";
    case undefined:
    case "":
      return "No license recorded";
    default:
      return id;
  }
}

/** Where a license's legal text lives. */
export function licenseUrl(id: string | undefined): string | undefined {
  switch (id) {
    case "CC0-1.0":
      return "https://creativecommons.org/publicdomain/zero/1.0/";
    case "PDM-1.0":
      return "https://creativecommons.org/publicdomain/mark/1.0/";
    default:
      return undefined;
  }
}
