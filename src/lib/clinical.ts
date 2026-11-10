/**
 * Label indications with common ICD-10-CM codes, keyed by HCPCS code, in two tiers that are never mixed up:
 *
 *  - reviewed: approved by a named reviewer (data/clinical-reference.json). Shown with the "Manually reviewed"
 *    badge, with the reviewer, and with the typical adult dose.
 *  - ai-draft: drafted by an AI model from its knowledge of the FDA label (data/clinical-drafts/*.json) and not checked
 *    by a person. Shown with the "AI-drafted, not verified" badge and WITHOUT a dose. Doses are the part of this data
 *    that can hurt a patient, so they appear only after a person has reviewed them.
 *
 * A reviewed entry replaces the draft with the same id. See scripts/clinical-review.ts for the review workflow.
 */
import { z } from "zod";
import reference from "../../data/clinical-reference.json";
import batch01 from "../../data/clinical-drafts/batch-01.json";
import batch02 from "../../data/clinical-drafts/batch-02.json";
import { HCPCS_LEVEL2_RE } from "./hcpcs";

/** ICD-10-CM shape: letter, digit, alphanumeric, then an optional dot and 1–4 characters (e.g. A41.9, T84.50XA). */
export const ICD10CM_RE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const icd10 = z.object({
  code: z.string().regex(ICD10CM_RE, "not an ICD-10-CM code"),
  description: z.string().optional(),
});

const indicationBase = z.object({
  condition: z.string().min(3),
  icd10: z.array(icd10).min(1),
});
/** A draft may leave the dose out (newer batches do): it is never published unreviewed, and the reviewer fills it in. */
const draftIndication = indicationBase.extend({ dose: z.string().min(5).optional() });
/** A reviewed entry always carries the dose the reviewer approved. */
const reviewedIndication = indicationBase.extend({ dose: z.string().min(5) });

export const draftEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and dashes"),
  drug: z.string().min(2),
  hcpcs: z.array(z.string().regex(HCPCS_LEVEL2_RE, "not a HCPCS Level II code")).min(1),
  indications: z.array(draftIndication).min(1),
  evidence: z.array(z.object({ label: z.string().min(3), url: z.string().url() })).min(1),
  /** Internal to-verify notes for the reviewer; never published. */
  notes: z.string().optional(),
});

export const reviewedEntrySchema = draftEntrySchema.extend({
  indications: z.array(reviewedIndication).min(1),
  reviewer: z.string().min(3),
  reviewedAt: z.string().regex(DATE_RE, "YYYY-MM-DD"),
});

export type DraftEntry = z.infer<typeof draftEntrySchema>;
export type ClinicalEntry = z.infer<typeof reviewedEntrySchema>;

export const referenceFileSchema = z.object({ $comment: z.string().optional(), entries: z.array(reviewedEntrySchema) });
export const draftFileSchema = z.object({ $comment: z.string().optional(), draftedAt: z.string().regex(DATE_RE, "YYYY-MM-DD"), entries: z.array(draftEntrySchema) });

/** What the site and the API publish for one drug. `dose`, `reviewer`, and `notes` exist only on reviewed entries. */
export interface PublishedEntry {
  id: string;
  drug: string;
  hcpcs: string[];
  status: "reviewed" | "ai-draft";
  indications: { condition: string; icd10: { code: string; description?: string }[]; dose?: string }[];
  evidence: { label: string; url: string }[];
  notes?: string;
  reviewer?: string;
  reviewedAt?: string;
  draftedAt?: string;
}

export type DraftWithDate = DraftEntry & { draftedAt: string };

/** Every draft batch; add a file to data/clinical-drafts/ and to this list. Validated once, so a bad file fails the build. */
export const DRAFT_FILES: unknown[] = [batch01, batch02];

export function loadDrafts(files: unknown[] = DRAFT_FILES): DraftWithDate[] {
  return files.flatMap((f) => {
    const parsed = draftFileSchema.parse(f);
    return parsed.entries.map((e) => ({ ...e, draftedAt: parsed.draftedAt }));
  });
}

const REVIEWED: ClinicalEntry[] = referenceFileSchema.parse(reference).entries;
const DRAFTS: DraftWithDate[] = loadDrafts();

/** Entries for any of these HCPCS codes, each once; a reviewed entry replaces the draft with the same id. */
export function clinicalFor(codes: string[], reviewed: ClinicalEntry[] = REVIEWED, drafts: DraftWithDate[] = DRAFTS): PublishedEntry[] {
  const wanted = new Set(codes);
  const hit = (e: { hcpcs: string[] }) => e.hcpcs.some((c) => wanted.has(c));
  const reviewedIds = new Set(reviewed.map((e) => e.id));
  return [
    ...reviewed.filter(hit).map(
      (e): PublishedEntry => ({
        id: e.id,
        drug: e.drug,
        hcpcs: e.hcpcs,
        status: "reviewed",
        indications: e.indications,
        evidence: e.evidence,
        ...(e.notes ? { notes: e.notes } : {}),
        reviewer: e.reviewer,
        reviewedAt: e.reviewedAt,
      }),
    ),
    ...drafts
      .filter((d) => !reviewedIds.has(d.id) && hit(d))
      .map(
        (d): PublishedEntry => ({
          id: d.id,
          drug: d.drug,
          hcpcs: d.hcpcs,
          status: "ai-draft",
          // The dose is left out on purpose, not just hidden: the API returns this object as is.
          indications: d.indications.map(({ condition, icd10: codes }) => ({ condition, icd10: codes })),
          evidence: d.evidence,
          draftedAt: d.draftedAt,
        }),
      ),
  ];
}

/** FDA labels on DailyMed (NLM) for a search term. */
export function dailyMedSearchUrl(query: string): string {
  return `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(query)}`;
}
