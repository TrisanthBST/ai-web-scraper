import type { ReactNode } from "react";

/**
 * Renders the small Markdown subset the model is asked to produce (headings,
 * bold/italic, bullet and numbered lists).
 *
 * Deliberately not a general Markdown parser, and it builds React elements
 * directly instead of setting innerHTML, so text from the model or the scraped
 * page can never inject markup.
 */

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={`${keyPrefix}-i${index}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    index += 1;
    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ kind: "list", ordered: listOrdered, items: [...listItems] });
      listItems = [];
    }
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushAll();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);

    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (listItems.length > 0 && listOrdered !== ordered) flushList();
      listOrdered = ordered;
      listItems.push((bullet ? bullet[1] : numbered![1]).trim());
      continue;
    }

    // A short, wholly bolded line reads as a heading ("**Key points**").
    if (line.length < 80 && /^\*\*.+\*\*$/.test(line)) {
      flushAll();
      blocks.push({ kind: "heading", text: line.slice(2, -2) });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

export default function Summary({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);

  if (blocks.length === 0) {
    return <p className="text-sm opacity-70">The model returned no summary.</p>;
  }

  return (
    <div className="space-y-4 text-[15px] leading-relaxed">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h3
              key={index}
              className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
            >
              {renderInline(block.text, `h${index}`)}
            </h3>
          );
        }

        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={index}
              className={`space-y-2 pl-5 ${
                block.ordered ? "list-decimal" : "list-disc"
              } marker:text-zinc-400`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, `l${index}-${itemIndex}`)}</li>
              ))}
            </List>
          );
        }

        return (
          <p key={index}>{renderInline(block.text, `p${index}`)}</p>
        );
      })}
    </div>
  );
}
