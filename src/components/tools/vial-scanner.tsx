"use client";

import { Calculator, Camera, CameraOff, ClipboardCopy, ExternalLink, ImageUp, ScanLine, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { NdcDetail } from "@/lib/data/queries";
import { formatPeriod } from "@/lib/format";
import { parseScan, type ScanParse } from "@/lib/gs1";
import { qualifierForUnitType } from "@/lib/medicaid";
import { formatNdc11 } from "@/lib/ndc";
import { readPackageDescription } from "@/lib/package-label";

interface Scanned {
  id: number;
  at: number;
  scan: ScanParse;
  matches: NdcDetail[];
  error: string | null;
}

type Controls = { stop: () => void };

const today = () => new Date().toISOString().slice(0, 10);

async function lookup(scan: ScanParse): Promise<{ matches: NdcDetail[]; error: string | null }> {
  if (!scan.candidates.length) return { matches: [], error: scan.problems[0] ?? "No NDC found in the scan." };
  const results = await Promise.all(
    scan.candidates.map(async (c) => {
      const res = await fetch(`/api/ndc/${formatNdc11(c)}`, { headers: { Accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Lookup failed (${res.status}).`);
      return ((await res.json()) as { data: NdcDetail }).data;
    }),
  );
  return { matches: results.filter((r): r is NdcDetail => !!r), error: null };
}

/** Decoder loaded only when the scanner is used (keeps it out of other pages). */
async function reader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.UPC_A, BarcodeFormat.EAN_13, BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
}

export function VialScanner() {
  const id = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controls = useRef<Controls | null>(null);
  const lastText = useRef<{ text: string; at: number } | null>(null);
  const nextId = useRef(1);
  const [items, setItems] = useState<Scanned[]>([]);
  const [camera, setCamera] = useState<"off" | "starting" | "on">("off");
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => () => controls.current?.stop(), []);

  async function handle(text: string) {
    const now = Date.now();
    // The camera reports the same code many times a second.
    if (lastText.current && lastText.current.text === text && now - lastText.current.at < 4000) return;
    lastText.current = { text, at: now };
    const scan = parseScan(text);
    const entry: Scanned = { id: nextId.current++, at: now, scan, matches: [], error: null };
    try {
      Object.assign(entry, await lookup(scan));
    } catch (e) {
      entry.error = e instanceof Error ? e.message : "Lookup failed.";
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(40);
    setItems((prev) => [entry, ...prev].slice(0, 50));
  }

  async function startCamera() {
    setMessage(null);
    setCamera("starting");
    try {
      const r = await reader();
      controls.current = await r.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current!, (result) => {
        if (result) void handle(result.getText());
      });
      setCamera("on");
    } catch (e) {
      setCamera("off");
      setMessage(e instanceof Error && /Permission|NotAllowed/i.test(`${e.name} ${e.message}`) ? "Camera permission was denied. Allow camera access for this site, or use a photo or a USB scanner." : "The camera could not be started on this device. Use a photo or a USB scanner instead.");
    }
  }

  function stopCamera() {
    controls.current?.stop();
    controls.current = null;
    setCamera("off");
  }

  async function scanPhoto(file: File) {
    setMessage(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const r = await reader();
      await handle(r.decodeFromCanvas(canvas).getText());
    } catch {
      setMessage("No barcode was found in that photo. Fill the frame with the 2D code and try again.");
    }
  }

  const auditList = items
    .flatMap((i) => i.matches.map((m) => `${m.codes[0]?.code ?? ""},${m.formatted}`))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join("\n");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section aria-labelledby={`${id}-in`} className="space-y-4 rounded-xl border hairline bg-surface p-5 sm:p-6">
        <h2 id={`${id}-in`} className="font-display text-xl font-semibold text-ink">
          Scan a vial or carton
        </h2>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg border hairline bg-paper-sunken">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" className={`h-full w-full object-cover ${camera === "on" ? "" : "invisible"}`} />
          {camera !== "on" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-muted">
              <ScanLine aria-hidden="true" className="h-10 w-10 text-ink-faint" />
              {camera === "starting" ? "Starting the camera…" : "Point the camera at the 2D barcode (DataMatrix) or the linear barcode on the label."}
            </div>
          ) : (
            <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-brand/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {camera === "on" ? (
            <button type="button" onClick={stopCamera} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rule-strong px-4 font-semibold text-ink hover:border-brand">
              <CameraOff aria-hidden="true" className="h-4 w-4" /> Stop camera
            </button>
          ) : (
            <button type="button" onClick={startCamera} disabled={camera === "starting"} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong disabled:opacity-60 dark:text-paper-sunken">
              <Camera aria-hidden="true" className="h-4 w-4" /> Start camera
            </button>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-rule-strong px-4 font-semibold text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] hover:border-brand">
            <ImageUp aria-hidden="true" className="h-4 w-4" /> Scan a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scanPhoto(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) void handle(typed.trim());
            setTyped("");
          }}
        >
          <label htmlFor={`${id}-typed`} className="text-sm font-semibold text-ink">
            USB scanner or typed NDC
          </label>
          <p id={`${id}-typed-hint`} className="mt-0.5 text-xs text-ink-muted">
            Click here and scan with a handheld scanner, or type an NDC (any format) and press Enter.
          </p>
          <input
            id={`${id}-typed`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby={`${id}-typed-hint`}
            autoComplete="off"
            spellCheck={false}
            placeholder="0105024205121… or 50242-0051-21"
            className="mt-1.5 block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 font-mono text-sm text-ink placeholder:text-ink-faint"
          />
        </form>
        {message ? (
          <p role="alert" className="flex gap-2 rounded-lg border border-accent/40 bg-accent-tint/50 px-3 py-2 text-sm text-ink">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {message}
          </p>
        ) : null}
        <p className="text-xs text-ink-muted">Images never leave your device; only the NDC is looked up. Lot, serial, and expiry are read from the barcode and shown here only.</p>
      </section>

      <section aria-labelledby={`${id}-out`} aria-live="polite" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-out`} className="font-display text-xl font-semibold text-ink">
            Scanned ({items.length})
          </h2>
          {auditList ? (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(auditList)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
            >
              <ClipboardCopy aria-hidden="true" className="h-4 w-4" /> Copy as audit list
            </button>
          ) : null}
        </div>
        {!items.length ? <p className="rounded-xl border border-dashed border-rule-strong bg-surface p-6 text-sm text-ink-muted">Scanned products appear here, newest first.</p> : null}
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-xl border hairline bg-surface p-4">
              {it.matches.length ? (
                it.matches.map((m) => <Match key={m.ndc11} m={m} scan={it.scan} />)
              ) : (
                <div className="text-sm">
                  <p className="font-semibold text-ink">{it.error ?? "No product in the CodeRx index matches this barcode."}</p>
                  {it.scan.candidates.length ? (
                    <p className="mt-1 text-ink-muted">
                      Checked {it.scan.candidates.map((c) => formatNdc11(c)).join(", ")}. CodeRx indexes clinician-administered products and CMS-crosswalked NDCs.
                    </p>
                  ) : null}
                  {it.scan.problems.map((p) => (
                    <p key={p} className="mt-1 text-accent">
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Match({ m, scan }: { m: NdcDetail; scan: ScanParse }) {
  const product = m.fda[0];
  const facts = readPackageDescription(product?.package.description);
  const code = m.codes.find((c) => c.crosswalk?.isCurrent) ?? m.codes[0];
  const expired = scan.expiry ? scan.expiry < today() : false;
  const name = product ? [product.product.proprietaryName, product.product.proprietaryNameSuffix].filter(Boolean).join(" ") : (m.crosswalk[0]?.drugName ?? "Product");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{name}</p>
          <p className="code-chip text-sm text-ink-muted">NDC {m.formatted}</p>
        </div>
        {scan.expiry ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${expired ? "bg-danger-tint text-danger" : "bg-ok-tint text-ok"}`}>
            {expired ? "Expired" : "Expires"} {scan.expiry}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-faint">HCPCS</dt>
          <dd className="code-chip font-semibold text-ink">{code?.code ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Billable units / pkg</dt>
          <dd className="code-chip text-ink">{code?.crosswalk?.billUnitsPerPackage ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Container</dt>
          <dd className="text-ink">{facts.containerType ?? "Not stated"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Medicaid unit</dt>
          <dd className="code-chip text-ink">{m.medicaid?.unitType ? `${m.medicaid.unitType} → ${qualifierForUnitType(m.medicaid.unitType) ?? "—"}` : "—"}</dd>
        </div>
      </dl>
      {scan.lot || scan.serial ? (
        <p className="text-xs text-ink-muted">
          {scan.lot ? `Lot ${scan.lot}` : ""}
          {scan.lot && scan.serial ? " · " : ""}
          {scan.serial ? `Serial ${scan.serial}` : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {code ? (
          <Link href={`/calculator?code=${code.code}&ndc=${m.formatted}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
            <Calculator aria-hidden="true" className="h-4 w-4" /> Calculate
          </Link>
        ) : null}
        <Link href={`/ndc/${m.formatted}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
          <ExternalLink aria-hidden="true" className="h-4 w-4" /> NDC page
        </Link>
      </div>
      {m.medicaidPeriod && !m.medicaid ? <p className="text-xs text-ink-muted">Not in the Medicaid rebate file for {formatPeriod(m.medicaidPeriod)}.</p> : null}
    </div>
  );
}
