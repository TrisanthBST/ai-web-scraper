# AI Web Scraper

Paste a URL, get a short AI-written summary of that page's main content.

The backend fetches the page, strips it down to readable prose, and sends that
text to Google Gemini's free tier. The summary comes back and renders on the
page.

![stack](https://img.shields.io/badge/Next.js-16-000000) ![ts](https://img.shields.io/badge/TypeScript-5-3178C6) ![ai](https://img.shields.io/badge/Gemini-gemini--3.8--flash-8E75B2)

---

## Table of contents

- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Getting a free Gemini API key](#getting-a-free-gemini-api-key)
- [Where to put the `.env` file](#where-to-put-the-env-file)
- [Running locally](#running-locally)
- [API reference](#api-reference)
- [Deploying](#deploying)
- [Security notes](#security-notes)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

---

## How it works

```
Browser                     Next.js server
───────                     ──────────────
URL input + "Summarize"
      │
      │  POST /api/summarize { "url": "..." }
      ├──────────────────────────────►
      │                        1. validate URL (http/https only)
      │                        2. resolve DNS, reject private IPs  ← SSRF guard
      │                        3. fetch with redirect/size/timeout limits
      │                        4. Readability extracts the article text
      │                        5. Gemini summarizes that text
      │  200 { title, summary, ... }
      │◄──────────────────────────────
      │
      └─ render summary
```

Text extraction uses **Mozilla Readability** — the same engine behind Firefox's
Reader View — so a Wikipedia article or a blog post yields its prose instead of
navigation, footers and cookie banners. Pages Readability can't score fall back
to a `<main>`/`<article>`-first text sweep.

## Tech stack

| Layer     | Choice                                                          |
| --------- | --------------------------------------------------------------- |
| Frontend  | React 19 + Tailwind CSS 4                                        |
| Backend   | Next.js 16 App Router (Route Handler)                            |
| Language  | TypeScript                                                       |
| Scraping  | `jsdom` + `@mozilla/readability`                                 |
| AI        | Google Gemini `gemini-3.8-flash` (free tier, REST API via `fetch`) |

The frontend and backend are one Next.js app, so there is a single process, a
single `npm install`, and one deploy target. `npm run dev` serves the UI and the
API together.

## Getting a free Gemini API key

1. Go to <https://aistudio.google.com/apikey>
2. Sign in with a Google account and accept the terms.
3. Click **Create API key** and copy the value.

The key is free and needs no billing account. Gemini's free tier covers
`gemini-3.8-flash` — Google lists its input and output tokens as "Free of
charge". Your quota is per Google Cloud *project*; check your live limits under
**Rate limits** in AI Studio.

> Keys created in AI Studio since May 2026 are authorization keys bound to a
> service account and scoped to the Gemini API by default. That works fine here
> — no extra configuration needed.

## Where to put the `.env` file

Create a file named **`.env.local`** in the **project root** — the same folder
that contains `package.json`:

```
ai-web-scraper/
├── .env.local        ← create this, put your key here
├── .env.example      ← template, already committed
├── package.json
└── src/
```

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```dotenv
# Required
GEMINI_API_KEY=your-key-here

# Optional — defaults shown
GEMINI_MODEL=gemini-3.8-flash
GEMINI_API_BASE=https://generativelanguage.googleapis.com/v1beta/models
```

| Variable          | Required | Default                                                  | Purpose                                            |
| ----------------- | -------- | -------------------------------------------------------- | -------------------------------------------------- |
| `GEMINI_API_KEY`  | yes      | —                                                        | Your free Gemini key                               |
| `GEMINI_MODEL`    | no       | `gemini-3.8-flash`                                        | Any free-tier Gemini text model                    |
| `GEMINI_API_BASE` | no       | `https://generativelanguage.googleapis.com/v1beta/models` | Point at a mock server to test without using quota |

`.env.local` is git-ignored, so your key can't be committed by accident.
Restart the dev server after editing it — Next.js only reads env files at
startup.

## Running locally

**Prerequisite:** Node.js 20.9 or newer (Node 22 recommended).

```bash
git clone <your-repo-url>
cd ai-web-scraper
npm install
cp .env.example .env.local     # then paste your GEMINI_API_KEY
npm run dev
```

Open <http://localhost:3000>.

That single `npm run dev` command runs **both halves** of the app:

| Part             | Where it lives         | URL                              |
| ---------------- | ---------------------- | -------------------------------- |
| Frontend (React) | `src/app/page.tsx`     | <http://localhost:3000>          |
| Backend (API)    | `src/app/api/summarize/route.ts` | `POST http://localhost:3000/api/summarize` |

To run them as two explicit processes instead, start the Next.js dev server as
above and confirm the API independently:

```bash
curl http://localhost:3000/api/summarize
# {"ok":true,"service":"ai-web-scraper","aiConfigured":true,"model":"gemini-3.8-flash"}

curl -X POST http://localhost:3000/api/summarize \
  -H "Content-Type: application/json" \
  -d '{"url":"https://en.wikipedia.org/wiki/Web_scraping"}'
```

### Other scripts

```bash
npm run dev     # dev server with hot reload
npm run build   # production build
npm run start   # serve the production build
npm run lint    # ESLint
npx tsc --noEmit # type check
```

## API reference

### `POST /api/summarize`

Request:

```json
{ "url": "https://example.com/article" }
```

The scheme is optional — `example.com/article` works and is assumed to be
`https://`.

Success — `200`:

```json
{
  "ok": true,
  "url": "https://example.com/",
  "finalUrl": "https://example.com/",
  "title": "Example Domain",
  "byline": null,
  "summary": "**Example Domain** is a reserved top-level domain…\n\n**Key points**\n\n- …",
  "charCount": 156,
  "truncated": false,
  "model": "gemini-3.8-flash"
}
```

Failure — `4xx`/`5xx`:

```json
{ "ok": false, "error": "That site responded with HTTP 404.", "code": "BAD_STATUS" }
```

| `code`                                          | Status | Meaning                                          |
| ----------------------------------------------- | ------ | ------------------------------------------------ |
| `EMPTY_URL`, `INVALID_URL`, `INVALID_PROTOCOL`  | 400    | The submitted URL isn't usable                   |
| `BLOCKED_ADDRESS`                               | 400    | URL resolves to a private/internal address       |
| `DNS_FAILURE`                                   | 400    | Hostname didn't resolve                          |
| `RATE_LIMITED`                                  | 429    | More than 10 requests/minute from one IP         |
| `UNSUPPORTED_CONTENT_TYPE`                      | 415    | URL isn't an HTML/text document                  |
| `PAGE_TOO_LARGE`                                | 413    | Response exceeded 2 MB                           |
| `BAD_STATUS`, `TOO_MANY_REDIRECTS`, `NO_CONTENT` | 422   | Page failed to fetch or parse                     |
| `AI_BLOCKED`                                    | 422    | Gemini declined to summarize the page            |
| `MISSING_API_KEY`                               | 500    | `GEMINI_API_KEY` isn't set on the server         |
| `AI_AUTH_FAILED`, `AI_BAD_MODEL`, `AI_BAD_REQUEST` | 502 | Gemini rejected the request                      |
| `AI_RATE_LIMITED`                               | 429    | Gemini's own quota is exhausted                  |
| `AI_UNAVAILABLE`, `AI_EMPTY_RESPONSE`           | 502    | Gemini errored or returned nothing               |
| `FETCH_TIMEOUT`, `AI_TIMEOUT`                   | 504    | Upstream took too long                           |

### `GET /api/summarize`

Health check. Reports whether a key is configured (never the key itself).

## Deploying

### Vercel (recommended — one free app serves both halves)

```bash
npm i -g vercel
vercel
```

Or import the repo at <https://vercel.com/new>. Then add the environment
variable under **Settings → Environment Variables**:

| Key              | Value                          |
| ---------------- | ------------------------------ |
| `GEMINI_API_KEY` | your key                       |
| `GEMINI_MODEL`   | `gemini-3.8-flash` (optional)  |

Apply to **Production** (and **Preview** if you want previews working), then
deploy. Vercel auto-detects Next.js, so build and output settings need no
changes.

### Render / Fly.io

Any Node host works — this is a standard Next.js app with no custom server.

- **Build command:** `npm run build`
- **Start command:** `npm run start`
- **Health check path:** `/api/summarize`

Add `GEMINI_API_KEY` in the platform's environment variables panel.

## Security notes

This app fetches a URL supplied by an anonymous visitor, which is the textbook
setup for **server-side request forgery (SSRF)**. Without guards, `/api/summarize`
would let anyone read cloud instance metadata, reach databases on the internal
network, or hit admin panels that aren't exposed publicly.

`src/lib/ip-guard.ts` blocks that:

- only `http:` and `https:` — no `file:`, `gopher:`, `data:`
- no credentials embedded in the URL
- every hostname is DNS-resolved and **every** returned address is checked
- blocked ranges cover loopback, RFC 1918, link-local (`169.254.0.0/16`),
  CGNAT, unique-local IPv6, and the IPv4-mapped / 6to4 / NAT64 IPv6 forms that
  would otherwise smuggle a private address past an IPv6-only check
- IPv6 is expanded from `::`-compressed, zone-scoped and dotted-quad notation
  before matching, so `::ffff:127.0.0.1` is caught
- unparseable addresses **fail closed**
- **the check re-runs on every redirect hop**, so an open redirect on a public
  site can't bounce the server onto `169.254.169.254`
- responses are capped at 2 MB while streaming, with a 12 s timeout and at most
  5 redirects

Also in place:

- a per-IP rate limit (10/min) to protect the free Gemini quota
- the model's prompt treats scraped page text as untrusted data and is told to
  ignore instructions inside it, limiting prompt injection
- summaries render through a small Markdown-subset renderer that builds React
  elements directly — **no `dangerouslySetInnerHTML`**, so neither page content
  nor model output can inject HTML

**Known gaps, stated plainly:**

- The rate limiter is per-instance and in-memory. On serverless, instances scale
  out and reset, so it's a speed bump rather than a real quota. A shared store
  (Redis, Upstash) would be needed to enforce one properly.
- DNS is validated before the connection is made, so a hostile DNS server could
  in principle rebind between the check and the connect. Closing that fully
  means pinning the connection to the validated IP, which needs a custom
  `undici` agent and breaks TLS SNI. The exposure window is small and the
  alternative breaks HTTPS, so this was left as-is deliberately.
- There's no captcha or auth, so a determined attacker can still cycle IPs.

If you deploy this publicly and want it hardened further, put auth in front of
the route and move rate limiting to a shared store first.

## Known limitations

- **JavaScript-only pages won't work.** Content rendered client-side (most SPAs,
  and some news sites) isn't in the HTML, so extraction finds too little text and
  returns `NO_CONTENT`. A headless browser would fix this; it was left out to
  keep the app light.
- **Bot-protected sites may block the request**, and the error surfaces as a
  fetch failure or `HTTP 403`.
- Text is truncated at 12,000 characters before being sent to the model; the
  response sets `truncated: true` and the UI says so.
- Summaries are cached by neither layer, so every request re-fetches and re-summarizes.

## Troubleshooting

**"GEMINI_API_KEY is not set on the server"**
The file must be named `.env.local` and sit next to `package.json` — not in
`src/`. Restart `npm run dev` after creating it. Confirm with
`curl http://localhost:3000/api/summarize`; `aiConfigured` should read `true`.

**"Gemini rejected the API key"**
Copy the key again with no stray whitespace, and confirm it's an **AI Studio**
key (prefix `AIza`) rather than a Google Cloud console key. Note that Gemini
reports a bad key as `400 INVALID_ARGUMENT`, not `401`.

**"Gemini free tier is not available in your country" / 403**
The free tier isn't offered in every region. Error 400 with
`FAILED_PRECONDITION` in AI Studio means a billing-enabled project is required
there.

**"Gemini doesn't recognise the model"**
Set `GEMINI_MODEL` to a free-tier text model, e.g. `gemini-3.8-flash` or
`gemini-3.5-flash-lite`.

**429 from Gemini**
The shared free quota is spent (quota is per project, resets at midnight Pacific).
`gemini-3.5-flash-lite` has a higher rate limit than `gemini-3.8-flash`.

**"Couldn't find enough readable text on that page"**
The page renders its content with JavaScript, or Readability couldn't identify a
main content block. Try an article-style URL.

**"That address points to a private or internal network"**
The guard is working. `localhost`, `127.0.0.1`, `10.x`, `192.168.x` and
`169.254.169.254` are all rejected by design.

**Build fails with `Can't resolve 'fs'`**
`jsdom` is listed in `serverExternalPackages` in `next.config.ts` for this
reason. Keep that setting if you edit the config.

## Project structure

```
src/
├── app/
│   ├── layout.tsx                 # metadata, fonts
│   ├── page.tsx                   # frontend shell
│   ├── globals.css                # Tailwind + theme
│   └── api/summarize/route.ts     # the backend endpoint
├── components/
│   ├── Summarizer.tsx             # form, loading state, result card
│   └── Summary.tsx                # safe Markdown-subset renderer
└── lib/
    ├── scrape.ts                  # fetch + Readability extraction
    ├── ip-guard.ts                # SSRF protection
    ├── gemini.ts                  # Gemini REST client
    ├── rate-limit.ts              # per-IP sliding window
    ├── types.ts                   # shared response types
    └── errors.ts                  # AppError with code + status
```
