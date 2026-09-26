import type { Command } from "commander";
import type { CliDeps } from "../io.js";
import type { SearchResult } from "../../client/types.js";
import type { SearchFilter } from "../../client/filters.js";
import { describeFilter } from "../../client/filters.js";
import {
  FILTER_HELP,
  action,
  collectFilter,
  parseIntArg,
  parseNonEmpty,
  renderJson,
} from "../shared.js";

/**
 * Apply client-side pagination to a search envelope.
 *
 * The live `/sucheJson` endpoint ignores `page`/`pageSize` and returns every
 * match, so we slice the `results` array ourselves. `resultCount` is left as the
 * API reported it (the true total number of matches); only the visible slice is
 * trimmed. With neither flag set the envelope is returned unchanged.
 */
function paginate(result: SearchResult, page?: number, pageSize?: number): SearchResult {
  // `--page` without `--page-size` is rejected up front (see the action), so by
  // here either both are set or only `--page-size` is.
  if (pageSize === undefined) return result;
  // A 1-based page number; default to the first page when only --page-size is set.
  const effectivePage = page !== undefined ? Math.max(page, 1) : 1;
  const start = (effectivePage - 1) * pageSize;
  const end = start + pageSize;
  return { ...result, results: result.results.slice(start, end) };
}

/** The sort orders of the register's website search (2026-09-26), for --help. */
const SORT_HELP =
  "\nSort orders (--sort; each also in the other direction, _ASC/_DESC): RELEVANCE_DESC (the default with a query), " +
  "REGISTRATION_DESC (first published), UPDATE_DESC, INACTIVITY_DESC, NAME_ASC, " +
  "FINANCIALEXPENSES_DESC, DONATIONAMOUNT_DESC, MEMBERSHIPFEES_DESC, " +
  "NUMBEROFREGULATORYPROJECTS_DESC, NUMBEROFSTATEMENTS_DESC, NUMBEROFFTE_DESC, " +
  "NUMBEROFENTRUSTEDPERSONS_DESC, NUMBEROFCONTRACTS_DESC, NUMBEROFMEMBERS_DESC, " +
  "NUMBEROFMEMBERSHIPS_DESC. The API ignores an unknown value and falls back to its " +
  "default order; the CLI then warns on stderr.\n";

/** The sort order the server says it applied (`searchParameters.sortOrder`), if any. */
function sortOrderOf(result: SearchResult): string | undefined {
  const order = result.searchParameters?.["sortOrder"];
  return typeof order === "string" ? order : undefined;
}

export function registerSearchCommands(program: Command, deps: CliDeps): void {
  program
    .command("search")
    .description("Search the lobby register")
    .argument("[query]", "free-text search term (omit to match everything)", parseNonEmpty)
    .option("--page <n>", "1-based page number (client-side paging)", parseIntArg)
    .option("--page-size <n>", "results per page (client-side paging)", parseIntArg)
    .option("--sort <order>", 'e.g. RELEVANCE_DESC, REGISTRATION_DESC', parseNonEmpty)
    .option(
      "--filter <attribute=value>",
      "register facet filter, e.g. revolvingdoordata=true (repeatable)",
      collectFilter,
    )
    .option("--results-only", "print just the results array (not the envelope)")
    .addHelpText(
      "after",
      "\nTo search a term that starts with a dash, end the options with `--`, " +
        'e.g. `search -- -foo` searches for "-foo".\n' +
        SORT_HELP +
        FILTER_HELP,
    )
    .action(
      action(deps, async ({ client, global, opts, command }, [query]) => {
        const page = opts["page"] as number | undefined;
        const pageSize = opts["pageSize"] as number | undefined;
        // `--page` alone has no meaning: paging is a client-side slice, and an
        // offset cannot be computed without a page size. Reject it as a usage
        // error instead of silently returning the whole result set.
        if (page !== undefined && pageSize === undefined) {
          command.error("--page requires --page-size.", {
            exitCode: 2,
            code: "lobbyregister.pageWithoutPageSize",
          });
        }
        const result = await client.search({
          q: query,
          page,
          pageSize,
          sort: opts["sort"] as string | undefined,
          filters: opts["filter"] as SearchFilter[] | undefined,
        });
        // The live `/sucheJson` endpoint ignores `page`/`pageSize` and always
        // returns the full result set, so honour these flags client-side by
        // slicing the returned `results` array. This keeps `--page`/`--page-size`
        // meaningful instead of being silent no-ops.
        const paged = paginate(result, page, pageSize);
        renderJson(deps, global, opts["resultsOnly"] ? paged.results : paged);
        const requested = opts["sort"] as string | undefined;
        const applied = sortOrderOf(result);
        if (requested !== undefined && applied !== undefined && applied !== requested) {
          deps.io.err(
            `Warning: the API did not apply --sort ${JSON.stringify(requested)} and sorted by ` +
              `${applied} instead. Sort orders are upper case, e.g. REGISTRATION_DESC ` +
              "(see search --help).",
          );
        }
        if (pageSize !== undefined) {
          const order = sortOrderOf(result) ?? (opts["sort"] as string | undefined);
          if (order === undefined || order.startsWith("RELEVANCE")) {
            deps.io.err(
              `Note: the results are in relevance order (${order ?? "the default"}), which the ` +
                "register does not keep stable between requests, so pages from separate runs can " +
                "repeat or miss entries. To page across runs, sort by date (--sort " +
                "REGISTRATION_DESC), or fetch once and slice.",
            );
          }
        }
      }),
    );

  program
    .command("count")
    .description("Count entries matching a query")
    .argument("[query]", "free-text search term (omit to match everything)", parseNonEmpty)
    .option(
      "--filter <attribute=value>",
      "register facet filter, e.g. revolvingdoordata=true (repeatable)",
      collectFilter,
    )
    .addHelpText(
      "after",
      "\ncount takes an optional query, --filter and the global options. Paging/sorting " +
        "flags (--page, --page-size, --sort, --results-only) belong to `search`.\n" +
        FILTER_HELP,
    )
    .action(
      action(deps, async ({ client, global, opts }, [query]) => {
        const filters = opts["filter"] as SearchFilter[] | undefined;
        const resultCount = await client.count(query, filters);
        renderJson(deps, global, {
          query: query ?? null,
          ...(filters !== undefined ? { filters: filters.map(describeFilter) } : {}),
          resultCount,
        });
      }),
    );
}
