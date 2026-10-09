export type ScrapeResult = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  byline: string | null;
  text: string;
  charCount: number;
  truncated: boolean;
};

export type SummarizeSuccess = {
  ok: true;
  url: string;
  finalUrl: string;
  title: string;
  byline: string | null;
  summary: string;
  charCount: number;
  truncated: boolean;
  model: string;
};

export type SummarizeFailure = {
  ok: false;
  error: string;
  code: string;
};

export type SummarizeResponse = SummarizeSuccess | SummarizeFailure;
