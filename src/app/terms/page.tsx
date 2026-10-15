import type { Metadata } from "next";
import { Disclaimer, PageHeader } from "@/components/layout-bits";

export const metadata: Metadata = { title: "Terms of use", description: "Terms for using CodeRx reference data.", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return (
    <>
      <PageHeader title="Terms of use" />
      <div className="max-w-3xl space-y-6 text-ink-muted [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink">
        <Disclaimer />
        <section>
          <h2>Informational reference only</h2>
          <p className="mt-2">
            CodeRx republishes and organizes public government data. It is not a coding determination, coverage decision, or payment guarantee, and it is not legal, clinical, coding, or billing advice. You are responsible for verifying codes, units, payment amounts, and payer policies before submitting a claim.
          </p>
        </section>
        <section>
          <h2>No endorsement</h2>
          <p className="mt-2">CodeRx is not affiliated with, endorsed by, or sponsored by CMS, FDA, Medicare, NLM, any Medicare Administrative Contractor, or any payer or manufacturer.</p>
        </section>
        <section>
          <h2>Third-party content</h2>
          <p className="mt-2">
            HCPCS Level II codes are maintained by CMS. CPT® is a registered trademark of the American Medical Association and CPT content is not included in CodeRx. NDC Directory content is submitted by labelers to FDA. Links to government sites are provided for verification.
          </p>
        </section>
        <section>
          <h2>Acceptable use</h2>
          <p className="mt-2">Automated access to the API is welcome within published rate limits. Do not attempt to bypass rate limits, probe administrative endpoints, or submit patient information.</p>
        </section>
        <section>
          <h2>No warranty</h2>
          <p className="mt-2">Data may be incomplete, delayed, or contain errors from the original publishers or from processing. The service is provided “as is” without warranties of any kind.</p>
        </section>
      </div>
    </>
  );
}
