import type { Command } from "commander";
import type { CliDeps } from "../io.js";
import { action, parseIntArg, renderJson } from "../shared.js";

export function registerSearchCommands(program: Command, deps: CliDeps): void {
  program
    .command("search [query]")
    .description("Search the lobby register")
    .option("--page <n>", "1-based page number", parseIntArg)
    .option("--page-size <n>", "results per page", parseIntArg)
    .option("--sort <order>", 'e.g. RELEVANCE_DESC, REGISTRATION_DESC')
    .option("--results-only", "print just the results array (not the envelope)")
    .action(
      action(deps, async ({ client, global, opts }, [query]) => {
        const result = await client.search({
          q: query,
          page: opts["page"] as number | undefined,
          pageSize: opts["pageSize"] as number | undefined,
          sort: opts["sort"] as string | undefined,
        });
        renderJson(deps, global, opts["resultsOnly"] ? result.results : result);
      }),
    );

  program
    .command("count [query]")
    .description("Count entries matching a query")
    .action(
      action(deps, async ({ client, global }, [query]) => {
        renderJson(deps, global, { query: query ?? null, resultCount: await client.count(query) });
      }),
    );
}
