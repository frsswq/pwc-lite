import { z } from "zod";

import type { ArxivId } from "../domain/arxiv-id";
import type { Concept } from "../domain/paper";
import { type HttpClient, SourceHttpError, checked, request } from "./http";

const source = "Papers with Code";
const api = "https://paperswithcode.co/api/v1/papers/arxiv";

/**
 * Time between requests.
 * The API is an anonymous beta for bounded lookups, not bulk export, so the client stays slow.
 */
export const pwcIntervalMs = 1000;

const conceptSchema = z.object({ slug: z.string().min(1), name: z.string().min(1) });

const paperSchema = z.object({
  arxiv_id: z.string().nullable(),
  tasks: z.array(conceptSchema).nullable(),
  methods: z.array(conceptSchema).nullable(),
});

export type PwcResult =
  | { readonly status: "found"; readonly concepts: readonly Concept[] }
  | { readonly status: "not_found" };

/** Fetches the tasks and methods of a paper. A paper that Papers with Code does not know gives `not_found`. */
export const fetchPaperConcepts = async (client: HttpClient, id: ArxivId): Promise<PwcResult> => {
  let response: Response;

  try {
    response = await request(client, {
      source,
      url: `${api}/${id}`,
      headers: { accept: "application/json", "user-agent": "pwc-lite" },
    });
  } catch (error) {
    if (error instanceof SourceHttpError && error.status === 404) {
      return { status: "not_found" };
    }

    throw error;
  }

  const body = checked(source, paperSchema.safeParse(await response.json()));

  return {
    status: "found",
    concepts: [
      ...(body.tasks ?? []).map(({ slug, name }): Concept => ({ kind: "task", slug, name })),
      ...(body.methods ?? []).map(({ slug, name }): Concept => ({ kind: "method", slug, name })),
    ],
  };
};
