/**
 * Which FDA NDC Directory products CodeRx indexes.
 *
 * In scope: prescription drugs, plasma derivatives, vaccines, and cellular
 * therapies with at least one clinician-administered route — plus any product
 * with a package NDC that appears in an ingested CMS crosswalk (which brings in
 * oral anticancer, antiemetic, and inhalation drugs that CMS codes).
 */
import type { FdaProduct } from "./parsers/fda";

export const IN_SCOPE_PRODUCT_TYPES = new Set(["HUMAN PRESCRIPTION DRUG", "PLASMA DERIVATIVE", "VACCINE", "CELLULAR THERAPY"]);

export const CLINICIAN_ADMINISTERED_ROUTES = new Set([
  "INTRAVENOUS",
  "SUBCUTANEOUS",
  "INTRAMUSCULAR",
  "INTRADERMAL",
  "INTRATHECAL",
  "INTRAVITREAL",
  "INTRA-ARTICULAR",
  "INTRALESIONAL",
  "INTRAVESICAL",
  "EPIDURAL",
  "INTRAOCULAR",
  "INTRA-ARTERIAL",
  "INTRAPERITONEAL",
  "INTRAPLEURAL",
  "INTRACAVITARY",
  "INTRAVASCULAR",
  "PARENTERAL",
  "PERINEURAL",
  "INFILTRATION",
  "INTRACAUDAL",
  "SOFT TISSUE",
  "INTRASYNOVIAL",
  "INTRACARDIAC",
  "INTRAMEDULLARY",
  "RETROBULBAR",
  "INTRAVENTRICULAR",
  "INTRATYMPANIC",
  "SUBARACHNOID",
  "INTRACAMERAL",
  "INTRATUMORAL",
  "INTRAOSSEOUS",
  "INTRABURSAL",
  "INTRACAVERNOUS",
  "INTRALYMPHATIC",
  "INTRAUTERINE",
  "SUBCONJUNCTIVAL",
  "SUBRETINAL",
  "IMPLANTATION",
  "INTRACORONARY",
  "INTRASPINAL",
  "INTRATRACHEAL",
  "INTRADISCAL",
  "INTRAEPIDERMAL",
  "INTRALUMINAL",
  "INTRAPROSTATIC",
  "INTRASINAL",
  "PERIARTICULAR",
  "INTRAVENOUS DRIP",
  "INTRAVENOUS BOLUS",
  "INTRACISTERNAL",
  "INTRAPULMONARY",
  "INTRAPERICARDIAL",
  "INTRACORPORUS CAVERNOSUM",
  "SUBMUCOSAL",
  "INTRAGASTRIC",
  "ENDOTRACHEAL",
  "INTRAVASAL",
  "URETERAL",
  "INTRAEPICARDIAL",
  "INTRAPERIODONTAL",
  "PERIODONTAL",
  "SUBGINGIVAL",
  "INTRACORNEAL",
  "INTRAGINGIVAL",
]);

export function isClinicianAdministeredProduct(p: Pick<FdaProduct, "productType" | "routes">): boolean {
  if (!p.productType || !IN_SCOPE_PRODUCT_TYPES.has(p.productType.toUpperCase())) return false;
  return p.routes.some((r) => CLINICIAN_ADMINISTERED_ROUTES.has(r.toUpperCase()));
}

export const SCOPE_STATEMENT =
  "CodeRx indexes FDA-listed prescription drugs, plasma derivatives, vaccines, and cellular therapies given by clinician-administered routes, plus every product whose NDC appears in a CMS NDC–HCPCS crosswalk. Other products (for example, most oral and topical drugs) are outside this index.";
