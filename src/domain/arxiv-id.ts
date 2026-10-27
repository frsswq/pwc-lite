declare const arxivIdBrand: unique symbol;

/** A canonical arXiv identifier without version, such as `2610.31329` or `cs/0112017`. */
export type ArxivId = string & { readonly [arxivIdBrand]: true };

export type ParsedArxivId = {
  readonly id: ArxivId;
  readonly version: number | null;
};

const newStyle = /^(\d{4}\.\d{4,5})(?:v(\d+))?$/;
const oldStyle = /^([a-z-]+)(?:\.[a-z]{2})?\/(\d{7})(?:v(\d+))?$/i;
const urlPath = /^\/(?:abs|pdf|html|papers)\/(.+?)(?:\.pdf)?\/?$/;

const knownHosts = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "huggingface.co",
  "hf.co",
]);

const toVersion = (digits: string | undefined): number | null =>
  digits === undefined ? null : Number(digits);

const brand = (value: string): ArxivId =>
  // SAFETY: callers pass only text that matched `newStyle` or `oldStyle`.
  value as ArxivId;

const fromIdentifier = (text: string): ParsedArxivId | null => {
  const modern = newStyle.exec(text);

  if (modern?.[1] !== undefined) {
    return { id: brand(modern[1]), version: toVersion(modern[2]) };
  }

  const legacy = oldStyle.exec(text);

  if (legacy?.[1] !== undefined && legacy[2] !== undefined) {
    return { id: brand(`${legacy[1].toLowerCase()}/${legacy[2]}`), version: toVersion(legacy[3]) };
  }

  return null;
};

const fromUrl = (text: string): ParsedArxivId | null => {
  if (!URL.canParse(text)) {
    return null;
  }

  const url = new URL(text);
  const path = urlPath.exec(url.pathname)?.[1];

  return knownHosts.has(url.hostname) && path !== undefined ? fromIdentifier(path) : null;
};

/**
 * Parses an arXiv ID, an `arXiv:` reference, or an arXiv or Hugging Face paper URL.
 *
 * Old style IDs drop the subject class, because arXiv treats `math.GT/0309136` and `math/0309136` as the same paper.
 */
export const parseArxivId = (input: string): ParsedArxivId | null => {
  const text = input.trim().replace(/^arxiv:/i, "");

  return fromIdentifier(text) ?? fromUrl(text);
};
