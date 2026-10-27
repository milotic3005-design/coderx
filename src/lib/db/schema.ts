import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const emptyTextArray = sql`'{}'::text[]`;

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export const sourceReleases = pgTable(
  "source_releases",
  {
    id: serial("id").primaryKey(),
    sourceKey: text("source_key").notNull(),
    organization: text("organization").notNull(),
    dataset: text("dataset").notNull(),
    /** "2026-Q4" for quarterly CMS files, "2026-10-14" for daily FDA snapshots, "2026-09" for monthly. */
    periodLabel: text("period_label"),
    fileName: text("file_name"),
    downloadUrl: text("download_url").notNull(),
    landingPageUrl: text("landing_page_url"),
    publicationDate: date("publication_date"),
    publicationLabel: text("publication_label"),
    effectiveStart: date("effective_start"),
    effectiveEnd: date("effective_end"),
    importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    checksumSha256: text("checksum_sha256"),
    byteSize: integer("byte_size"),
    recordCount: integer("record_count"),
    /** succeeded | failed | superseded */
    status: text("status").notNull(),
    /** The release whose rows are served for (source_key, period_label). */
    isCurrent: boolean("is_current").notNull().default(false),
    report: jsonb("report"),
    error: text("error"),
  },
  (t) => [
    index("source_releases_key_period_idx").on(t.sourceKey, t.periodLabel),
    uniqueIndex("source_releases_succeeded_checksum_uq")
      .on(t.sourceKey, t.periodLabel, t.checksumSha256)
      .where(sql`${t.status} = 'succeeded'`),
  ],
);

export const importRuns = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  /** cli | cron | admin */
  trigger: text("trigger").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  /** running | succeeded | partial | failed */
  status: text("status").notNull(),
  summary: jsonb("summary"),
});

/* ------------------------------------------------------------------ */
/* CMS HCPCS                                                           */
/* ------------------------------------------------------------------ */

/** Raw per-quarter HCPCS records; `hcpcs_codes` and `hcpcs_code_history` are rebuilt from these. */
export const hcpcsSnapshots = pgTable(
  "hcpcs_snapshots",
  {
    id: serial("id").primaryKey(),
    period: text("period").notNull(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    code: text("code").notNull(),
    shortDescription: text("short_description"),
    longDescription: text("long_description").notNull(),
    pricingIndicators: text("pricing_indicators").array().notNull().default(emptyTextArray),
    multiplePricingIndicator: text("multiple_pricing_indicator"),
    coverageCode: text("coverage_code"),
    betos: text("betos"),
    typeOfService: text("type_of_service").array().notNull().default(emptyTextArray),
    crossReferences: text("cross_references").array().notNull().default(emptyTextArray),
    processingNote: text("processing_note"),
    addedDate: date("added_date"),
    actionEffectiveDate: date("action_effective_date"),
    terminationDate: date("termination_date"),
    actionCode: text("action_code"),
    isNoc: boolean("is_noc").notNull().default(false),
  },
  (t) => [
    uniqueIndex("hcpcs_snapshots_uq").on(t.period, t.code, t.sourceReleaseId),
    index("hcpcs_snapshots_code_idx").on(t.code),
  ],
);

export const hcpcsCodes = pgTable(
  "hcpcs_codes",
  {
    code: text("code").primaryKey(),
    family: text("family").notNull(),
    shortDescription: text("short_description"),
    longDescription: text("long_description").notNull(),
    pricingIndicators: text("pricing_indicators").array().notNull().default(emptyTextArray),
    multiplePricingIndicator: text("multiple_pricing_indicator"),
    coverageCode: text("coverage_code"),
    betos: text("betos"),
    typeOfService: text("type_of_service").array().notNull().default(emptyTextArray),
    crossReferences: text("cross_references").array().notNull().default(emptyTextArray),
    processingNote: text("processing_note"),
    addedDate: date("added_date"),
    actionEffectiveDate: date("action_effective_date"),
    terminationDate: date("termination_date"),
    actionCode: text("action_code"),
    isNoc: boolean("is_noc").notNull().default(false),
    isDrug: boolean("is_drug").notNull().default(false),
    firstSeenPeriod: text("first_seen_period"),
    lastSeenPeriod: text("last_seen_period"),
    /** True when the code is absent from the latest HCPCS file (kept for history). */
    droppedFromFile: boolean("dropped_from_file").notNull().default(false),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
  },
  (t) => [index("hcpcs_codes_family_idx").on(t.family)],
);

export const hcpcsCodeHistory = pgTable(
  "hcpcs_code_history",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    period: text("period").notNull(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    /** baseline | added | descriptor_changed | terminated | reactivated | dates_changed | removed_from_file */
    changeType: text("change_type").notNull(),
    actionCode: text("action_code"),
    shortDescription: text("short_description"),
    longDescription: text("long_description"),
    addedDate: date("added_date"),
    actionEffectiveDate: date("action_effective_date"),
    terminationDate: date("termination_date"),
    previous: jsonb("previous"),
  },
  (t) => [
    index("hcpcs_code_history_code_idx").on(t.code),
    uniqueIndex("hcpcs_code_history_uq").on(t.code, t.period, t.changeType),
  ],
);

/* ------------------------------------------------------------------ */
/* CMS payment limits and crosswalks                                    */
/* ------------------------------------------------------------------ */

export const paymentLimits = pgTable(
  "payment_limits",
  {
    id: serial("id").primaryKey(),
    hcpcsCode: text("hcpcs_code").notNull(),
    period: text("period").notNull(),
    effectiveStart: date("effective_start").notNull(),
    effectiveEnd: date("effective_end").notNull(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    shortDescription: text("short_description"),
    dosageDescriptor: text("dosage_descriptor"),
    paymentLimit: numeric("payment_limit", { precision: 14, scale: 3 }),
    paymentLimitText: text("payment_limit_text"),
    coinsurancePct: numeric("coinsurance_pct", { precision: 7, scale: 3 }),
    vaccineAwpPct: numeric("vaccine_awp_pct", { precision: 7, scale: 3 }),
    vaccineLimit: numeric("vaccine_limit", { precision: 14, scale: 3 }),
    bloodAwpPct: numeric("blood_awp_pct", { precision: 7, scale: 3 }),
    bloodLimit: numeric("blood_limit", { precision: 14, scale: 3 }),
    clottingFactor: text("clotting_factor"),
    notes: text("notes"),
    aspDataPeriod: text("asp_data_period"),
    /** Derived label from the published columns/notes (never inferred from outside sources). */
    methodology: text("methodology"),
  },
  (t) => [
    uniqueIndex("payment_limits_uq").on(t.hcpcsCode, t.period, t.sourceReleaseId),
    index("payment_limits_code_idx").on(t.hcpcsCode),
    index("payment_limits_release_idx").on(t.sourceReleaseId),
  ],
);

export const partBNotPayable = pgTable(
  "part_b_not_payable",
  {
    id: serial("id").primaryKey(),
    hcpcsCode: text("hcpcs_code").notNull(),
    period: text("period").notNull(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    description: text("description"),
    manufacturer: text("manufacturer"),
  },
  (t) => [index("part_b_not_payable_code_idx").on(t.hcpcsCode)],
);

export const ndcHcpcsCrosswalk = pgTable(
  "ndc_hcpcs_crosswalk",
  {
    id: serial("id").primaryKey(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    period: text("period").notNull(),
    effectiveStart: date("effective_start"),
    effectiveEnd: date("effective_end"),
    /** ASP | OPPS | AWP | PREP | NOC */
    crosswalkType: text("crosswalk_type").notNull(),
    hcpcsCode: text("hcpcs_code"),
    shortDescription: text("short_description"),
    nocGenericName: text("noc_generic_name"),
    labelerName: text("labeler_name"),
    ndcRaw: text("ndc_raw").notNull(),
    ndc11: text("ndc11"),
    drugName: text("drug_name"),
    hcpcsDosage: text("hcpcs_dosage"),
    packageSize: numeric("package_size"),
    packageQuantity: numeric("package_quantity"),
    billUnitsPerItem: numeric("bill_units_per_item"),
    billUnitsPerPackage: numeric("bill_units_per_package"),
  },
  (t) => [
    index("ndc_hcpcs_crosswalk_ndc_idx").on(t.ndc11),
    index("ndc_hcpcs_crosswalk_code_idx").on(t.hcpcsCode),
    index("ndc_hcpcs_crosswalk_release_idx").on(t.sourceReleaseId),
    index("ndc_hcpcs_crosswalk_period_type_idx").on(t.period, t.crosswalkType),
  ],
);

/**
 * CMS NCCI Medically Unlikely Edits — HCPCS Level II rows only (CPT rows are dropped).
 * One row per code, service type, and release; the current release for the newest
 * period is served.
 */
/**
 * CMS OPPS Addendum B: hospital outpatient status indicator, APC, and national payment
 * rate per HCPCS Level II code for a quarter (no CPT rows are stored).
 */
export const oppsRates = pgTable(
  "opps_rates",
  {
    id: serial("id").primaryKey(),
    hcpcsCode: text("hcpcs_code").notNull(),
    period: text("period").notNull(),
    statusIndicator: text("status_indicator"),
    apc: text("apc"),
    relativeWeight: numeric("relative_weight", { precision: 12, scale: 4 }),
    paymentRate: numeric("payment_rate", { precision: 14, scale: 3 }),
    nationalCopay: numeric("national_copay", { precision: 14, scale: 3 }),
    minimumCopay: numeric("minimum_copay", { precision: 14, scale: 3 }),
    iraCoinsurancePct: numeric("ira_coinsurance_pct", { precision: 7, scale: 3 }),
    adjustedCopay: numeric("adjusted_copay", { precision: 14, scale: 3 }),
    passThroughExpiration: text("pass_through_expiration"),
    note: text("note"),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
  },
  (t) => [index("opps_rates_code_idx").on(t.hcpcsCode), index("opps_rates_release_idx").on(t.sourceReleaseId)],
);

/** CMS OPPS Addendum A: national payment rate per APC (CMS group titles) for a quarter. */
export const oppsApcRates = pgTable(
  "opps_apc_rates",
  {
    id: serial("id").primaryKey(),
    apc: text("apc").notNull(),
    period: text("period").notNull(),
    title: text("title"),
    statusIndicator: text("status_indicator"),
    relativeWeight: numeric("relative_weight", { precision: 12, scale: 4 }),
    paymentRate: numeric("payment_rate", { precision: 14, scale: 3 }),
    nationalCopay: numeric("national_copay", { precision: 14, scale: 3 }),
    minimumCopay: numeric("minimum_copay", { precision: 14, scale: 3 }),
    iraCoinsurancePct: numeric("ira_coinsurance_pct", { precision: 7, scale: 3 }),
    adjustedCopay: numeric("adjusted_copay", { precision: 14, scale: 3 }),
    passThroughExpiration: text("pass_through_expiration"),
    note: text("note"),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
  },
  (t) => [index("opps_apc_rates_apc_idx").on(t.apc), index("opps_apc_rates_release_idx").on(t.sourceReleaseId)],
);

/** One published state Medicaid fee schedule row (e.g. Washington HCA home infusion). */
export const stateFeeSchedule = pgTable(
  "state_fee_schedule",
  {
    id: serial("id").primaryKey(),
    /** USPS state code, e.g. "WA". */
    state: text("state").notNull(),
    program: text("program").notNull(),
    hcpcsCode: text("hcpcs_code").notNull(),
    modifier: text("modifier"),
    /** Publisher's status indicator, verbatim (e.g. "L/R"). */
    statusIndicator: text("status_indicator"),
    /** Maximum allowable fee per payment area as published; amount is null for text such as "BR" or "N/A". */
    fees: jsonb("fees").$type<{ area: string; amount: string | null; text: string }[]>().notNull(),
    /** Prior-authorization column, verbatim (e.g. "PA", "EPA"). */
    priorAuth: text("prior_auth"),
    comments: text("comments"),
    effectiveDate: date("effective_date").notNull(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
  },
  (t) => [index("state_fee_schedule_code_idx").on(t.hcpcsCode), index("state_fee_schedule_release_idx").on(t.sourceReleaseId)],
);

export const mueValues = pgTable(
  "mue_values",
  {
    id: serial("id").primaryKey(),
    hcpcsCode: text("hcpcs_code").notNull(),
    /** practitioner | outpatient_hospital | dme_supplier */
    serviceType: text("service_type").notNull(),
    period: text("period").notNull(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    mueValue: integer("mue_value").notNull(),
    /** 1 = line edit, 2 = date-of-service edit (policy), 3 = date-of-service edit (clinical) */
    adjudicationIndicator: integer("adjudication_indicator"),
    /** Published indicator text, verbatim (e.g. "3 Date of Service Edit: Clinical"). */
    adjudicationText: text("adjudication_text"),
    rationale: text("rationale"),
  },
  (t) => [
    uniqueIndex("mue_values_uq").on(t.hcpcsCode, t.serviceType, t.sourceReleaseId),
    index("mue_values_code_idx").on(t.hcpcsCode),
    index("mue_values_release_idx").on(t.sourceReleaseId),
  ],
);

/**
 * CMS "Drug Products in the Medicaid Drug Rebate Program" — one quarter, limited to
 * NDCs CodeRx indexes (FDA directory packages and CMS-crosswalked NDCs).
 */
export const mdrpProducts = pgTable(
  "mdrp_products",
  {
    id: serial("id").primaryKey(),
    ndc11: text("ndc11").notNull(),
    period: text("period").notNull(),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    labelerName: text("labeler_name"),
    fdaProductName: text("fda_product_name"),
    /** As published: EA, ML, GM, AHF, TAB, CAP, SUP, TDP (and occasionally other values, e.g. MCI). */
    unitType: text("unit_type"),
    unitsPerPackage: numeric("units_per_package"),
    /** S single source, I innovator multiple source, N non-innovator multiple source */
    drugCategory: text("drug_category"),
    /** 1 Rx, 2 OTC */
    drugType: text("drug_type"),
    codStatus: text("cod_status"),
    terminationDate: date("termination_date"),
    reactivationDate: date("reactivation_date"),
    marketDate: date("market_date"),
    clottingFactor: boolean("clotting_factor"),
    lineExtension: text("line_extension"),
    applicationNumber: text("application_number"),
  },
  (t) => [uniqueIndex("mdrp_products_uq").on(t.ndc11, t.sourceReleaseId), index("mdrp_products_ndc_idx").on(t.ndc11)],
);

/* ------------------------------------------------------------------ */
/* FDA NDC Directory and Purple Book                                    */
/* ------------------------------------------------------------------ */

export const ndcProducts = pgTable(
  "ndc_products",
  {
    productId: text("product_id").primaryKey(),
    productNdc: text("product_ndc").notNull(),
    productNdc9: text("product_ndc9"),
    productType: text("product_type"),
    proprietaryName: text("proprietary_name"),
    proprietaryNameSuffix: text("proprietary_name_suffix"),
    nonproprietaryName: text("nonproprietary_name"),
    dosageForm: text("dosage_form"),
    routes: text("routes").array().notNull().default(emptyTextArray),
    marketingStart: date("marketing_start"),
    marketingEnd: date("marketing_end"),
    marketingCategory: text("marketing_category"),
    applicationNumber: text("application_number"),
    labelerName: text("labeler_name"),
    substances: text("substances").array().notNull().default(emptyTextArray),
    strengths: text("strengths").array().notNull().default(emptyTextArray),
    strengthUnits: text("strength_units").array().notNull().default(emptyTextArray),
    pharmClasses: text("pharm_classes").array().notNull().default(emptyTextArray),
    deaSchedule: text("dea_schedule"),
    listingCertifiedThrough: date("listing_certified_through"),
    /** listed | excluded */
    listingStatus: text("listing_status").notNull(),
    excludeFlag: text("exclude_flag"),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
    drugId: integer("drug_id"),
    manufacturerId: integer("manufacturer_id"),
  },
  (t) => [
    index("ndc_products_ndc9_idx").on(t.productNdc9),
    index("ndc_products_drug_idx").on(t.drugId),
    index("ndc_products_manufacturer_idx").on(t.manufacturerId),
    index("ndc_products_application_idx").on(t.applicationNumber),
  ],
);

export const ndcPackages = pgTable(
  "ndc_packages",
  {
    id: serial("id").primaryKey(),
    ndc11: text("ndc11").notNull(),
    packageNdc: text("package_ndc").notNull(),
    productId: text("product_id").notNull(),
    description: text("description"),
    marketingStart: date("marketing_start"),
    marketingEnd: date("marketing_end"),
    sample: boolean("sample").notNull().default(false),
    listingStatus: text("listing_status").notNull(),
    excludeFlag: text("exclude_flag"),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
  },
  (t) => [
    uniqueIndex("ndc_packages_ndc_product_uq").on(t.ndc11, t.productId),
    index("ndc_packages_product_idx").on(t.productId),
    index("ndc_packages_ndc11_prefix_idx").on(sql`${t.ndc11} text_pattern_ops`),
  ],
);

export const biologicProducts = pgTable(
  "biologic_products",
  {
    id: serial("id").primaryKey(),
    blaNumber: text("bla_number").notNull(),
    applicant: text("applicant"),
    proprietaryName: text("proprietary_name"),
    properName: text("proper_name"),
    /** 351(a) | 351(k) Biosimilar | 351(k) Interchangeable */
    licenseType: text("license_type"),
    strength: text("strength"),
    dosageForm: text("dosage_form"),
    route: text("route"),
    presentation: text("presentation"),
    marketingStatus: text("marketing_status"),
    licensure: text("licensure"),
    approvalDate: date("approval_date"),
    interchangeableApprovalDate: date("interchangeable_approval_date"),
    refProperName: text("ref_proper_name"),
    refProprietaryName: text("ref_proprietary_name"),
    productNumber: text("product_number"),
    center: text("center"),
    sourceReleaseId: integer("source_release_id")
      .notNull()
      .references(() => sourceReleases.id),
  },
  (t) => [index("biologic_products_bla_idx").on(t.blaNumber)],
);

/* ------------------------------------------------------------------ */
/* Derived entities (rebuilt after every import)                        */
/* ------------------------------------------------------------------ */

export const manufacturers = pgTable("manufacturers", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  labelerCodes: text("labeler_codes").array().notNull().default(emptyTextArray),
  altNames: text("alt_names").array().notNull().default(emptyTextArray),
  productCount: integer("product_count").notNull().default(0),
  activeProductCount: integer("active_product_count").notNull().default(0),
  hcpcsCodes: text("hcpcs_codes").array().notNull().default(emptyTextArray),
});

export const drugs = pgTable(
  "drugs",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    brandName: text("brand_name"),
    genericName: text("generic_name"),
    /** brand | generic | authorized_generic | unbranded_nda | biologic | biosimilar | interchangeable_biosimilar | unapproved | eua | other */
    productClass: text("product_class").notNull(),
    isBrand: boolean("is_brand").notNull().default(false),
    /** reference | biosimilar | interchangeable | null */
    biosimilarStatus: text("biosimilar_status"),
    referenceDrugId: integer("reference_drug_id"),
    activeIngredients: text("active_ingredients").array().notNull().default(emptyTextArray),
    dosageForms: text("dosage_forms").array().notNull().default(emptyTextArray),
    routes: text("routes").array().notNull().default(emptyTextArray),
    strengths: text("strengths").array().notNull().default(emptyTextArray),
    marketingCategories: text("marketing_categories").array().notNull().default(emptyTextArray),
    applicationNumbers: text("application_numbers").array().notNull().default(emptyTextArray),
    pharmClasses: text("pharm_classes").array().notNull().default(emptyTextArray),
    manufacturerIds: integer("manufacturer_ids").array().notNull().default(sql`'{}'::integer[]`),
    hcpcsCodes: text("hcpcs_codes").array().notNull().default(emptyTextArray),
    hasPayment: boolean("has_payment").notNull().default(false),
    /** At least one product is in the active FDA directory (not an excluded listing). */
    isListed: boolean("is_listed").notNull().default(true),
    /** Latest marketing end date across listed products; null when any is open-ended. Active = listed and (null or ≥ today). */
    activeUntil: date("active_until"),
    productCount: integer("product_count").notNull().default(0),
    packageCount: integer("package_count").notNull().default(0),
    earliestMarketingStart: date("earliest_marketing_start"),
  },
  (t) => [index("drugs_reference_idx").on(t.referenceDrugId)],
);

export const drugAliases = pgTable(
  "drug_aliases",
  {
    id: serial("id").primaryKey(),
    drugId: integer("drug_id").notNull(),
    alias: text("alias").notNull(),
    aliasKey: text("alias_key").notNull(),
    /** brand | generic | ingredient | cms_drug_name | purple_book_proper_name */
    aliasType: text("alias_type").notNull(),
    sourceKey: text("source_key").notNull(),
  },
  (t) => [index("drug_aliases_drug_idx").on(t.drugId), index("drug_aliases_key_idx").on(t.aliasKey)],
);

export const codeRelationships = pgTable(
  "code_relationships",
  {
    id: serial("id").primaryKey(),
    /** NDC_HCPCS | DRUG_HCPCS | DRUG_NOC | BIOSIMILAR_REFERENCE | HCPCS_CROSS_REFERENCE */
    kind: text("kind").notNull(),
    ndc11: text("ndc11"),
    drugId: integer("drug_id"),
    hcpcsCode: text("hcpcs_code"),
    relatedDrugId: integer("related_drug_id"),
    relatedHcpcsCode: text("related_hcpcs_code"),
    sourceKey: text("source_key").notNull(),
    sourceReleaseId: integer("source_release_id"),
    firstPeriod: text("first_period"),
    lastPeriod: text("last_period"),
    effectiveStart: date("effective_start"),
    effectiveEnd: date("effective_end"),
    /** OFFICIAL | DERIVED | MANUAL */
    authority: text("authority").notNull(),
    /** NOT_REQUIRED | PENDING | APPROVED | REJECTED */
    reviewStatus: text("review_status").notNull(),
    /** Supported by the most recent release of its source. */
    isCurrent: boolean("is_current").notNull().default(true),
    evidence: jsonb("evidence"),
    notes: text("notes"),
  },
  (t) => [
    index("code_relationships_kind_idx").on(t.kind),
    index("code_relationships_ndc_idx").on(t.ndc11),
    index("code_relationships_drug_idx").on(t.drugId),
    index("code_relationships_code_idx").on(t.hcpcsCode),
    index("code_relationships_related_drug_idx").on(t.relatedDrugId),
  ],
);

export const searchDocuments = pgTable(
  "search_documents",
  {
    id: serial("id").primaryKey(),
    /** drug | hcpcs | manufacturer */
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    family: text("family"),
    codes: text("codes").array().notNull().default(emptyTextArray),
    manufacturerNames: text("manufacturer_names").array().notNull().default(emptyTextArray),
    manufacturerSlugs: text("manufacturer_slugs").array().notNull().default(emptyTextArray),
    dosageForms: text("dosage_forms").array().notNull().default(emptyTextArray),
    routes: text("routes").array().notNull().default(emptyTextArray),
    productClass: text("product_class"),
    isBrand: boolean("is_brand"),
    biosimilarStatus: text("biosimilar_status"),
    hasPayment: boolean("has_payment").notNull().default(false),
    isNoc: boolean("is_noc").notNull().default(false),
    isDrug: boolean("is_drug").notNull().default(false),
    /** false for FDA-excluded records */
    isListed: boolean("is_listed").notNull().default(true),
    /** Termination / marketing end date; active when null or in the future. */
    statusEndDate: date("status_end_date"),
    effectiveDate: date("effective_date"),
    weight: real("weight").notNull().default(0),
  },
  (t) => [uniqueIndex("search_documents_kind_key_uq").on(t.kind, t.key)],
);

export const searchTerms = pgTable(
  "search_terms",
  {
    id: serial("id").primaryKey(),
    docId: integer("doc_id").notNull(),
    term: text("term").notNull(),
    /** code | brand | generic | alias | ingredient | descriptor | manufacturer | manufacturer_name */
    termType: text("term_type").notNull(),
  },
  (t) => [
    index("search_terms_doc_idx").on(t.docId),
    index("search_terms_term_pattern_idx").on(sql`${t.term} text_pattern_ops`),
    index("search_terms_term_trgm_idx").using("gin", sql`${t.term} gin_trgm_ops`),
  ],
);

export type SourceRelease = typeof sourceReleases.$inferSelect;
export type HcpcsCode = typeof hcpcsCodes.$inferSelect;
export type PaymentLimit = typeof paymentLimits.$inferSelect;
export type CrosswalkRow = typeof ndcHcpcsCrosswalk.$inferSelect;
export type MueValue = typeof mueValues.$inferSelect;
export type MdrpProduct = typeof mdrpProducts.$inferSelect;
export type NdcProduct = typeof ndcProducts.$inferSelect;
export type NdcPackage = typeof ndcPackages.$inferSelect;
export type Drug = typeof drugs.$inferSelect;
export type Manufacturer = typeof manufacturers.$inferSelect;
export type CodeRelationship = typeof codeRelationships.$inferSelect;
export type SearchDocument = typeof searchDocuments.$inferSelect;
