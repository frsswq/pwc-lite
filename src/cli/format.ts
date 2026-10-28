import type { Link, Paper } from "../domain/paper";
import type { LibraryItem } from "../query/library";
import type { LibraryEntry, PaperDetail, PaperSummary } from "../query/papers";

const lineWidth = 88;
const maxAuthors = 3;

const shortDate = (iso: string | null) => iso?.slice(0, 10) ?? "----------";

export const formatAuthors = (authors: readonly string[]): string =>
  authors.length > maxAuthors
    ? `${authors.slice(0, maxAuthors).join(", ")}, +${authors.length - maxAuthors}`
    : authors.join(", ");

export const wrap = (text: string, width: number, indent = ""): string => {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/)) {
    if (word === "") {
      continue;
    }

    if (line !== "" && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }

  if (line !== "") {
    lines.push(indent + line);
  }

  return lines.join("\n");
};

const metrics = (summary: PaperSummary): string => {
  const parts: string[] = [];

  if (summary.upvotes !== null) {
    parts.push(`↑${summary.upvotes}`);
  }

  if (summary.githubStars !== null) {
    parts.push(`★${summary.githubStars}`);
  }

  return parts.join(" ");
};

const idWidth = 10;

/** Formats one list entry as a title line and an author line. */
export const formatSummary = (summary: PaperSummary): string => {
  const { paper } = summary;

  const head =
    `${paper.id.padEnd(idWidth)}  ${shortDate(paper.publishedAt)}  ${metrics(summary)}`.trimEnd();

  const indent = " ".repeat(idWidth + 2);

  return `${head}\n${wrap(paper.title, lineWidth, indent)}\n${indent}${formatAuthors(paper.authors)}`;
};

export const formatSummaries = (summaries: readonly PaperSummary[], empty: string): string =>
  summaries.length === 0 ? empty : summaries.map(formatSummary).join("\n\n");

const arxivUrl = (paper: Paper) => `https://arxiv.org/abs/${paper.id}`;

const formatLink = (link: Link): string => {
  const popularity = link.popularity === null ? "" : `  ${link.popularity}`;

  return `  ${link.kind.padEnd(12)}  ${link.url}${popularity}`;
};

export const formatDetail = (detail: PaperDetail): string => {
  const { paper, links, signals } = detail;
  const version = paper.version === null ? "" : `v${paper.version}`;

  const facts = [
    `${paper.id}${version}`,
    paper.primaryCategory,
    `published ${shortDate(paper.publishedAt)}`,
    paper.updatedAt === null ? null : `updated ${shortDate(paper.updatedAt)}`,
  ].filter((fact) => fact !== null);

  const sections = [
    wrap(paper.title, lineWidth),
    facts.join(" · "),
    wrap(`Authors: ${paper.authors.join(", ")}`, lineWidth),
    arxivUrl(paper),
    wrap(paper.abstract, lineWidth),
  ];

  if (links.length > 0) {
    sections.push(["Links:", ...links.map(formatLink)].join("\n"));
  }

  const latest = signals.at(-1);

  if (latest !== undefined) {
    sections.push(`Upvotes: ${latest.score} (Daily Papers ${latest.observedOn})`);
  }

  if (detail.library !== null) {
    sections.push(formatLibraryEntry(detail.library, ""));
  }

  return sections.join("\n\n");
};

/** Formats the saved state, tags, and note of a paper, one per line. */
export const formatLibraryEntry = (entry: LibraryEntry, indent: string): string => {
  const lines = [
    entry.savedAt === null ? null : `Saved: ${shortDate(entry.savedAt)}`,
    entry.tags.length === 0 ? null : `Tags: ${entry.tags.join(", ")}`,
    entry.note === null ? null : wrap(`Note: ${entry.note}`, lineWidth, indent).trimStart(),
  ];

  return lines.flatMap((line) => (line === null ? [] : [indent + line])).join("\n");
};

export const formatLibrary = (items: readonly LibraryItem[]): string =>
  items.length === 0
    ? "The library is empty."
    : items
        .map(
          (item) =>
            `${formatSummary(item)}\n${formatLibraryEntry(item.library, " ".repeat(idWidth + 2))}`,
        )
        .join("\n\n");
