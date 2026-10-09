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
  echoedCredentialForms,
  redactCredentials,
  redactSecrets,
} from "../client/errors.js";

/** Conventional CLI exit code for a usage error (bad/unknown option, no command). */
const USAGE_ERROR_EXIT_CODE = 2;

/**
 * Apply exitOverride + output redirection to every command in the tree.
 * commander does not propagate these to subcommands, so a parse error on a
 * subcommand would otherwise call process.exit() and bypass our error handling.
 */
function configureTree(command: Command, deps: CliDeps, state: { errorLogged: boolean } = { errorLogged: false }): void {
  command.exitOverride();
  command.configureOutput({
    writeOut: (str) => deps.io.out(str.replace(/\n$/, "")),
    writeErr: (str) => writeCommanderErr(command, deps, state, str),
  });
  for (const child of command.commands) configureTree(child, deps, state);
}

/** `lobbyregister search`: the command's name with its parents'. */
function commandPath(command: Command): string {
  const names: string[] = [];
  for (let c: Command | null = command; c !== null; c = c.parent) names.unshift(c.name());
  return names.join(" ");
}

/**
 * commander's stderr output as log records, one per line. Its `error: …` is an ERROR of
 * `cli`, with a following `(Did you mean …?)` line appended to that same record; the
 * help it shows after an error is one INFO record per non-blank line. A run without a
 * command (`lobbyregister`, `lobbyregister --compact`, `lobbyregister help nosuch`)
 * makes commander show the help as an error (exit 1, so 2 here) with no `error:` line:
 * an ERROR record "missing command: `lobbyregister <subcommand>`" comes first, so every
 * failed run has one.
 */
function writeCommanderErr(command: Command, deps: CliDeps, state: { errorLogged: boolean }, str: string): void {
  const log = logOf(deps);
  const text = str.replace(/\n$/, "");
  // The blank line commander writes between an error and the help it shows after.
  if (text.trim() === "") return;
  if (text.startsWith("error: ")) {
    state.errorLogged = true;
    log.error("cli", text.slice("error: ".length).replace(/\n(\(Did you mean .*\?\))$/, " $1"));
    return;
  }
  if (!state.errorLogged) {
    state.errorLogged = true;
    log.error("cli", `missing command: \`${commandPath(command)} <subcommand>\``);
  }
  for (const line of text.split("\n")) if (line.trim() !== "") log.info("cli", line.trimEnd());
}

/**
 * The options whose value is the base URL: a `user:password@host` given there without
 * its scheme is still a credential (anywhere else a bare `a:b@c` is not).
 */
const BASE_URL_FLAGS = ["--base-url"];

/** The values of the `flags` in `argv`, in both forms (`--flag value`, `--flag=value`). */
function flagValues(argv: readonly string[], flags: readonly string[]): string[] {
  const found: string[] = [];
  argv.forEach((token, i) => {
    const next = argv[i + 1];
    if (flags.includes(token) && next !== undefined) found.push(next);
    const eq = token.indexOf("=");
    if (eq > 0 && flags.includes(token.slice(0, eq))) found.push(token.slice(eq + 1));
  });
  return found;
}

/** The secrets of a run, and the two ways they are replaced. */
export interface Redaction {
  /** stdout text: the userinfo of every URL argument replaced (`***@`). */
  out(text: string): string;
  /** stderr text, a record's message: that, and the bare password of a userinfo (`***`). */
  err(text: string): string;
}

/**
 * The secrets of the run in `argv`. Commander echoes rejected values in its errors
 * (`argument '<value>' is invalid`), names unknown commands and options, and a URL typed
 * as a search term or a filter ends up in an error message: whatever path a credential
 * takes to stdout or stderr, its exact userinfo (as `credentialsIn` finds it, plus its
 * JSON-quoted form) is replaced by `***`. A pattern alone can't delimit a password with
 * spaces, quotes, `#`, `?` or `/`; the exact strings can. Without credentials the text
 * passes through unchanged. (This CLI reads no environment variable, so the arguments
 * are the only source.)
 */
export function redactionFor(argv: readonly string[]): Redaction {
  // An `--option=value` token is echoed as its value alone.
  const values = argv.map((token) =>
    token.startsWith("-") && token.includes("=") ? token.slice(token.indexOf("=") + 1) : token,
  );
  const secrets = new Set<string>();
  const echoed = new Set<string>();
  const passwords = new Set<string>();
  // A base URL typed without its scheme is read as if it had one.
  const baseUrls = flagValues(argv, BASE_URL_FLAGS).map((value) => (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) ? value : `http://${value}`));
  for (const source of [...values, ...baseUrls]) {
    for (const secret of credentialsIn(source)) {
      secrets.add(secret);
      secrets.add(JSON.stringify(secret).slice(1, -1));
      // What a server echoes back: the Basic value and the decoded user:password on
      // stdout and stderr, the password alone (it may well occur in the data) on stderr.
      const [basic, pair, password] = echoedCredentialForms(secret);
      if (basic !== undefined) echoed.add(basic);
      if (pair !== undefined) echoed.add(pair);
      if (password !== undefined) passwords.add(password);
    }
  }
  if (secrets.size === 0) return { out: (text) => text, err: (text) => text };
  const list = [...secrets];
  // Longest first, so a password never leaves half of the user:password around it.
  const echoedList = [...echoed].sort((a, b) => b.length - a.length);
  const passwordList = [...passwords].sort((a, b) => b.length - a.length);
  const out = (text: string): string => redactSecrets(redactCredentials(text, list), echoedList);
  return { out, err: (text) => redactSecrets(out(text), passwordList) };
}

/**
 * `deps` that keep the secrets of this run (`redactionFor`) out of everything they
 * print: `io.out` is redacted, and the log (`deps.log`) replaces them in each record's
 * message before formatting it, then writes to the raw `io.err`, so the frame is never
 * touched and a password holding DEL, C1 or bidi characters is matched before the record
 * escapes it. `io.err` itself is redacted too, for anything that writes to stderr without
 * the log.
 */
export function withRedactedOutput(deps: CliDeps, argv: readonly string[]): CliDeps {
  const redaction = redactionFor(argv);
  const { out, err } = deps.io;
  return {
    ...deps,
    io: { ...deps.io, out: (text) => out(redaction.out(text)), err: (text) => err(redaction.err(text)) },
    log: createLogger({
      format: logFormatFromArgv(argv),
      write: err,
      redact: redaction.err,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    }),
  };
}

export async function run(argv: string[], deps: CliDeps = defaultDeps): Promise<number> {
  // The log replaces the secrets of the run in every message, in either format.
  deps = withRedactedOutput(deps, argv);
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
