// Input validation shared by the library and the CLI. Every rule about what a
// request may contain lives here (or next to the option it guards) as a pure,
// exported function, so the CLI calls the very same rule instead of keeping a copy.
//
// - A `Problem` returns the reason a value is invalid ("Expected a non-empty
//   value."), or `undefined` when it is valid. The CLI's commander parsers turn
//   that reason into an `InvalidArgumentError` (exit 2).
// - `assertValid` runs a `Problem` in the library and throws a
//   `LobbyValidationError` ("Invalid <name>: <reason>") before any request is
//   made. Methods that return a promise call it inside the async body, so they
//   reject rather than throw synchronously; constructors throw.

import { LobbyValidationError, quoteValue } from "./errors.js";

/** A validation rule: the reason `value` is invalid, or `undefined` when it is valid. */
export type Problem<T = unknown> = (value: T) => string | undefined;

/**
 * Check `value` against `problem` and return it unchanged when it is valid.
 * Otherwise throw a {@link LobbyValidationError} with the message
 * `Invalid <name>: <reason>`.
 */
export function assertValid<T>(name: string, value: T, problem: Problem<T>): T {
  const reason = problem(value);
  if (reason !== undefined) throw new LobbyValidationError(`Invalid ${name}: ${reason}`);
  return value;
}

/** Characters that never make a value non-blank: whitespace, controls, format characters, combining marks. */
const INVISIBLE = /[\s\p{Cc}\p{Cf}\p{M}]/gu;

/** A lone surrogate: half of a character, which URLSearchParams would send as U+FFFD. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * True when nothing in `value` would match anything: it holds only whitespace, control and
 * format characters (a zero-width space, a soft hyphen) and combining marks. Such a value reads
 * as "no query" upstream (the whole register), or matches nothing, so it is refused as blank.
 */
export function isBlank(value: string): boolean {
  return value.replace(INVISIBLE, "") === "";
}

/** How a value that is not a string reads in a message: `null`, `an array`, `number`. */
function typeOf(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "an array" : typeof value;
}

/**
 * A blank value (`isBlank`: "", whitespace, or only invisible characters) is invalid:
 * `/sucheJson` treats a blank `q` as no query and returns the whole register, and a blank
 * `sort` as the default order — often the result of an unset variable or an empty form field.
 */
export const nonEmptyProblem: Problem<unknown> = (value) =>
  typeof value !== "string"
    ? `Expected a string, got ${typeOf(value)}.`
    : isBlank(value)
      ? "Expected a non-empty value."
      : undefined;

/** `U+200B` for the first character of `text` that `pattern` matches. */
function codePointOf(text: string, pattern: RegExp): string {
  const ch = pattern.exec(text)?.[0] ?? "";
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** A control character inside free text: C0 and C1, but not TAB, LF or CR (whitespace in a pasted phrase). */
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** A format character inside free text, but not ZWNJ/ZWJ (U+200C/U+200D), which some scripts and emoji need. */
const TEXT_FORMAT = /(?![\u200c\u200d])\p{Cf}/u;

/**
 * Why `value` cannot be sent as free text (the query `q`), or undefined when it can. Refused,
 * before any request, as the register would match everything or nothing:
 * - a value that is blank once trimmed, or that holds only invisible characters and combining
 *   marks (`isBlank`): the register reads it as no query and answers with the whole register;
 * - a lone surrogate (half of a character, sent as U+FFFD);
 * - a control character (but TAB, LF and CR) or a format character (a zero-width space, a soft
 *   hyphen, a bidi control; ZWNJ and ZWJ are allowed): pasted along, it makes the search find
 *   nothing, which looks like a real answer.
 * The reason quotes the value with every invisible character escaped (`quoteValue`).
 */
export const textProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string") return `Expected a string, got ${typeOf(value)}.`;
  if (isBlank(value)) return "Expected a non-empty value.";
  if (LONE_SURROGATE.test(value)) return `${quoteValue(value)} contains half of a character (a lone surrogate).`;
  if (TEXT_CONTROL.test(value)) return `${quoteValue(value)} contains a control character (${codePointOf(value, TEXT_CONTROL)}).`;
  if (TEXT_FORMAT.test(value)) return `${quoteValue(value)} contains an invisible character (${codePointOf(value, TEXT_FORMAT)}).`;
  return undefined;
};

/**
 * The free-text query as the register matches it: without surrounding whitespace (a value
 * pasted with a trailing space is not the text typed) and in composed Unicode, NFC (a
 * decomposed "Müller", u plus U+0308 as pasted from a macOS file name, is another string
 * than the register's "Müller"). Inner whitespace is kept. Only for text the API matches;
 * check it with {@link textProblem} first. Codes (`sort`, filter values) are tokens
 * ({@link normalizeToken}).
 */
export function normalizeText(value: string): string {
  return value.trim().normalize("NFC");
}

/** A control or format character in a token (after trimming): every Cc and every Cf. */
const TOKEN_INVISIBLE = /[\p{Cc}\p{Cf}]/u;

/**
 * Why `value` cannot be sent as a token, or undefined when it can. A token is a code the
 * register compares exactly: a sort order, a filter code. The rules apply to the value with
 * surrounding whitespace trimmed, as it is sent ({@link normalizeToken}): not blank (and not
 * only invisible characters or combining marks), no lone surrogate, and no control or format
 * character at all (a zero-width space, ZWJ, a soft hyphen, a bidi control), since an invisible
 * character in a code only ever makes it match nothing. The reason quotes the value visibly. A
 * sort order is checked against the known ones too (`sortProblem` in filters.ts).
 */
export const tokenProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string") return `Expected a string, got ${typeOf(value)}.`;
  if (isBlank(value)) return "Expected a non-empty value.";
  const token = value.trim();
  if (LONE_SURROGATE.test(token)) return `${quoteValue(value)} contains half of a character (a lone surrogate).`;
  if (TOKEN_INVISIBLE.test(token)) {
    return `${quoteValue(value)} contains an invisible or control character (${codePointOf(token, TOKEN_INVISIBLE)}).`;
  }
  return undefined;
};

/** A token as it is sent: trimmed and in composed Unicode (NFC). Check it with {@link tokenProblem} first. */
export function normalizeToken(value: string): string {
  return value.trim().normalize("NFC");
}

/**
 * The items of a comma-separated list value, as typed: each item is checked (`listProblem`)
 * and canonicalised (`normalizeToken`) on its own, so `"a1, a2"` sends `a2`, and `"a1,,a2"`,
 * `"a1,"` and `","` are refused rather than sent as an empty item (which an API may read as
 * "no filter"). The CLI has no list option today; the rule is the kit's, for one that comes.
 */
export function splitList(value: string): string[] {
  return value.split(",");
}

/**
 * Why `items` cannot be sent as a list, or undefined when it can: not an array of strings, no
 * item at all (an empty list reads as "no filter"), or an item that `itemProblem` refuses (by
 * default {@link tokenProblem}: a blank item is refused, never dropped). The reason names the item.
 */
export function listProblem(items: readonly string[], itemProblem: Problem<unknown> = tokenProblem): string | undefined {
  if (!Array.isArray(items)) return "Expected a list of strings.";
  if (items.length === 0) return "Expected at least one value.";
  for (let i = 0; i < items.length; i++) {
    const problem = itemProblem(items[i]);
    if (problem !== undefined) return items.length === 1 ? problem : `item ${i + 1} of ${items.length}: ${problem}`;
  }
  return undefined;
}

/**
 * A rule for an integer option: valid when `value` is a safe integer in
 * `min..max`. NaN, Infinity and fractions are no integer. The reasons match the
 * CLI's integer parsers ("Must be >= 0.", "Must be <= 2147483647.").
 */
export function intInRangeProblem(min: number, max: number = Number.MAX_SAFE_INTEGER): Problem<unknown> {
  return (value) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return "Expected an integer.";
    if (value < min) return `Must be >= ${min}.`;
    if (value > max) return `Must be <= ${max}.`;
    return undefined;
  };
}

/**
 * A value that ends up in an HTTP header (the User-Agent, a `headers` entry) must
 * be a non-blank string of Latin-1 characters without control characters (tab is
 * allowed, as in HTTP). Node's HTTP layer would otherwise throw an opaque "Invalid
 * character in header content" at request time, and a custom transport would get
 * a CR/LF through (header injection). Checked by char code so the source stays
 * free of control bytes.
 */
export const headerValueProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string" || isBlank(value)) return "Expected a non-empty value.";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09) || c === 0x7f) return "Value contains control characters.";
    if (c > 0xff) return "Value contains characters outside Latin-1 (above U+00FF).";
  }
  return undefined;
};

/** An HTTP header name must be a non-empty RFC 9110 token. */
export const headerNameProblem: Problem<unknown> = (value) =>
  typeof value === "string" && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
    ? undefined
    : "Expected an HTTP header name (a token such as X-Request-Id).";
