import type { Command } from "commander";
import { logOf, type CliDeps } from "../io.js";
import type { SearchResult } from "../../client/types.js";
import type { SearchFilter } from "../../client/filters.js";
import { describeFilter } from "../../client/filters.js";
import { resultCountMismatch } from "../../client/client.js";
import { cutForMessage } from "../../client/errors.js";
import {
  ALLOW_UNKNOWN_FILTERS_HELP,
  FILTER_HELP,
  action,
  collectFilter,
  once,
  parseBoundedInt,
  parseNonEmpty,
  renderJson,
  unknownFilterNote,
} from "../shared.js";

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
    .option(
      "--page <n>",
      "1-based page number (1 or more; client-side paging)",
      once("--page", parseBoundedInt(1, Number.MAX_SAFE_INTEGER)),
    )
    .option(
      "--page-size <n>",
      "results per page (1 or more; client-side paging)",
      once("--page-size", parseBoundedInt(1, Number.MAX_SAFE_INTEGER)),
    )
    .option("--sort <order>", 'e.g. RELEVANCE_DESC, REGISTRATION_DESC', once("--sort", parseNonEmpty))
    .option(
      "--filter <attribute=value>",
      "register facet filter, e.g. revolvingdoordata=true (repeatable)",
      collectFilter,
    )
    .option("--allow-unknown-filters", ALLOW_UNKNOWN_FILTERS_HELP)
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
        const filters = opts["filter"] as SearchFilter[] | undefined;
        const { sortIgnored, ...result } = await client.search({
          q: query,
          page,
          pageSize,
          sort: opts["sort"] as string | undefined,
          filters,
          ...(opts["allowUnknownFilters"] === true ? { allowUnknownFilters: true } : {}),
        });
        // The client slices the page out of the full result set (the live
        // `/sucheJson` endpoint ignores paging and returns every match). The
        // envelope is printed as the API sent it; the client's `sortIgnored`
        // verdict becomes a stderr warning instead.
        renderJson(deps, global, opts["resultsOnly"] ? result.results : result);
        const note = unknownFilterNote(filters, result.resultCount);
        if (note !== undefined) logOf(deps).info("api", note);
        if (sortIgnored !== undefined) {
          logOf(deps).warn(
            "api",
            `the API did not apply --sort ${JSON.stringify(cutForMessage(sortIgnored.requested))} and sorted by ` +
              `${sortIgnored.applied} instead. Sort orders are upper case, e.g. REGISTRATION_DESC ` +
              "(see search --help).",
          );
        }
        if (pageSize !== undefined) {
          const order = sortOrderOf(result) ?? (opts["sort"] as string | undefined);
          if (order === undefined || order.startsWith("RELEVANCE")) {
            logOf(deps).info(
              "api",
              `the results are in relevance order (${order ?? "the default"}), which the ` +
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
    .option("--allow-unknown-filters", ALLOW_UNKNOWN_FILTERS_HELP)
    .addHelpText(
      "after",
      "\ncount takes an optional query, --filter and the global options. Paging/sorting " +
        "flags (--page, --page-size, --sort, --results-only) belong to `search`.\n" +
        FILTER_HELP,
    )
    .action(
      action(deps, async ({ client, global, opts }, [query]) => {
        const filters = opts["filter"] as SearchFilter[] | undefined;
        // What client.count() does (the same request, the same checks), keeping the
        // envelope so a resultCount that disagrees with the results can be named.
        const result = await client.search({
          ...(query !== undefined ? { q: query } : {}),
          ...(filters !== undefined ? { filters } : {}),
          ...(opts["allowUnknownFilters"] === true ? { allowUnknownFilters: true } : {}),
        });
        const resultCount = result.resultCount;
        renderJson(deps, global, {
          query: query ?? null,
          ...(filters !== undefined ? { filters: filters.map(describeFilter) } : {}),
          resultCount,
        });
        const mismatch = resultCountMismatch(result);
        if (mismatch !== undefined) logOf(deps).warn("api", mismatch);
        const note = unknownFilterNote(filters, resultCount);
        if (note !== undefined) logOf(deps).info("api", note);
      }),
    );
}
