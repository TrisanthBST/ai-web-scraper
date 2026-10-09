import Summarizer from "@/components/Summarizer";

export default function Home() {
  return (
    <main className="flex-1">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-6 py-16">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
            AI Web Scraper
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Paste a URL. The page&apos;s main text is extracted, then summarized
            with Google Gemini.
          </p>
        </header>

        <Summarizer />
      </div>
    </main>
  );
}
