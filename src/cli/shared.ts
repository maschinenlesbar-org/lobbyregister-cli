// Shared helpers used across CLI command groups: option parsers, the global
// option resolver, and the JSON result renderer.

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import type { CliDeps } from "./io.js";
import { DEFAULT_BASE_URL, baseUrlProblem, cleartextProblem, type EngineOptions } from "../client/engine.js";
import { headerValueProblem, intInRangeProblem, nonEmptyProblem } from "../client/validate.js";
import { SEARCH_FILTER_ATTRIBUTES, isKnownFilter, parseFilter, describeFilter, type SearchFilter } from "../client/filters.js";
import { LobbyError } from "../client/errors.js";

/**
 * commander value-parser: a non-negative decimal integer.
 *
 * Strict by design — only a plain run of ASCII digits is accepted. This rejects
 * the values `Number()` would otherwise silently coerce: hex/binary/octal
 * literals (`0x10`, `0b10`, `0o17`), scientific notation (`1e3`), a leading `+`,
 * surrounding whitespace, and the empty string (`Number("")` is `0`). Values
 * beyond `Number.MAX_SAFE_INTEGER` are rejected too, since they cannot be
 * represented exactly.
 */
export function parseIntArg(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new InvalidArgumentError(
      `Value out of range; must be between 0 and ${Number.MAX_SAFE_INTEGER}.`,
    );
  }
  return n;
}

/**
 * commander value-parser: a value that is not blank. The rule is the library's
 * nonEmptyProblem, which the client enforces on `q` and `sort` too; here it only
 * turns a blank value into an early usage error.
 */
export function parseNonEmpty(value: string): string {
  const reason = nonEmptyProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/**
 * commander value-parser for a value that ends up in an HTTP header (`--user-agent`).
 * The rule is the library's headerValueProblem — blank, control characters other
 * than tab, and characters above U+00FF are rejected, as the client does for its
 * `userAgent` option — so a bad value is a usage error (exit 2) here instead of an
 * opaque failure at request time.
 */
export function parseHeaderValue(value: string): string {
  const reason = headerValueProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/**
 * Wrap a commander value-parser so its option may be given only once. Commander keeps
 * the last of a repeated single-value option silently: `--sort NAME_ASC --sort
 * NAME_DESC` sorted by name descending without a word. A repetition is a usage error
 * instead. The program is built anew for every run, so the flag starts fresh each
 * time.
 */
export function once<T>(flag: string, parser: (value: string) => T): (value: string) => T {
  let seen = false;
  return (value: string) => {
    if (seen) throw new InvalidArgumentError(`${flag} may be given only once.`);
    seen = true;
    return parser(value);
  };
}

/**
 * commander value-parser for the repeatable `--filter <attribute=value>`: parses
 * one facet filter with the library's parseFilter — trimmed, the attribute
 * compared case-insensitively and sent in lower case, the value in the register's
 * spelling (`foi_energy` → `FOI_ENERGY`, `FOI_EU_LAWS` →
 * `FOI_EUROPEAN_UNION|FOI_EU_LAWS`) — and appends it to the ones given before.
 * Whether the attribute and value are ones the register knows is checked by the
 * client when the command runs, so that `--allow-unknown-filters` can lift that
 * check wherever it stands on the command line; the rejection is a usage error
 * (exit 2) all the same, before any request. Only the guard against a swallowed
 * option is CLI-specific.
 */
export function collectFilter(value: string, previous: SearchFilter[] | undefined): SearchFilter[] {
  if (value.startsWith("--")) {
    throw new InvalidArgumentError(
      "Expected a value, got another option. Give the option its value first.",
    );
  }
  try {
    return [...(previous ?? []), parseFilter(value, { allowUnknown: true })];
  } catch (err) {
    if (err instanceof LobbyError) throw new InvalidArgumentError(err.message);
    throw err;
  }
}

/** Help text shared by the commands that take `--filter`. */
export const FILTER_HELP =
  "\nFilters (--filter attribute=value, repeatable) are the facets of the register's " +
  "website search, e.g. revolvingdoordata=true, activelobbyist=false, " +
  "fieldsofinterest=FOI_ENERGY, donationsreceived=DONATIONS_RECEIVED. Values of one attribute " +
  "are alternatives; different attributes must all match. The values are the register's codes " +
  "(matched case-insensitively); a field-of-interest code from the data such as FOI_EU_LAWS is " +
  "sent with its parent (FOI_EUROPEAN_UNION|FOI_EU_LAWS). The register matches nothing for a " +
  "value it doesn't know, so an unknown attribute or value is a usage error naming the valid ones; " +
  "--allow-unknown-filters sends it anyway (for a code added after this release). Attributes: " +
  SEARCH_FILTER_ATTRIBUTES.join(", ") +
  ".";

/** Help for `--allow-unknown-filters`. */
export const ALLOW_UNKNOWN_FILTERS_HELP =
  "send a --filter attribute or value this release doesn't know (the register may ignore it or match nothing)";

/**
 * The stderr note for a reply of 0 entries when a filter was sent that the catalogue
 * doesn't know (only possible with `--allow-unknown-filters`): the register matches
 * nothing for a value it doesn't know, so "none" may be a typo. Undefined otherwise.
 */
export function unknownFilterNote(filters: readonly SearchFilter[] | undefined, resultCount: number): string | undefined {
  if (resultCount !== 0 || filters === undefined) return undefined;
  const unknown = filters.filter((f) => !isKnownFilter(f));
  if (unknown.length === 0) return undefined;
  return (
    `Note: no entry matched. ${unknown.map((f) => `--filter ${describeFilter(f)}`).join(", ")} ` +
    `${unknown.length === 1 ? "is" : "are"} not in this release's list of codes, and the register ` +
    "matches nothing for a value it doesn't know; check the spelling."
  );
}

/**
 * Build a commander value-parser for a non-negative integer within [min, max]:
 * parseIntArg turns the string into a number, and the range is the library's
 * intInRangeProblem, the rule the client enforces on its options too.
 */
export function parseBoundedInt(min: number, max: number): (value: string) => number {
  const problem = intInRangeProblem(min, max);
  return (value: string) => {
    const n = parseIntArg(value);
    const reason = problem(n);
    if (reason !== undefined) throw new InvalidArgumentError(reason);
    return n;
  };
}

/**
 * commander value-parser: an absolute http(s) URL. The rule is the library's
 * baseUrlProblem, which the client enforces when it is built; here a malformed
 * value or a non-http(s) scheme (`file:`, `ftp:`) becomes a usage error at parse
 * time.
 */
export function parseBaseUrl(value: string): string {
  const reason = baseUrlProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

export interface GlobalOptions {
  baseUrl?: string;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  compact?: boolean;
}

/** Translate resolved global CLI options into client EngineOptions. */
export function toEngineOptions(global: GlobalOptions): EngineOptions {
  const options: EngineOptions = {};
  if (global.baseUrl !== undefined) options.baseUrl = global.baseUrl;
  if (global.timeout !== undefined) options.timeoutMs = global.timeout;
  if (global.userAgent !== undefined) options.userAgent = global.userAgent;
  if (global.maxRetries !== undefined) options.maxRetries = global.maxRetries;
  if (global.maxRedirects !== undefined) options.maxRedirects = global.maxRedirects;
  if (global.maxResponseBytes !== undefined) options.maxResponseBytes = global.maxResponseBytes;
  return options;
}

/**
 * Escape the control characters JSON.stringify leaves raw. It escapes C0 (including
 * ESC) but not DEL or the C1 range U+0080–U+009F, and terminals may act on those —
 * U+009B is the 8-bit form of CSI. The output is server data, so escape them; the
 * result is equivalent, valid JSON (these characters only occur inside strings).
 * Checked by char code so the source stays free of control bytes.
 */
export function escapeControlChars(json: string): string {
  let result = "";
  let from = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c >= 0x7f && c <= 0x9f) {
      result += json.slice(from, i) + "\\u" + c.toString(16).padStart(4, "0");
      from = i + 1;
    }
  }
  return from === 0 ? json : result + json.slice(from);
}

/** Render a JSON value to stdout, pretty by default, compact with --compact. */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = escapeControlChars(global.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  deps.io.out(text);
}

export interface ActionContext {
  client: ReturnType<CliDeps["createClient"]>;
  global: GlobalOptions;
  /** This command's own parsed options. */
  opts: Record<string, unknown>;
  /** The commander command, e.g. for `command.error()` usage errors. */
  command: Command;
}

/**
 * Wrap an async command action with consistent global-option resolution and
 * client construction. The callback receives a context (client + resolved global
 * options + this command's options) and the command's positional arguments.
 *
 * Before the client is built (so before the first request) it writes one
 * `warning: <sentence>` line to stderr when the base URL is plain `http:` to a host
 * other than loopback (cleartextProblem). Help, version and usage errors never reach
 * an action, so they never warn.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    const cleartext = cleartextProblem(global.baseUrl ?? DEFAULT_BASE_URL);
    if (cleartext !== undefined) deps.io.err(`warning: ${cleartext}`);
    const client = deps.createClient(toEngineOptions(global));
    await fn({ client, global, opts: command.opts(), command }, positionals);
  };
}
