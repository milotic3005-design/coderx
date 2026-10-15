import type { Metadata } from "next";
import { PageHeader } from "@/components/layout-bits";

export const metadata: Metadata = { title: "Privacy", description: "What CodeRx collects (very little) and what it never collects.", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy" subtitle="CodeRx is a reference tool. It is designed to work without collecting personal or patient information." />
      <div className="max-w-3xl space-y-6 text-ink-muted [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>No protected health information</h2>
          <p className="mt-2">CodeRx has no fields for patient names, dates of birth, medical record numbers, diagnoses, or claim identifiers. Please do not type patient information into the search box or calculator.</p>
        </section>
        <section>
          <h2>No accounts or tracking cookies</h2>
          <p className="mt-2">There are no user accounts. CodeRx does not set advertising or tracking cookies. If the operator enables Vercel Web Analytics, it collects aggregate, cookieless page-view statistics.</p>
        </section>
        <section>
          <h2>Searches and logs</h2>
          <p className="mt-2">Search requests are processed to return results. Application logs record errors and timing but are designed not to store your query text. The hosting provider may keep standard request logs (such as IP address and user agent) for security and operations.</p>
        </section>
        <section>
          <h2>Data stored in your browser</h2>
          <p className="mt-2">Your recent searches and recently viewed pages are saved only in your own browser’s local storage so you can return to them. They are never sent to CodeRx. You can remove them with the “Clear” button on the home page or by clearing site data in your browser.</p>
        </section>
      </div>
    </>
  );
}
