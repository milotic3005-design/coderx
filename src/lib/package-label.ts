/**
 * Facts read verbatim from an FDA NDC Directory package description, e.g.
 * "1 VIAL, SINGLE-DOSE in 1 CARTON (50242-051-21)  / 10 mL in 1 VIAL, SINGLE-DOSE".
 * Nothing is inferred beyond what the text states; unknown stays null.
 */
export interface PackageFacts {
  /** Volume of one inner container ("10 mL in 1 VIAL" → 10). */
  mlPerItem: number | null;
  /** Inner containers per package ("2 VIAL in 1 CARTON" → 2). */
  itemsPerPackage: number | null;
  /** Inner container type as written ("VIAL, SINGLE-DOSE"). */
  itemType: string | null;
  /** From the words SINGLE-DOSE / SINGLE-USE / MULTI-DOSE in the description. */
  containerType: "single-dose" | "multi-dose" | null;
  /** The description names a powder (to be reconstituted). */
  isPowder: boolean;
}

const NUM = String.raw`(\d*\.?\d+)`;

export function readPackageDescription(description: string | null | undefined): PackageFacts {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  const segments = text.split(/\s\/\s/).map((s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim());
  const outer = segments[0]?.match(new RegExp(`^${NUM} ([A-Z][A-Z ,-]*?) in 1 `, "i"));
  const inner = segments.at(-1) ?? "";
  const ml = inner.match(new RegExp(`^${NUM} mL in 1 ([A-Z][A-Z ,-]*)$`, "i"));
  const single = /\bSINGLE-(DOSE|USE)\b/i.test(text);
  const multi = /\bMULTI-DOSE\b/i.test(text);
  const isKit = /\bKIT\b/i.test(text);
  return {
    mlPerItem: ml && !isKit ? Number(ml[1]) : null,
    itemsPerPackage: outer && segments.length > 1 && !isKit ? Number(outer[1]) : null,
    itemType: ml ? ml[2].trim() : outer ? outer[2].trim() : null,
    containerType: single && !multi ? "single-dose" : multi && !single ? "multi-dose" : null,
    isPowder: /\bPOWDER\b/i.test(text),
  };
}
