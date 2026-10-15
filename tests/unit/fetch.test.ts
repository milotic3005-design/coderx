import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { download } from "@/ingest/fetch";

describe("download redirects", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    // Mimics FDA's bot defense: the file URL 302s to an HTML "apology" page.
    server = createServer((req, res) => {
      if (req.url === "/file.csv") res.writeHead(302, { Location: "/apology_objects/abuse-detection-apology.html" }).end();
      else res.writeHead(200, { "Content-Type": "text/html" }).end("<!DOCTYPE html><title>Apology</title>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("refuses a redirect when asked to", async () => {
    await expect(download(`${base}/file.csv`, { redirects: "refuse", retries: 0 })).rejects.toThrow(
      /redirected \(HTTP 302\) to \/apology_objects\/abuse-detection-apology\.html/,
    );
  });

  it("follows redirects by default (cron behavior unchanged)", async () => {
    const file = await download(`${base}/file.csv`, { retries: 0 });
    expect(new TextDecoder().decode(file.bytes)).toContain("Apology");
  });
});
