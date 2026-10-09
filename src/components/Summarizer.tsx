"use client";

import { useState } from "react";

import Summary from "@/components/Summary";
import type { SummarizeResponse, SummarizeSuccess } from "@/lib/types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: SummarizeSuccess }
  | { status: "error"; message: string };

const EXAMPLES = [
  "https://en.wikipedia.org/wiki/Web_scraping",
  "https://developer.mozilla.org/en-US/docs/Web/HTTP",
  "https://blog.rust-lang.org/",
  "https://example.com",
];

export default function Summarizer() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const loading = state.status === "loading";

  async function summarize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setState({ status: "loading" });

    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      let data: SummarizeResponse;
      try {
        data = (await response.json()) as SummarizeResponse;
      } catch {
        throw new Error(`The server returned an unexpected response (HTTP ${response.status}).`);
      }

      if (!data.ok) throw new Error(data.error);

      setState({ status: "success", data });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  return (
    <div className="w-full max-w-3xl">
      <form onSubmit={summarize} className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="url" className="sr-only">
            Webpage URL
          </label>
          <input
            id="url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/article"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={loading}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-[15px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-white/10"
          />
          <button
            type="submit"
            disabled={loading || url.trim().length === 0}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 py-3 text-[15px] font-medium text-white transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-white/20 dark:focus:ring-offset-zinc-950"
          >
            {loading && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {loading ? "Loading…" : "Summarize"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={loading}
              onClick={() => setUrl(example)}
              className="max-w-full truncate rounded-full border border-zinc-300 px-3 py-1 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {new URL(example).hostname}
            </button>
          ))}
        </div>
      </form>

      <div aria-live="polite" aria-busy={loading} className="mt-8">
        {state.status === "loading" && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Loading… fetching the page and generating a summary.
            </p>
            <div className="mt-4 space-y-2.5" aria-hidden="true">
              {[100, 92, 96, 70].map((width) => (
                <div
                  key={width}
                  className="h-3 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
                  style={{ width: `${width}%` }}
                />
              ))}
            </div>
          </section>
        )}

        {state.status === "error" && (
          <section className="rounded-2xl border border-red-300 bg-red-50 p-5 text-[15px] text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">Couldn&apos;t summarize that page</p>
            <p className="mt-1 opacity-90">{state.message}</p>
          </section>
        )}

        {state.status === "success" && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <header className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
              <h2 className="text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                {state.data.title || state.data.finalUrl}
              </h2>
              {state.data.byline && (
                <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                  {state.data.byline}
                </p>
              )}
              <a
                href={state.data.finalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-1 inline-block break-all text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {state.data.finalUrl}
              </a>
            </header>

            <div className="py-5">
              <Summary markdown={state.data.summary} />
            </div>

            <footer className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {state.data.charCount.toLocaleString()} characters of text extracted
              {state.data.truncated && " (truncated for the model)"}
              {" · "}
              summarized with {state.data.model}
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
