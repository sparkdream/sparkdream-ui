/** GET /sparkdream/sparkdream/v1/content_license (x/sparkdream Query/ContentLicense). */
export interface ContentLicense {
  /** SPDX id everything on the chain is published under: "CC0-1.0". */
  license: string;
  name: string;
  url: string;
  /** The statement a participant makes by submitting content. */
  dedication: string;
  /** Licenses bridged-in content must carry: "CC0-1.0", "PDM-1.0". */
  accepted_federated_licenses: string[];
}
