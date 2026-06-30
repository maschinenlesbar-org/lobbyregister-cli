// Run the CLI and resolve to a process exit code. Kept separate from the bin
// shim so tests can call run() directly with injected deps and assert on the
// captured output and exit code without spawning a subprocess.

import { CommanderError, type Command } from "commander";
import { buildProgram, defaultDeps } from "./program.js";
import type { CliDeps } from "./io.js";
import { LobbyApiError, LobbyError } from "../client/errors.js";

/** Conventional CLI exit code for a usage error (bad/unknown option, no command). */
const USAGE_ERROR_EXIT_CODE = 2;

/**
 * Apply exitOverride + output redirection to every command in the tree.
 * commander does not propagate these to subcommands, so a parse error on a
 * subcommand would otherwise call process.exit() and bypass our error handling.
 */
function configureTree(command: Command, deps: CliDeps): void {
  command.exitOverride();
  command.configureOutput({
    writeOut: (str) => deps.io.out(str.replace(/\n$/, "")),
    writeErr: (str) => deps.io.err(str.replace(/\n$/, "")),
  });
  for (const child of command.commands) configureTree(child, deps);
}

export async function run(argv: string[], deps: CliDeps = defaultDeps): Promise<number> {
  const program = buildProgram(deps);
  configureTree(program, deps);

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // An explicitly requested help/version is a successful, intentional output:
      // exit 0. This covers `--help`/`-h` (commander.helpDisplayed), `--version`
      // (commander.version), and the `help` / `help <subcommand>` command — the
      // last raises commander.help but with exitCode 0 (commander's own verdict
      // that it succeeded). The no-command auto-help raised by help({error:true})
      // also uses commander.help but with exitCode 1, so it is NOT caught here.
      if (
        err.code === "commander.helpDisplayed" ||
        err.code === "commander.version" ||
        (err.code === "commander.help" && err.exitCode === 0)
      ) {
        return 0;
      }
      // Everything else from commander is a usage error: an unknown option, an
      // unknown/missing command, a bad argument value, or the auto-help shown
      // when no command was given. Map these to a dedicated exit code (2, the
      // conventional CLI usage-error code) so scripts can tell a usage mistake
      // from a runtime/network error (1) or a 404 (4), rather than collapsing
      // them all onto 1.
      return USAGE_ERROR_EXIT_CODE;
    }
    if (err instanceof LobbyApiError) {
      // err.message already includes any human-readable `detail` the API
      // returned (see LobbyApiError); surface it as-is.
      deps.io.err(`Error: ${err.message}`);
      // For a 400 with no detail from the API, the request was rejected as
      // malformed — most often an unrecognised parameter value such as an
      // invalid --sort. Add a hint so the user gets more than a URL dump.
      if (err.status === 400 && !err.detail) {
        deps.io.err(
          "Hint: the API rejected a request parameter. Check --sort " +
            "(e.g. RELEVANCE_DESC, REGISTRATION_DESC) and other option values.",
        );
      }
      // Map a few notable statuses to distinct exit codes for scripting.
      if (err.status === 404) return 4;
      return 1;
    }
    if (err instanceof LobbyError) {
      deps.io.err(`Error: ${err.message}`);
      return 1;
    }
    deps.io.err(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
