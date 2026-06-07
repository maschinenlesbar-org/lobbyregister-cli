import type { Command } from "commander";
import type { CliDeps } from "../io.js";
import type { SearchResult } from "../../client/types.js";
import { action, parseIntArg, renderJson } from "../shared.js";

/**
 * Apply client-side pagination to a search envelope.
 *
 * The live `/sucheJson` endpoint ignores `page`/`pageSize` and returns every
 * match, so we slice the `results` array ourselves. `resultCount` is left as the
 * API reported it (the true total number of matches); only the visible slice is
 * trimmed. With neither flag set the envelope is returned unchanged.
 */
function paginate(result: SearchResult, page?: number, pageSize?: number): SearchResult {
  if (pageSize === undefined && page === undefined) return result;
  // A 1-based page number; default to the first page when only --page-size is set.
  const effectivePage = page !== undefined ? Math.max(page, 1) : 1;
  // Without an explicit size, --page alone slices from that page to the end.
  const start = pageSize !== undefined ? (effectivePage - 1) * pageSize : 0;
  const end = pageSize !== undefined ? start + pageSize : undefined;
  return { ...result, results: result.results.slice(start, end) };
}

export function registerSearchCommands(program: Command, deps: CliDeps): void {
  program
    .command("search [query]")
    .description("Search the lobby register")
    .option("--page <n>", "1-based page number (client-side paging)", parseIntArg)
    .option("--page-size <n>", "results per page (client-side paging)", parseIntArg)
    .option("--sort <order>", 'e.g. RELEVANCE_DESC, REGISTRATION_DESC')
    .option("--results-only", "print just the results array (not the envelope)")
    .addHelpText(
      "after",
      "\nTo search a term that starts with a dash, end the options with `--`, " +
        'e.g. `search -- -foo` searches for "-foo".',
    )
    .action(
      action(deps, async ({ client, global, opts }, [query]) => {
        const page = opts["page"] as number | undefined;
        const pageSize = opts["pageSize"] as number | undefined;
        const result = await client.search({
          q: query,
          page,
          pageSize,
          sort: opts["sort"] as string | undefined,
        });
        // The live `/sucheJson` endpoint ignores `page`/`pageSize` and always
        // returns the full result set, so honour these flags client-side by
        // slicing the returned `results` array. This keeps `--page`/`--page-size`
        // meaningful instead of being silent no-ops.
        const paged = paginate(result, page, pageSize);
        renderJson(deps, global, opts["resultsOnly"] ? paged.results : paged);
      }),
    );

  program
    .command("count [query]")
    .description("Count entries matching a query")
    .addHelpText(
      "after",
      "\ncount takes only an optional query and the global options. Paging/sorting " +
        "flags (--page, --page-size, --sort, --results-only) belong to `search`.",
    )
    .action(
      action(deps, async ({ client, global }, [query]) => {
        renderJson(deps, global, { query: query ?? null, resultCount: await client.count(query) });
      }),
    );
}
