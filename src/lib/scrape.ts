import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { AppError } from "./errors";
import { assertPublicHost } from "./ip-guard";
import type { ScrapeResult } from "./types";

const MAX_RESPONSE_BYTES = 2_000_000; // 2 MB
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_CHARS_FOR_AI = 12_000;
const MIN_USABLE_CHARS = 80;

const USER_AGENT =
  "Mozilla/5.0 (compatible; AIWebScraper/1.0; +https://github.com/)";

const HTML_CONTENT_TYPE =
  /text\/html|application\/xhtml\+xml|text\/plain|text\/markdown/i;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Accepts "example.com" as well as a full URL, and rejects other schemes. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new AppError("Enter a URL to summarize.", "EMPTY_URL", 400);
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new AppError("That doesn't look like a valid URL.", "INVALID_URL", 400);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(
      "Only http:// and https:// URLs are supported.",
      "INVALID_PROTOCOL",
      400,
    );
  }

  return url.toString();
}

/**
 * Reads a response body while enforcing a hard byte cap, so a hostile or
 * runaway server can't stream us out of memory.
 */
async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new AppError(
      "That page is too large to summarize.",
      "PAGE_TOO_LARGE",
      413,
    );
  }

  const body = response.body;
  if (!body) return Buffer.alloc(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new AppError(
          "That page is too large to summarize.",
          "PAGE_TOO_LARGE",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function decodeBody(buffer: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/**
 * Fetches a page, re-validating the host on every redirect hop so an open
 * redirect can't be used to bounce us onto an internal address.
 */
async function fetchHtml(
  startUrl: string,
): Promise<{ finalUrl: string; html: string }> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new AppError(
        "Only http:// and https:// URLs are supported.",
        "INVALID_PROTOCOL",
        400,
      );
    }

    if (url.username || url.password) {
      throw new AppError(
        "URLs with embedded credentials aren't supported.",
        "INVALID_URL",
        400,
      );
    }

    await assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new AppError(
            `The site returned a redirect with no destination (HTTP ${response.status}).`,
            "BAD_REDIRECT",
            422,
          );
        }
        current = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) {
        throw new AppError(
          `The site responded with HTTP ${response.status}.`,
          "BAD_STATUS",
          422,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!HTML_CONTENT_TYPE.test(contentType)) {
        throw new AppError(
          "That URL doesn't point to an HTML page.",
          "UNSUPPORTED_CONTENT_TYPE",
          415,
        );
      }

      const buffer = await readCapped(response, MAX_RESPONSE_BYTES);
      return {
        finalUrl: response.url || url.toString(),
        html: decodeBody(buffer, contentType),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError(
          "The site took too long to respond.",
          "FETCH_TIMEOUT",
          504,
        );
      }

      throw new AppError(
        `Could not reach that site. ${(error as Error).message}`,
        "FETCH_FAILED",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError(
    "That URL redirected too many times.",
    "TOO_MANY_REDIRECTS",
    422,
  );
}

/** Crude fallback for pages Readability can't score, e.g. JS-driven apps. */
function fallbackText(doc: Document): string {
  const noise = doc.querySelectorAll(
    "script, style, noscript, template, svg, iframe, nav, footer, header, aside, form",
  );
  for (const element of Array.from(noise)) element.remove();

  const root = doc.querySelector("main, article, [role='main']") ?? doc.body;
  return root?.textContent ?? "";
}

function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function scrape(rawUrl: string): Promise<ScrapeResult> {
  const normalized = normalizeUrl(rawUrl);
  const { finalUrl, html } = await fetchHtml(normalized);

  if (!html.trim()) {
    throw new AppError("That page returned no content.", "EMPTY_PAGE", 422);
  }

  const dom = new JSDOM(html, { url: finalUrl });
  try {
    const doc = dom.window.document;
    let title = doc.title?.trim() ?? "";
    let byline: string | null = null;
    let text = "";

    // Readability mutates the document it is handed, so give it a clone and
    // keep the original around for the fallback path.
    try {
      const article = new Readability(doc.cloneNode(true) as Document, {
        charThreshold: 200,
      }).parse();

      if (article?.textContent) {
        text = article.textContent;
        title = article.title || title;
        byline = article.byline || null;
      }
    } catch {
      // Readability throws on some malformed documents; fall back below.
    }

    if (tidy(text).length < MIN_USABLE_CHARS) {
      text = fallbackText(doc);
    }

    const cleaned = tidy(text);

    if (cleaned.length < MIN_USABLE_CHARS) {
      throw new AppError(
        "Couldn't find enough readable text on that page. It may render its content with JavaScript.",
        "NO_CONTENT",
        422,
      );
    }

    const truncated = cleaned.length > MAX_CHARS_FOR_AI;

    return {
      requestedUrl: normalized,
      finalUrl,
      title,
      byline,
      text: truncated ? cleaned.slice(0, MAX_CHARS_FOR_AI) : cleaned,
      charCount: cleaned.length,
      truncated,
    };
  } finally {
    dom.window.close();
  }
}
