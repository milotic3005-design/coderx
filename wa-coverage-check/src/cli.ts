/** npm run check -- "Humira" "Regence" : prints coverage rows and the date of each source. */
import { checkCoverage } from "./check-coverage.ts";

const [drug, planFilter] = process.argv.slice(2);
if (!drug) {
  console.error('Usage: npm run check -- "<drug name>" ["<plan filter>"]');
  process.exit(1);
}
const result = await checkCoverage(drug, planFilter);
if (!result.match) {
  console.log(`RxNorm found no drug products for "${drug}", so no formulary can be checked.`);
  process.exit(0);
}
console.log(`${drug} -> RxNorm "${result.match.matchedName}" (${result.match.rxcuis.length} RxCUIs, ${result.match.ndcs.length} NDCs)\n`);
for (const r of result.rows) {
  console.log(`${r.plan}\n  covered: ${r.covered} | tier: ${r.tier ?? "-"} | PA: ${r.priorAuth} | step: ${r.stepTherapy} | QL: ${r.quantityLimit} | benefit: ${r.benefitType}`);
  if (r.costSharing) console.log(`  cost sharing: ${r.costSharing}`);
  if (r.reason) console.log(`  note: ${r.reason}`);
  console.log(`  source: ${r.asOfDate}`);
}
const p = result.referencePrice!;
console.log(`\n${p.label}`);
for (const x of p.prices) console.log(`  ${x.product} (${x.brandOrGeneric}): $${x.low.toFixed(5)}${x.high > x.low ? ` to $${x.high.toFixed(5)}` : ""} per ${x.unit}, ${x.ndcCount} NDC${x.ndcCount > 1 ? "s" : ""}, effective ${x.effectiveDate}`);
console.log(`  note: ${p.reason}`);
console.log(`  source: ${p.asOfDate}, ${p.sourceUrl}`);
