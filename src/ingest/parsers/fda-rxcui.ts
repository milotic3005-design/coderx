/**
 * The product NDC to RxCUI link from openFDA's bulk NDC file. CMS's Part D files carry only a
 * proxy NDC for each RxCUI, so this is what connects most FDA products to them. Nothing else
 * in the file is kept; the NDC directory itself comes from FDA's own download.
 */
import { toProductNdc9 } from "@/lib/ndc";

interface OpenFdaFile {
  results?: { product_ndc?: string; openfda?: { rxcui?: string[] } }[];
}

export function parseOpenFdaRxcui(json: string): { rows: { productNdc9: string; rxcui: string }[]; productsWithoutRxcui: number } {
  const seen = new Set<string>();
  const rows: { productNdc9: string; rxcui: string }[] = [];
  let productsWithoutRxcui = 0;
  for (const product of (JSON.parse(json) as OpenFdaFile).results ?? []) {
    const productNdc9 = product.product_ndc ? toProductNdc9(product.product_ndc) : null;
    const rxcuis = product.openfda?.rxcui ?? [];
    if (!productNdc9) continue;
    if (!rxcuis.length) productsWithoutRxcui++;
    for (const rxcui of rxcuis) {
      const key = `${productNdc9}|${rxcui}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ productNdc9, rxcui });
    }
  }
  return { rows, productsWithoutRxcui };
}
