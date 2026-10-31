# Test fixture provenance

Generated 2026-10-15 by `npm run fixtures` from files downloaded directly from CMS and FDA on 2026-10-14.
Each fixture keeps the original header/preamble and a subset of unmodified data rows.

- hcpcs-2025q4.txt: 26 lines from hist/hc-2025q4/HCPC2025_OCT_ANWEB_v4.txt (sha256 1a76b93c7da58893bc37381ba23bd984a8beff8d2f7b60a772877b3d1d735574)
- hcpcs-2026q4.txt: 27 lines (plus, on 2026-10-30, the RIC 3–4 lines of J0174, J0184, J0402, J9302, Q5154, A9543, A9601 for the OPPS status-change tests) from hcpcs-2026q4/HCPC2026_OCT_ANWEB_09232026.txt (sha256 c25240c63108756d4ba6c0ea785c517117d83bfed9526c51da8acf123de1feb6)
- noc-codes-2026q4.xlsx: unmodified copy of the CMS NOC code list (October 2026)
- payment-2026q4.csv: preamble + 21 records from section 508 version of October 2026 Medicare Part B Payment Limit File 091626.csv (sha256 508fba376a29e09994d840f42abd3c4c2dab78e91b4d1256fdb064f2cc5d213f)
- payment-2026q3.csv: preamble + 19 records from section 508 verfsion of July 2026 Medicare Part B Payment Limit File updated 091526.csv (sha256 34b97bab9759919a0fcfc4040a8d938b48d540aa78109f6e79d33d5fc6fed4e5)
- not-payable-2026q4.csv: preamble + 8 records from section 508 version of October 2026 Drugs Not Payable Under Part B 091426.csv (sha256 aa6cd1c3652719fba393733e8c5c75af1bbf3675d27154e2d04aee8e5611231d)
- crosswalk-asp-2026q4.csv: preamble + 144 records from section 508 version of October 2026 ASP NDC-HCPCS Crosswalk 091126.csv (sha256 5cb78f0c2ee786ba70ddafb76879e754bc867db93c8cb691a2474c10dd437606)
- crosswalk-opps-2026q4.csv: preamble + 1 records from section 508 version of October 2026 OPPS NDC-HCPCS Crosswalk 090426.csv (sha256 167efe9e47c42718f7232e0db222d3cc7d5f39f0a7d6108b0821f9288ac20330)
- fda-package.txt: header + 135 rows from package.txt (sha256 a257f13abb3d70fa5d1554befff92f1daa454f6118dcb9ee9a4f76e8d1da66ae)
- fda-product.txt: header + 112 rows from product.txt (sha256 ef379bee87ca8b85619821335f26ad8c340d3741456c15c08d765394cbf7d412)
- fda-packages-excluded.txt: header + 10 rows from Packages_excluded.txt (sha256 85c29242382fffd3590a416775b8cb5e93943e51ac040bedb229b73c3760d50a)
- fda-products-excluded.txt: header + 8 rows from Products_excluded.txt (sha256 f107c9f1c4ec49c394cca7ee01f94f00ec872e3b439af4014dc2f5a32a64d00c)
- purplebook.csv: title/section rows + 118 product rows from pb.csv (sha256 b9d04a8b1ea9c6605fdeff01127f0de32cb092534a40441b036e39c9665974e6)
- mue-practitioner-2026q4.csv: preamble + 22 records from MCR_MUE_PractitionerServices_Eff_10-01-2026.csv (sha256 ef038efaf902b7bd41b8d43318ead2944e712806f903358eb2f8ab5df98711b3)
- mue-outpatient-2026q4.csv: preamble + 22 records from MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv (sha256 3af9f4e99cc587e23f0a2fc4884bdb85ab6467db229b0d7d2a07f22c75ceddaa)
- mue-dme-2026q4.csv: preamble + 13 records from MCR_MUE_DMESupplierServices_Eff_10-01-2026.csv (sha256 6fa4fbba852f7b7496b5b7cfb59ae0840fe85be2235ee0ef121a8c5b54031f45)
- mdrp-products-2026q2.csv: header + 103 2026-Q2 rows for fixture NDCs, 3 2026-Q1 rows, and 1 quoted-labeler row from drugproducts-q2-2026.csv (sha256 ee27186251b4656a92cfd4e29ebb9a245a4210e0c4bd2feb669c79382a0fbea8)
- wa-hca-home-infusion-20260701.xlsx: unmodified copy of the Washington State Health Care Authority "Home Infusion Therapy/Parenteral Nutrition Program" fee schedule effective July 1, 2026 (home-infusion-parenteral-nutrition-20260701.xlsx, sha256 4c56a3279faabd71743a189eb878bd658dd55dfa8af5a0ad8542aaf55f07c3e9), downloaded from hca.wa.gov by the project owner on 2026-10-22
- opps-addendum-a-2026q4.txt: preamble + header + 22 APC rows (drug administration levels 1–4, clinic visit 5012, and the drug APCs of the Addendum B excerpt) from 508-compliant-version-2026_October_Web_Addendum_A.10.14.26.txt in October-2026-OPPS-Addendum.zip (sha256 3791620735566fcc8cc1bacd68de4eb96b1385097a73d964cff178b3940ea417), downloaded from cms.gov on 2026-10-26
- opps-addendum-b-2026q4.txt: preamble + header + 31 HCPCS Level II rows (the payment-limit fixture codes plus G0463, packaged/non-covered examples J1100, J7030, J7050, A9270, and — added 2026-10-30 — status changes since July J0184, J0402, J9302, Q5154, pass-through A9601 and J0174, and copay-capped A9543) from 508-compliant-version-2026_October_Web_Addendum_B.10.14.26.txt in October-2026-OPPS-Addendum-B.zip (sha256 f99157bd4f60f22b78eb983ca5afe27570ca170b1da318c3a56ca85c98521e25), downloaded from cms.gov on 2026-10-26. No CPT or dental rows are included.
- opps-addendum-b-2026q3.csv: preamble + header + the same 31 codes' rows from "508 Version July Addendum B/2026 July Web Addendum B.07.13.26.csv" in july-2026-opps-addendum-b.zip (comma-delimited; sha256 e50a1fa958ed2bb264c2f66df27288d8fbec2a693b8e11a92b8dfa1a34939610), downloaded from cms.gov on 2026-10-30. This 508 copy rounds drug rates to cents (the XLSX the importer prefers has full precision).
- wa-hca-professional-drugs-20261001.xlsx: unmodified copy of the Washington State Health Care Authority "Professional Administered Drug Fee Schedule" effective October 1, 2026, updated October 29, 2026 (professional-administered-drugs-20261001.xlsx, sha256 aba94d531145ab55f242a41278b19773a0fa548cf765577e09081ad9f9a3d6b9), downloaded from hca.wa.gov on 2026-10-30
