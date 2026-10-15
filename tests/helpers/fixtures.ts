/**
 * Serve real CMS/FDA fixture excerpts (tests/fixtures) through the ingestion
 * pipeline's fetcher hook, packaged the way the publishers package them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { sha256, type Downloaded } from "@/ingest/fetch";
import type { ReleaseCandidate } from "@/ingest/sources";

export const FIXTURE_DIR = join(__dirname, "..", "fixtures");
const read = (name: string) => new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));

export const FIXTURE_URLS = {
  hcpcs2025q4: "https://www.cms.gov/files/zip/october-2025-alpha-numeric-hcpcs-file.zip",
  hcpcs2026q4: "https://www.cms.gov/files/zip/october-2026-alpha-numeric-hcpcs-file.zip",
  payment2026q3: "https://www.cms.gov/files/zip/july-2026-medicare-part-b-payment-limit-files.zip",
  payment2026q4: "https://www.cms.gov/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip",
  crosswalk2026q4: "https://www.cms.gov/files/zip/october-2026-ndc-hcpcs-crosswalk-final.zip",
  fdaNdc: "https://www.accessdata.fda.gov/cder/ndctext.zip",
  fdaExcluded: "https://www.accessdata.fda.gov/cder/ndc_excluded.zip",
  purpleBook: "https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-September-data-download.csv",
} as const;

function archive(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 6 });
}

/** Bytes served for each fixture URL. Built once per process. */
let cache: Map<string, Uint8Array> | null = null;
function bodies(): Map<string, Uint8Array> {
  if (cache) return cache;
  cache = new Map([
    [FIXTURE_URLS.hcpcs2025q4, archive({ "HCPC2025_OCT_ANWEB_v4.txt": read("hcpcs-2025q4.txt") })],
    [FIXTURE_URLS.hcpcs2026q4, archive({ "HCPC2026_OCT_ANWEB_09232026.txt": read("hcpcs-2026q4.txt"), "NOC codes_OCT2026.xlsx": read("noc-codes-2026q4.xlsx") })],
    [FIXTURE_URLS.payment2026q3, archive({ "section 508 verfsion of July 2026 Medicare Part B Payment Limit File updated 091526.csv": read("payment-2026q3.csv") })],
    [
      FIXTURE_URLS.payment2026q4,
      archive({
        "section 508 version of October 2026 Medicare Part B Payment Limit File 091626.csv": read("payment-2026q4.csv"),
        "section 508 version of October 2026 Drugs Not Payable Under Part B 091426.csv": read("not-payable-2026q4.csv"),
      }),
    ],
    [
      FIXTURE_URLS.crosswalk2026q4,
      archive({
        "section 508 version of October 2026 ASP NDC-HCPCS Crosswalk 091126.csv": read("crosswalk-asp-2026q4.csv"),
        "section 508 version of October 2026 OPPS NDC-HCPCS Crosswalk 090426.csv": read("crosswalk-opps-2026q4.csv"),
      }),
    ],
    [FIXTURE_URLS.fdaNdc, archive({ "product.txt": read("fda-product.txt"), "package.txt": read("fda-package.txt") })],
    [FIXTURE_URLS.fdaExcluded, archive({ "Products_excluded.txt": read("fda-products-excluded.txt"), "Packages_excluded.txt": read("fda-packages-excluded.txt") })],
    [FIXTURE_URLS.purpleBook, read("purplebook.csv")],
  ]);
  return cache;
}

export function fixtureFetcher(overrides: Record<string, Uint8Array> = {}) {
  return async (url: string): Promise<Downloaded> => {
    const bytes = overrides[url] ?? bodies().get(url);
    if (!bytes) throw new Error(`No fixture for ${url}`);
    return {
      url,
      bytes,
      sha256: sha256(bytes),
      byteSize: bytes.length,
      lastModified: "Wed, 14 Oct 2026 08:15:27 GMT",
      etag: null,
      contentType: null,
      fromCache: false,
    };
  };
}

export const FIXTURE_RELEASES: ReleaseCandidate[] = [
  { sourceKey: "cms_hcpcs", period: "2025-Q4", url: FIXTURE_URLS.hcpcs2025q4, publicationLabel: "Updated 09/23/2025", publicationDate: "2025-09-23" },
  { sourceKey: "cms_hcpcs", period: "2026-Q4", url: FIXTURE_URLS.hcpcs2026q4, publicationLabel: "Updated 09/23/2026", publicationDate: "2026-09-23" },
  { sourceKey: "cms_payment_limits", period: "2026-Q3", url: FIXTURE_URLS.payment2026q3, publicationLabel: "Final file - revised 09/15/2026", publicationDate: "2026-09-15" },
  { sourceKey: "cms_payment_limits", period: "2026-Q4", url: FIXTURE_URLS.payment2026q4, publicationLabel: "09/17/2026 - Final file", publicationDate: "2026-09-17" },
  { sourceKey: "cms_ndc_hcpcs", period: "2026-Q4", url: FIXTURE_URLS.crosswalk2026q4, publicationLabel: "09/17/2026 - Final file", publicationDate: "2026-09-17" },
  { sourceKey: "fda_ndc", period: null, url: FIXTURE_URLS.fdaNdc },
  { sourceKey: "fda_ndc_excluded", period: null, url: FIXTURE_URLS.fdaExcluded },
  { sourceKey: "fda_purple_book", period: "2026-09", url: FIXTURE_URLS.purpleBook, publicationLabel: "September 2026 data download" },
];

export { strToU8 };
