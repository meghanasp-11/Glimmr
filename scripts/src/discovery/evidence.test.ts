/**
 * Tests for evidence collection (blocklist, extraction, retry, failures).
 *
 * Pure unit tests with fixture HTML and stubbed fetch — no real network.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  collectEvidence,
  extractSnippets,
  extractTitle,
  isBlockedHost,
} from "./evidence";

const FIXTURE_HTML = `
<html><head><title>Test Cafe — Indiranagar</title>
<script>var x = "Open 9 AM";</script>
<style>.a { color: red; }</style></head>
<body>
<h1>Welcome to Test Cafe</h1>
<p>We are open daily from 9:00 AM to 9:00 PM. Visit us on 100 Feet Road, Indiranagar, Bengaluru.</p>
<p>Our menu starts at Rs. 150. Check prices inside.</p>
<p>This outlet is now open for dine-in.</p>
</body></html>`;

function okResponse(html: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => html,
  };
}

describe("isBlockedHost", () => {
  it("blocks Google Maps, Zomato, Swiggy, and Instagram", () => {
    expect(isBlockedHost("https://www.google.com/maps/place/x")).toBe(true);
    expect(isBlockedHost("https://maps.google.co.in/place/x")).toBe(true);
    expect(isBlockedHost("https://www.zomato.com/bangalore/x")).toBe(true);
    expect(isBlockedHost("https://www.swiggy.com/city/x")).toBe(true);
    expect(isBlockedHost("https://www.instagram.com/p/x")).toBe(true);
  });

  it("allows ordinary venue sites and rejects non-http URLs", () => {
    expect(isBlockedHost("https://example.com/menu")).toBe(false);
    expect(isBlockedHost("http://localhost:3000/x")).toBe(false);
    expect(isBlockedHost("not a url")).toBe(true);
    expect(isBlockedHost("ftp://example.com/x")).toBe(true);
  });
});

describe("extractTitle", () => {
  it("reads the page title and ignores script content", () => {
    expect(extractTitle(FIXTURE_HTML)).toBe("Test Cafe — Indiranagar");
    expect(extractTitle("<html><body>no title</body></html>")).toBeNull();
  });
});

describe("extractSnippets", () => {
  it("collects raw excerpts per category without inventing facts", () => {
    const snippets = extractSnippets(FIXTURE_HTML);
    expect(snippets.hours.some((s) => s.includes("9:00 AM"))).toBe(true);
    expect(snippets.pricing.some((s) => s.includes("Rs. 150"))).toBe(true);
    expect(snippets.address.some((s) => s.includes("Indiranagar"))).toBe(true);
    expect(snippets.status.some((s) => s.includes("now open"))).toBe(true);
    // Script/style content must never leak into evidence.
    expect(JSON.stringify(snippets)).not.toContain('var x = "Open 9 AM"');
  });

  it("returns empty buckets for pages with no matches", () => {
    expect(extractSnippets("<html><body><p>Hello world, nothing relevant here at all.</p></body></html>")).toEqual({
      hours: [],
      pricing: [],
      address: [],
      status: [],
    });
  });
});

describe("collectEvidence", () => {
  it("fetches the official website first and records evidence", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return okResponse(FIXTURE_HTML) as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await collectEvidence(
      "test-1",
      { official: "https://example.com/", secondary: ["https://fallback.example/"] },
      { fetchFn, now: () => "2026-09-16T00:00:00.000Z" },
    );
    expect(calls).toEqual(["https://example.com/"]);
    expect(result).toMatchObject({
      overture_id: "test-1",
      url_type: "official-website",
      source_url: "https://example.com/",
      fetched_at_utc: "2026-09-16T00:00:00.000Z",
      http_status: 200,
      page_title: "Test Cafe — Indiranagar",
      website_reachable: true,
      failure: null,
    });
    expect(result.snippets.hours.length).toBeGreaterThan(0);
  });

  it("falls back to secondary URLs when the official site fails", async () => {
    const fetchFn = (async (url: string) => {
      if (url.includes("official")) throw new Error("DNS down");
      return okResponse(FIXTURE_HTML) as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await collectEvidence(
      "test-2",
      { official: "https://official.example/", secondary: ["https://fallback.example/"] },
      { fetchFn, maxRetries: 0, retryDelayMs: 0 },
    );
    expect(result.url_type).toBe("secondary");
    expect(result.source_url).toBe("https://fallback.example/");
    expect(result.website_reachable).toBe(true);
    expect(result.failure).toBeNull();
  });

  it("never fetches blocked hosts and records the refusal", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return okResponse("") as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await collectEvidence("test-3", { official: "https://www.zomato.com/bangalore/x" }, { fetchFn });
    expect(called).toBe(false);
    expect(result.website_reachable).toBe(false);
    expect(result.failure?.reason).toBe("blocked-host");
  });

  it("records no-url, http-error, and timeout failures without throwing", async () => {
    const none = await collectEvidence("test-4", {});
    expect(none.failure?.reason).toBe("no-url");
    expect(none.website_reachable).toBe(false);

    const bad = await collectEvidence(
      "test-5",
      { official: "https://example.com/missing" },
      { fetchFn: (async () => okResponse("nope", 404)) as unknown as typeof fetch },
    );
    expect(bad.failure).toMatchObject({ reason: "http-error", attempts: 1 });
    expect(bad.website_reachable).toBe(false);

    let attempts = 0;
    const hanging = (async () => {
      attempts += 1;
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    const timedOut = await collectEvidence(
      "test-6",
      { official: "https://example.com/slow" },
      { fetchFn: hanging, timeoutMs: 5, maxRetries: 1, retryDelayMs: 0 },
    );
    expect(attempts).toBe(2);
    expect(timedOut.failure?.reason).toBe("timeout");
    expect(timedOut.failure?.attempts).toBe(2);
  });
});
