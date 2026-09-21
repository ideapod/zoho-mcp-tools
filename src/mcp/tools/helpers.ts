import { SprintsApiError } from "../../zoho/sprintsClient.js";

export interface NamedEntity {
  id: string;
  name: string;
}

/**
 * Resolves a user-supplied string (which may already be a numeric ID, an
 * exact name, or a partial name) against a list of Sprints entities that
 * only expose numeric IDs over the API. Exact case-insensitive name matches
 * win; otherwise falls back to a unique case-insensitive substring match.
 */
export function resolveEntityId(list: NamedEntity[], needle: string, kind: string): string {
  if (list.some((entry) => entry.id === needle)) return needle;

  const lower = needle.toLowerCase();
  const exact = list.find((entry) => entry.name.toLowerCase() === lower);
  if (exact) return exact.id;

  const partial = list.filter((entry) => entry.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0]!.id;
  if (partial.length > 1) {
    throw new Error(
      `"${needle}" matches multiple ${kind} (${partial.map((p) => p.name).join(", ")}). Be more specific or pass the numeric ID.`,
    );
  }

  throw new Error(`No ${kind} found matching "${needle}". Known values: ${list.map((e) => e.name).join(", ")}`);
}

export function toolTextResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function toolErrorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (error instanceof SprintsApiError) {
    const body = typeof error.body === "string" ? error.body : JSON.stringify(error.body);
    return { content: [{ type: "text", text: `${error.message}: ${body}` }], isError: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}
