import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #f5f2ea 0%, #e7efe9 100%)",
          color: "#13201e",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "#0b5550", color: "#f5f2ea", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 700 }}>Rx</div>
          <div style={{ fontSize: 52, fontWeight: 700, display: "flex" }}>
            Code<span style={{ color: "#0b5550", fontStyle: "italic" }}>Rx</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 64, lineHeight: 1.05, fontWeight: 700, maxWidth: 1000 }}>Find the code. Count the units. Trace every number.</div>
          <div style={{ fontSize: 30, color: "#4a5754" }}>{SITE.tagline}</div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 24, color: "#0b5550", fontFamily: "monospace" }}>
          <span>J9271</span>
          <span>·</span>
          <span>00006-3026-02</span>
          <span>·</span>
          <span>CMS · FDA sources</span>
        </div>
      </div>
    ),
    size,
  );
}
