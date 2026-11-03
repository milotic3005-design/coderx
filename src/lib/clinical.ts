/**
 * Pharmacist-reviewed clinical reference: label indications, common ICD-10-CM codes,
 * and a one-line typical adult dose, keyed by HCPCS code. Entries are drafted from the
 * FDA label and appear on the site only after a named reviewer approves them
 * (data/clinical-reference.json); drafts live in data/clinical-drafts/ and are never
 * shown. See scripts/clinical-review.ts for the export → review → import workflow.
 */
import { z } from "zod";
import reference from "../../data/clinical-reference.json";
import { HCPCS_LEVEL2_RE } from "./hcpcs";

/** ICD-10-CM shape: letter, digit, alphanumeric, then an optional dot and 1–4 characters (e.g. A41.9, T84.50XA). */
export const ICD10CM_RE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

const icd10 = z.object({
  code: z.string().regex(ICD10CM_RE, "not an ICD-10-CM code"),
  description: z.string().optional(),
});

const indication = z.object({
  condition: z.string().min(3),
  icd10: z.array(icd10).min(1),
  dose: z.string().min(5),
});

export const draftEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and dashes"),
  drug: z.string().min(2),
  hcpcs: z.array(z.string().regex(HCPCS_LEVEL2_RE, "not a HCPCS Level II code")).min(1),
  indications: z.array(indication).min(1),
  evidence: z.array(z.object({ label: z.string().min(3), url: z.string().url() })).min(1),
  notes: z.string().optional(),
});

export const reviewedEntrySchema = draftEntrySchema.extend({
  reviewer: z.string().min(3),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
});

export type DraftEntry = z.infer<typeof draftEntrySchema>;
export type ClinicalEntry = z.infer<typeof reviewedEntrySchema>;

export const referenceFileSchema = z.object({ $comment: z.string().optional(), entries: z.array(reviewedEntrySchema) });
export const draftFileSchema = z.object({ $comment: z.string().optional(), entries: z.array(draftEntrySchema) });

/** The reviewed file, validated once; an invalid file fails the build rather than showing unreviewed data. */
const REVIEWED: ClinicalEntry[] = referenceFileSchema.parse(reference).entries;

/** Reviewed entries for any of these HCPCS codes, each entry once. */
export function clinicalFor(codes: string[], entries: ClinicalEntry[] = REVIEWED): ClinicalEntry[] {
  const wanted = new Set(codes);
  return entries.filter((e) => e.hcpcs.some((c) => wanted.has(c)));
}

/** FDA labels on DailyMed (NLM) for a search term. */
export function dailyMedSearchUrl(query: string): string {
  return `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(query)}`;
}
