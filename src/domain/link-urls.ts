export type LinkTarget = {
  /** Stable ID inside the link kind. */
  readonly externalId: string;
  /** Canonical URL. */
  readonly url: string;
};

const githubHosts = new Set(["github.com", "www.github.com"]);
const repoSegment = /^[\w.-]+$/;

/** Parses a GitHub repository URL, including deep links into the repository, into `owner/repo`. */
export const parseGithubRepo = (input: string): LinkTarget | null => {
  if (!URL.canParse(input.trim())) {
    return null;
  }

  const url = new URL(input.trim());
  const [owner, rawRepo] = url.pathname.split("/").slice(1, 3);
  const repo = rawRepo?.replace(/\.git$/, "");

  if (
    !githubHosts.has(url.hostname) ||
    owner === undefined ||
    repo === undefined ||
    !repoSegment.test(owner) ||
    !repoSegment.test(repo)
  ) {
    return null;
  }

  return {
    externalId: `${owner}/${repo}`.toLowerCase(),
    url: `https://github.com/${owner}/${repo}`,
  };
};

/** Normalizes an http or https URL, so that the same page gives the same ID. */
export const parseWebPage = (input: string): LinkTarget | null => {
  if (!URL.canParse(input.trim())) {
    return null;
  }

  const url = new URL(input.trim());

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  url.hash = "";

  const text = url.toString().replace(/\/$/, "");

  return { externalId: text.replace(/^https?:\/\//, "").toLowerCase(), url: text };
};
