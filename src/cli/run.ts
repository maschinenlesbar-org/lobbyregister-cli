// Run the CLI and resolve to a process exit code. Kept separate from the bin
// shim so tests can call run() directly with injected deps and assert on the
// captured output and exit code without spawning a subprocess.

import { CommanderError, type Command } from "commander";
import { buildProgram, defaultDeps } from "./program.js";
import { logOf, type CliDeps } from "./io.js";
import { createLogger, logFormatFromArgv } from "./log.js";
import {
  LobbyApiError,
  LobbyError,
  LobbyNetworkError,
  LobbyValidationError,
  credentialsIn,
  redactCredentials,
} from "../client/errors.js";

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
    // commander's own messages are log records too: its "error: …" an ERROR, the help it
    // shows after one an INFO.
    writeErr: (str) => {
      const text = str.replace(/\n$/, "");
      // The blank line commander writes between an error and the help it shows after.
      if (text === "") return;
      if (text.startsWith("error: ")) logOf(deps).error("cli", text.slice("error: ".length));
      else logOf(deps).info("cli", text);
    },
  });
  for (const child of command.commands) configureTree(child, deps);
}

/**
 * `deps` with an `io` that redacts the credentials of every argument from everything it
 * prints. Commander echoes rejected values in its errors (`argument '<value>' is
 * invalid`), names unknown commands and options, and a URL typed as a search term or a
 * filter ends up in an error message: whatever path a credential takes to stdout or
 * stderr, its exact userinfo (as `credentialsIn` finds it, plus its JSON-quoted form) is
 * replaced by `***`. A pattern alone can't delimit a password with spaces, quotes, `#`,
 * `?` or `/`; the exact strings can. Without credentials the output passes through
 * unchanged. (This CLI reads no environment variable, so the arguments are the only
 * source.)
 */
export function withRedactedOutput(deps: CliDeps, argv: readonly string[]): CliDeps {
  // An `--option=value` token is echoed as its value alone.
  const values = argv.map((token) =>
    token.startsWith("-") && token.includes("=") ? token.slice(token.indexOf("=") + 1) : token,
  );
  const secrets = new Set<string>();
  for (const source of [...argv, ...values]) {
    for (const secret of credentialsIn(source)) {
      secrets.add(secret);
      secrets.add(JSON.stringify(secret).slice(1, -1));
    }
  }
  if (secrets.size === 0) return deps;
  const list = [...secrets];
  const redact = (text: string): string => redactCredentials(text, list);
  return { ...deps, io: { out: (text) => deps.io.out(redact(text)), err: (text) => deps.io.err(redact(text)) } };
}

export async function run(argv: string[], deps: CliDeps = defaultDeps): Promise<number> {
  deps = withRedactedOutput(deps, argv);
  // Every record goes through the redacted `io.err`, so a secret is kept out of the
  // log in either format.
  const redacted = deps;
  deps = {
    ...deps,
    log: createLogger({ format: logFormatFromArgv(argv), write: (line) => redacted.io.err(line), ...(deps.now === undefined ? {} : { now: deps.now }) }),
  };
  const program = buildProgram(deps);
  configureTree(program, deps);

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    const log = logOf(deps);
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
      log.error("api", err.message);
      // For a 400 with no detail from the API, the request was rejected as
      // malformed — most often an unrecognised parameter value such as an
      // invalid --sort. Add a hint so the user gets more than a URL dump.
      if (err.status === 400 && !err.detail) {
        log.info(
          "api",
          "the API rejected a request parameter. Check --sort " +
            "(e.g. RELEVANCE_DESC, REGISTRATION_DESC) and other option values.",
        );
      }
      // Map a few notable statuses to distinct exit codes for scripting.
      if (err.status === 404) return 4;
      return 1;
    }
    if (err instanceof LobbyValidationError) {
      // An input the library rejected before any request (a library rule the
      // commander parsers did not already catch): a usage error, like commander's.
      log.error("cli", err.message);
      return USAGE_ERROR_EXIT_CODE;
    }
    if (err instanceof LobbyError) {
      log.error(err instanceof LobbyNetworkError ? "http" : "cli", err.message);
      return 1;
    }
    log.error("cli", `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
