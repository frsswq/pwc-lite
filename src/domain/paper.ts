import type { ArxivId } from "./arxiv-id";

export const addedViaValues = ["hf_daily", "hf_hub", "manual"] as const;

export type AddedVia = (typeof addedViaValues)[number];

export const linkKinds = ["github", "hf_model", "hf_dataset", "hf_space", "project_page"] as const;

export type LinkKind = (typeof linkKinds)[number];

export const hubLinkKinds = [
  "hf_model",
  "hf_dataset",
  "hf_space",
] as const satisfies readonly LinkKind[];

export type HubLinkKind = (typeof hubLinkKinds)[number];

export const signalSources = ["hf_daily_upvotes"] as const;

export type SignalSource = (typeof signalSources)[number];

/** Paper metadata from a source, before the catalog stores it. */
export type PaperRecord = {
  readonly id: ArxivId;
  readonly version: number | null;
  readonly title: string;
  readonly abstract: string;
  readonly authors: readonly string[];
  /** ISO 8601 date and time in UTC. */
  readonly publishedAt: string | null;
  /** ISO 8601 date and time in UTC. */
  readonly updatedAt: string | null;
  readonly primaryCategory: string | null;
  readonly categories: readonly string[];
  readonly doi: string | null;
};

export type Link = {
  readonly paperId: ArxivId;
  readonly kind: LinkKind;
  /** Stable ID inside the link kind, such as `owner/repo` for GitHub. */
  readonly externalId: string;
  readonly url: string;
  /** Stars, likes, or downloads, depending on the kind. */
  readonly popularity: number | null;
  readonly lastActivityAt: string | null;
};

export type Signal = {
  readonly paperId: ArxivId;
  readonly source: SignalSource;
  /** ISO 8601 date, such as `2026-10-23`. */
  readonly observedOn: string;
  readonly score: number;
};

/** A paper as the catalog stores it. */
export type Paper = PaperRecord & {
  readonly addedVia: AddedVia;
  readonly ingestedAt: string;
  readonly arxivFetchedAt: string | null;
};

export const conceptKinds = ["task", "method"] as const;

export type ConceptKind = (typeof conceptKinds)[number];

/** A research task or method from Papers with Code. */
export type Concept = {
  readonly kind: ConceptKind;
  /** Lower-case identifier such as `object-detection`. */
  readonly slug: string;
  readonly name: string;
};

/** Converts a task or method name, or a slug, into slug form. */
export const toConceptSlug = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-|-$/g, "");
