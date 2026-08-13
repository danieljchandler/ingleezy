import type { ReactNode } from "react";

/**
 * Tiny markdown renderer for AI replies.
 * Handles: paragraphs, line breaks, **bold**, *italic*, `code`, and simple - / * bullet lists.
 * Skipping react-markdown saves ~35 kB gz on this chunk.
 *
 * `renderArabicRun`, when provided, receives each run of Arabic script inside
 * plain text so the host can make it interactive (tappable words); by default
 * Arabic renders as ordinary text.
 */

export type RenderArabicRun = (text: string, ctx: { block: string }) => ReactNode;

// A run of Arabic script plus the punctuation/spaces that join it.
const ARABIC_RUN = /[؀-ۿ][؀-ۿ\s،؟ـ]*/g;

function renderText(
  text: string,
  block: string,
  renderArabicRun: RenderArabicRun | undefined,
  keyStart: number,
): { nodes: ReactNode[]; key: number } {
  let key = keyStart;
  if (!renderArabicRun) return { nodes: [text], key };
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  ARABIC_RUN.lastIndex = 0;
  while ((match = ARABIC_RUN.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<span key={key++}>{renderArabicRun(match[0], { block })}</span>);
    last = ARABIC_RUN.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return { nodes, key };
}

export function renderInline(
  text: string,
  renderArabicRun?: RenderArabicRun,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  const pushText = (t: string) => {
    const r = renderText(t, text, renderArabicRun, key);
    key = r.key;
    nodes.push(...r.nodes);
  };
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) pushText(text.slice(last, match.index));
    const tok = match[0];
    if (tok.startsWith("**")) {
      const r = renderText(tok.slice(2, -2), text, renderArabicRun, 0);
      nodes.push(<strong key={key++}>{r.nodes}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const r = renderText(tok.slice(1, -1), text, renderArabicRun, 0);
      nodes.push(<em key={key++}>{r.nodes}</em>);
    }
    last = regex.lastIndex;
  }
  if (last < text.length) pushText(text.slice(last));
  return nodes;
}

export function TinyMarkdown({
  source,
  renderArabicRun,
}: {
  source: string;
  renderArabicRun?: RenderArabicRun;
}) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 my-1 space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, renderArabicRun)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*]\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1">
        {para.map((l, idx) => (
          <span key={idx}>
            {renderInline(l, renderArabicRun)}
            {idx < para.length - 1 && <br />}
          </span>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}
