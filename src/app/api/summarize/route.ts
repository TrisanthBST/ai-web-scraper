import { NextRequest, NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { activeModel, isAiConfigured, summarize } from "@/lib/gemini";
import { consume } from "@/lib/rate-limit";
import { scrape } from "@/lib/scrape";
import type { SummarizeFailure, SummarizeSuccess } from "@/lib/types";

// jsdom needs Node built-ins, so this route can't run on the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

function clientIp(request: NextRequest): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");

  return forwarded?.split(",")[0]?.trim() || "anonymous";
}

function failure(error: unknown): NextResponse<SummarizeFailure> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error("[summarize] unexpected error", error);
  return NextResponse.json(
    {
      ok: false,
      error: "Something went wrong while summarizing that page.",
      code: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "ai-web-scraper",
    aiConfigured: isAiConfigured(),
    model: activeModel(),
  });
}

export async function POST(request: NextRequest) {
  const limit = consume(clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many requests. Try again in ${limit.retryAfterSeconds}s.`,
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let rawUrl: string;
  try {
    const body = (await request.json()) as unknown;
    const candidate =
      typeof body === "object" && body !== null
        ? (body as { url?: unknown }).url
        : undefined;
    rawUrl = typeof candidate === "string" ? candidate : "";
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON.", code: "BAD_JSON" },
      { status: 400 },
    );
  }

  try {
    const page = await scrape(rawUrl);
    const summary = await summarize(page);

    const payload: SummarizeSuccess = {
      ok: true,
      url: page.requestedUrl,
      finalUrl: page.finalUrl,
      title: page.title,
      byline: page.byline,
      summary,
      charCount: page.charCount,
      truncated: page.truncated,
      model: activeModel(),
    };

    return NextResponse.json(payload, {
      headers: { "X-RateLimit-Remaining": String(limit.remaining) },
    });
  } catch (error) {
    return failure(error);
  }
}
