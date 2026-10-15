"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", background: "#f5f2ea", color: "#13201e" }}>
        <main style={{ maxWidth: 560, margin: "0 auto" }}>
          <h1 style={{ fontSize: "2rem" }}>CodeRx is temporarily unavailable</h1>
          <p>An unexpected error occurred. Please try again in a moment.</p>
          <button type="button" onClick={() => reset()} style={{ minHeight: 44, padding: "0 1rem", borderRadius: 8, border: 0, background: "#0b5550", color: "#fff", fontWeight: 600 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
