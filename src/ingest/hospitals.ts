/**
 * Hospital price transparency files (45 CFR 180.50) processed by the operator's Mac
 * (scripts/refresh-price-benchmark.ts) and uploaded as anonymized drug rates.
 *
 * MultiCare's Washington hospitals, as listed on
 * https://www.multicare.org/patient-resources/billing/transparency/ (checked 2026-10-30).
 * The files are hosted on Azure Blob Storage. Allenmore and Tacoma General share one
 * state license and one file; the Tacoma General link is used (the Allenmore link,
 * …/8058/…, points to an earlier posting of the same license's file).
 */

export interface HospitalFile {
  key: string;
  name: string;
  url: string;
}

export const MULTICARE_PAGE = "https://www.multicare.org/patient-resources/billing/transparency/";
/** Hosts the upload endpoint accepts as a file's official location. */
export const HOSPITAL_FILE_HOSTS = ["sthpiprd.blob.core.windows.net"];

const BLOB = "https://sthpiprd.blob.core.windows.net/machine-readable-files";

export const MULTICARE_HOSPITALS: HospitalFile[] = [
  { key: "tacoma-general-allenmore", name: "MultiCare Tacoma General and Allenmore Hospitals", url: `${BLOB}/8062/911352172-1366556227_tacoma-general-allenmore-hospital_standardcharges.csv` },
  { key: "auburn", name: "MultiCare Auburn Medical Center", url: `${BLOB}/8059/911352172-1255327201_multicare-auburn-medical-center_standardcharges.csv` },
  { key: "capital", name: "MultiCare Capital Medical Center", url: `${BLOB}/9371/911352172-1841258639_multicare-capital-medical-center_standardcharges.csv` },
  { key: "covington", name: "MultiCare Covington Medical Center", url: `${BLOB}/8060/911352172-1326564071_multicare-covington-medical-center_standardcharges.csv` },
  { key: "deaconess", name: "MultiCare Deaconess Hospital", url: `${BLOB}/8063/911352172-1356528269_multicare-deaconess-hospital_standardcharges.csv` },
  { key: "good-samaritan", name: "MultiCare Good Samaritan Hospital", url: `${BLOB}/8061/911352172-1841231461_good-samaritan-hospital_standardcharges.csv` },
  { key: "mary-bridge", name: "MultiCare Mary Bridge Children's Hospital", url: `${BLOB}/8057/911352172-1306952726_mary-bridge-childrens-hospital_standardcharges.csv` },
  { key: "valley", name: "MultiCare Valley Hospital", url: `${BLOB}/8064/911352172-1538345251_multicare-valley-hospital_standardcharges.csv` },
  { key: "yakima-memorial", name: "MultiCare Yakima Memorial Hospital", url: `${BLOB}/11188/910567263-1053373480_multicare-yakima-valley-memorial-hospital-association_standardcharges.csv` },
  { key: "navos", name: "Navos Multi-Treatment Center", url: `${BLOB}/8166/910848698-1194728105_navos-multitreatment-center_standardcharges.csv` },
];

export const hospitalByKey = (key: string) => MULTICARE_HOSPITALS.find((h) => h.key === key) ?? null;
