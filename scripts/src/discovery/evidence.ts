/**
 * Evidence collection for the verification queue.
 *
 * Fetches ONLY URLs already on file (official website first, then any
 * secondary URLs in order) and stores what the page says — source URL,
 * fetch date, page title, and keyword-relevant text snippets — without
 * converting anything into prices, hours, or other curated facts. That
 * conversion is a later human step.
 *
 * Guardrails (never crash the pipeline; every failure becomes a record):
 * - Host blocklist: Google Maps, Zomato, Swiggy, Instagram are never
 *   fetched, even if such a URL ever appears on file. No paid APIs exist
 *   here — there is nothing to call them with.
 * - Only http(s) URLs with a valid host are fetched.
 * - Per-request timeout, limited retries with backoff, politeness delay
 *   between places (applied by the CLI loop), and a cap on response size.
 */

export type EvidenceFailureReason =
  | "no-url"
  | "blocked-host"
  | "invalid-url"
  | "http-error"
  | "timeout"
  | "network-error"
  | "too-large"
  | "parse-error";

export interface EvidenceFailure {
  reason: EvidenceFailureReason;
  detail: string;
  attempts: number;
}

export interface EvidenceSnippets {
  hours: string[];
  pricing: string[];
  address: string[];
  status: string[];
}

export interface PlaceEvidence {
  overture_id: string;
  url_type: "official-website" | "secondary" | "none";
  source_url: string | null;
  fetched_at_utc: string | null;
  http_status: number | null;
  page_title: string | null;
  website_reachable: boolean;
  snippets: EvidenceSnippets;
  failure: EvidenceFailure | null;
}

export interface CollectOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxBytes?: number;
  now?: () => string;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1500;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_SNIPPETS_PER_CATEGORY = 5;
const MAX_SNIPPET_CHARS = 300;

/** Hosts that must never be fetched (even if one ever appears on file). */
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /(^|\.)google\.[a-z.]+$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)zomato\.com$/i,
  /(^|\.)swiggy\.com$/i,
  /(^|\.)instagram\.com$/i,
];

export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isBlockedHost(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return true;
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

const SNIPPET_KEYWORDS: Record<keyof EvidenceSnippets, RegExp[]> = {
  hours: [/\bopen\b/i, /\bhours?\b/i, /\btimings?\b/i, /\b\d{1,2}\s*(am|pm)\b/i, /\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b|\bsaturday\b|\bsunday\b/i],
  pricing: [/₹|&#8377;|&rupee;/, /\bprice\b/i, /\bprices\b/i, /\bcost\b/i, /\bmenu\b/i, /\brs\.?\s*\d/i, /\binr\b/i, /\b\d+\s*\/-\b/],
  address: [/\baddress\b/i, /\blocation\b/i, /\breach\b(?!.*\bbreach\b)/i, /\bdirection\b/i, /\bpin\s*code\b/i, /\bpostcode\b/i, /\bkarnataka\b/i, /\bbengaluru\b/i, /\bbangalore\b/i],
  status: [/\bpermanently\s+closed\b/i, /\btemporarily\s+closed\b/i, /\bnow\s+open\b/i, /\bclosed\b/i, /\boutlet\b/i, /\bvisit\s+us\b/i],
};

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return title.length > 0 ? title.slice(0, 200) : null;
}

/**
 * Pull keyword-relevant sentences from page text. Raw excerpts only — no
 * interpretation, no conversion into structured facts.
 */
export function extractSnippets(html: string): EvidenceSnippets {
  const text = visibleText(html);
  // Split on sentence boundaries only before a capital letter (or the end),
  // so abbreviations like "Rs. 150" or "St. Marks" stay intact.
  const sentences = text.split(/(?<=[.!?|•·])\s+(?=[A-Z"“({\[]|$)/).map((s) => s.trim()).filter((s) => s.length >= 12);
  const snippets: EvidenceSnippets = { hours: [], pricing: [], address: [], status: [] };
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const snippet = sentence.length > MAX_SNIPPET_CHARS ? `${sentence.slice(0, MAX_SNIPPET_CHARS)}…` : sentence;
    for (const category of Object.keys(SNIPPET_KEYWORDS) as (keyof EvidenceSnippets)[]) {
      if (snippets[category].length >= MAX_SNIPPETS_PER_CATEGORY) continue;
      if (SNIPPET_KEYWORDS[category].some((pattern) => pattern.test(sentence))) {
        const key = `${category}|${snippet}`;
        if (!seen.has(key)) {
          seen.add(key);
          snippets[category].push(snippet);
        }
      }
    }
  }
  return snippets;
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "GlimmrVerificationBot/1.0 (+verification-only single fetch)",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw Object.assign(new Error(`timed out after ${timeoutMs}ms`), { code: "ETIMEOUT" });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Collect evidence for one place from its on-file URLs in priority order
 * (official website first, then secondary URLs). Returns a failure record —
 * never throws — for anything that goes wrong.
 */
export async function collectEvidence(
  overtureId: string,
  urls: { official?: string | null; secondary?: (string | null)[] },
  opts: CollectOptions = {},
): Promise<PlaceEvidence> {
  const {
    fetchFn = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    now = () => new Date().toISOString(),
  } = opts;

  const ordered: { url: string; type: "official-website" | "secondary" }[] = [];
  if (typeof urls.official === "string" && urls.official.trim().length > 0) {
    ordered.push({ url: urls.official.trim(), type: "official-website" });
  }
  for (const secondary of urls.secondary ?? []) {
    if (typeof secondary === "string" && secondary.trim().length > 0) {
      ordered.push({ url: secondary.trim(), type: "secondary" });
    }
  }
  const base: Omit<PlaceEvidence, "failure" | "fetched_at_utc" | "http_status" | "page_title" | "website_reachable" | "snippets" | "source_url" | "url_type"> = {
    overture_id: overtureId,
  };

  if (ordered.length === 0) {
    return {
      ...base,
      url_type: "none",
      source_url: null,
      fetched_at_utc: null,
      http_status: null,
      page_title: null,
      website_reachable: false,
      snippets: { hours: [], pricing: [], address: [], status: [] },
      failure: { reason: "no-url", detail: "No website or source URL on file.", attempts: 0 },
    };
  }

  let lastFailure: EvidenceFailure | null = null;
  for (const { url, type } of ordered) {
    if (hostOf(url) === null) {
      lastFailure = { reason: "invalid-url", detail: `Not a fetchable http(s) URL: ${url.slice(0, 120)}`, attempts: 0 };
      continue;
    }
    if (isBlockedHost(url)) {
      lastFailure = { reason: "blocked-host", detail: `Blocked host, never fetched: ${hostOf(url)}`, attempts: 0 };
      continue;
    }

    let attempts = 0;
    let response: Response | null = null;
    let error: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      attempts = attempt + 1;
      try {
        response = await fetchWithTimeout(fetchFn, url, timeoutMs);
        error = null;
        break;
      } catch (err) {
        error = err;
        response = null;
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
      }
    }

    if (response === null) {
      const timedOut = error instanceof Error && (error as { code?: string }).code === "ETIMEOUT";
      lastFailure = {
        reason: timedOut ? "timeout" : "network-error",
        detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        attempts,
      };
      continue;
    }
    if (!response.ok) {
      lastFailure = { reason: "http-error", detail: `HTTP ${response.status}`, attempts };
      continue;
    }

    let html: string;
    try {
      const lengthHeader = response.headers.get("content-length");
      if (lengthHeader !== null && Number(lengthHeader) > maxBytes) {
        lastFailure = { reason: "too-large", detail: `content-length ${lengthHeader} exceeds cap`, attempts };
        continue;
      }
      html = await response.text();
      if (html.length > maxBytes * 4) {
        lastFailure = { reason: "too-large", detail: "response body exceeds cap", attempts };
        continue;
      }
    } catch (err) {
      lastFailure = {
        reason: "parse-error",
        detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
        attempts,
      };
      continue;
    }

    return {
      ...base,
      url_type: type,
      source_url: url,
      fetched_at_utc: now(),
      http_status: response.status,
      page_title: extractTitle(html),
      website_reachable: true,
      snippets: extractSnippets(html),
      failure: null,
    };
  }

  return {
    ...base,
    url_type: ordered[0].type,
    source_url: ordered[0].url,
    fetched_at_utc: now(),
    http_status: null,
    page_title: null,
    website_reachable: false,
    snippets: { hours: [], pricing: [], address: [], status: [] },
    failure: lastFailure ?? { reason: "network-error", detail: "Unknown fetch failure.", attempts: 0 },
  };
}
