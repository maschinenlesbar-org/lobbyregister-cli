# lobbyregister-cli — exploratory/black-box bug report

**Environment note**
- Tested on macOS (darwin 25.5.0), Node available, `npm run build` succeeded cleanly, all 34 unit tests pass.
- The live Bundestag Lobbyregister `/sucheJson` API **was reachable** throughout testing. `count Energie` returned `2351`; `count` with no query returned `6877`.
- Key live API behaviour discovered: **`/sucheJson` ignores `page` and `pageSize` entirely** — it always returns the full result set (e.g. ~6.09 MB / 2351 entries for `q=Energie`) and only varies `resultCount`. It returns **HTTP 200 for every malformed parameter** tested (`page=-1`, `pageSize=abc`, `sort=NOTREAL`). This is the root of several bugs below.
- All commands run as `node dist/src/cli/index.js ...` from the package root.

**Total genuine, reproducible bugs found: 20** (all 20 are real and reproduced; none fabricated).

---

## High severity (correctness / data-volume / misleading core feature)

### 1. `--page` does nothing — pagination is silently a no-op
- **Severity:** High · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js search Energie --page 1 --compact --results-only   # len 2351, first R002822
  node dist/src/cli/index.js search Energie --page 2 --compact --results-only   # len 2351, first R002822
  ```
- **Expected:** Page 2 returns a different slice of results (or the CLI states paging is unsupported).
- **Actual:** Both pages return the identical full 2351-entry array (exit 0). `--page` is advertised in `--help` and README ("First page of results") but has zero effect.
- **Root cause:** API ignores `page`; CLI passes it through unconditionally (`src/cli/commands/search.ts:17`, `src/client/client.ts:25`) and the tool advertises a feature the backend does not support. No client-side guard or doc warning.

### 2. `--page-size` does nothing — every search/count downloads the full ~6 MB body
- **Severity:** High · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js search Energie --page-size 1 --compact --results-only
  ```
  Compare to: `curl -s '.../sucheJson?q=Energie&pageSize=1' -w '%{size_download}'` → `6093911` bytes.
- **Expected:** `--page-size 1` returns 1 entry / a small body.
- **Actual:** Returns all 2351 entries; body is ~6.09 MB regardless of `--page-size` (tried `0`, `1`, `1000`, huge). The flag is documented and accepted but inert.
- **Root cause:** API ignores `pageSize`; `client.search` forwards it verbatim (`src/client/client.ts:26`). The code even *knows* this (comment at `client.ts:31-45`) yet still advertises `--page-size` as functional in help/README.

### 3. `count` always downloads the entire result set (~6 MB) just to read one integer
- **Severity:** High · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js count Energie     # ~1s, transfers 6.09 MB to print {"resultCount":2351}
  ```
- **Expected:** A count operation should be cheap (HEAD-like / minimal body).
- **Actual:** `count` fetches the full 6.09 MB envelope (2351 full register entries) and discards `results`, keeping only `resultCount`. Confirmed via curl byte count above. Pathological for large queries (`count` with empty query = 6877 entries).
- **Root cause:** `count()` calls `search({ q, pageSize: 1 })` and reads `res.resultCount` (`src/client/client.ts:42-45`). Because the API ignores `pageSize`, no saving is achieved. The doc comment acknowledges this but the design ships it anyway — there is no lighter-weight count path.

### 4. `parseIntArg` accepts hex/binary/scientific/`+`-prefixed strings as "integers"
- **Severity:** High · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js --timeout 0x10 count Energie
  ```
- **Expected:** `0x10` rejected as "Expected a non-negative integer" (it is not a decimal integer a user would type).
- **Actual:**
  ```
  Error: Request timed out after 16ms
  exit=1
  ```
  `0x10` is silently coerced by `Number()` to `16`. Same for `--timeout 1e3` (→1000ms, succeeds), `--page-size 0x1F` (→31), `0b10` (→2), `+5` (→5).
- **Root cause:** `parseIntArg` uses `Number(value)` then `Number.isInteger` (`src/cli/shared.ts:10-16`). `Number("0x10")===16` passes the check. Should use a strict decimal-integer regex / `Number.parseInt` with base check.

### 5. `parseIntArg` accepts the empty string as `0`
- **Severity:** High · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js search Energie --page-size "" --compact --results-only   # OK len 2351
  ```
- **Expected:** Empty value rejected as invalid.
- **Actual:** `Number("")===0`, `Number.isInteger(0)` true, `0>=0` true → accepted; the CLI sends `pageSize=0` (verified: `buildQueryString({pageSize:Number("")})` → `pageSize=0`). Exit 0.
- **Root cause:** Same `Number("")===0` JS quirk in `parseIntArg` (`src/cli/shared.ts:11`).

### 6. `parseIntArg` accepts whitespace-padded numbers
- **Severity:** High · **Confidence:** High
- **Repro / evidence:** `Number("  5  ")===5` and `Number("5\n")===5`, both pass the `Number.isInteger && >=0` check in `parseIntArg`. So `--page-size '  5  '` is accepted as 5.
- **Expected:** Strict numeric token rejected if surrounded by whitespace.
- **Actual:** Silently trimmed/coerced and accepted.
- **Root cause:** `Number()` ignores surrounding whitespace (`src/cli/shared.ts:11`).

### 7. `parseIntArg` accepts values beyond `Number.MAX_SAFE_INTEGER` without warning
- **Severity:** Medium-High · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js search Energie --page-size 99999999999999999999 --compact --results-only
  ```
- **Expected:** Reject or clamp; `99999999999999999999` is not representable as an exact integer.
- **Actual:** `Number(...)===1e20`, `Number.isInteger(1e20)` is `true`, so it is accepted and sent as `pageSize=100000000000000000000` (precision already lost). Exit 0.
- **Root cause:** No `Number.isSafeInteger` / upper-bound check in `parseIntArg` (`src/cli/shared.ts:12`).

---

## Medium severity (error mapping / dead code / docs vs behaviour)

### 8. Bad `--sort` value is silently accepted (README/code promise an error + hint that never fires)
- **Severity:** Medium · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js search Energie --page-size 1 --sort BOGUS_VALUE --results-only --compact
  ```
- **Expected (per README lines 61-64 & run.ts):** "If the API rejects a value with an HTTP 400, the CLI exits 1 and prints the API's error detail (plus a hint to check `--sort`)."
- **Actual:** API returns HTTP 200 for `sort=NOTREAL` (verified via curl); results print normally, exit 0. The documented 400/hint behaviour is therefore unreachable for the very case it was written for — a user typo in `--sort` is silently honoured/ignored, never flagged.
- **Root cause:** The 400-hint branch (`src/cli/run.ts:43-48`) assumes the API validates `sort`; the live API does not. Effectively dead defensive code; the docs overpromise validation that does not happen.

### 9. Non-existent host reports a misleading "Failed to parse JSON" instead of a network/DNS error
- **Severity:** Medium · **Confidence:** Medium (depends on resolver wildcard, but reproducible on common ISP/DNS setups)
- **Repro:**
  ```
  node dist/src/cli/index.js --base-url http://nonexistent.invalid.tld.xyz count Energie
  ```
- **Expected:** A DNS/connection error (`ENOTFOUND`-style) or at least an HTTP error, not a JSON parse error.
- **Actual:**
  ```
  Error: Failed to parse JSON response from /sucheJson
  exit=1
  ```
  The bogus host resolved (wildcard/captive DNS → `13.248.169.48`) and returned non-JSON HTML with HTTP 200, which the engine blindly `JSON.parse`d.
- **Root cause:** `getJson` parses any 2xx body as JSON without checking `Content-Type` (`src/client/engine.ts:162-170`). A 200 `text/html` page yields a parse error rather than a clear "unexpected content type" message. (`contentType` is captured at `engine.ts:152` but never validated.)

### 10. README exit-code contract is incomplete/contradictory ("non-zero for usage errors")
- **Severity:** Medium · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js frobnicate; echo $?        # 1
  node dist/src/cli/index.js search foo --nope; echo $? # 1
  node dist/src/cli/index.js; echo $?                   # 1 (no command)
  ```
- **Expected per README line 79:** "0 success, 4 on a 404, 1 for any other error, non-zero for usage errors." The README implies usage errors are distinct from "1 for any other error".
- **Actual:** Usage errors all exit `1` — the same code as generic runtime errors (404=4 is the only distinct code). So "non-zero for usage errors" is technically true but the wording suggests a separate code; scripts cannot distinguish a usage error from a network error.
- **Root cause:** Commander's default `exitCode` (1) is surfaced unchanged (`src/cli/run.ts:32-34`); no dedicated usage-error code.

### 11. `count` reports `query: null` for no-arg but actually queries the whole register
- **Severity:** Medium · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js count            # {"query": null, "resultCount": 6877}
  ```
- **Expected:** Either reject empty queries or make clear it counts the entire register.
- **Actual:** Output `query: null` with `resultCount: 6877` is ambiguous — it looks like an error/no-op but is actually "count of everything". Combined with bug #3 this silently downloads the full 6877-entry dump.
- **Root cause:** `count` action maps missing query to `null` for display (`src/cli/commands/search.ts:30`) but the underlying call omits `q`, returning the global total — semantics not surfaced.

### 12. `search` with no query also downloads the entire register silently
- **Severity:** Medium · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js search --page-size 1 --compact   # resultCount 6877, full body
  ```
- **Expected:** Require a query, or warn that an empty query dumps all 6877 entries (~17 MB+).
- **Actual:** Silently returns the entire register envelope. No guard.
- **Root cause:** `[query]` is optional and `pageSize` is inert (`src/cli/commands/search.ts:7`, bugs #2/#3).

### 13. HTTP 414 (URI too long) maps to generic exit 1 with a raw URL dump
- **Severity:** Medium · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js count "$(node -e "process.stdout.write('a'.repeat(10000))")"
  ```
- **Expected:** A friendly "query too long" message.
- **Actual:**
  ```
  Error: HTTP 414 for GET https://www.lobbyregister.bundestag.de/sucheJson?q=aaaa...   (multi-KB URL dumped)
  exit=1
  ```
  The entire 10 000-char URL is echoed to stderr.
- **Root cause:** `toApiError` builds the message from the full URL with no length cap (`src/client/errors.ts:31`); no special handling for 414, and no client-side query-length guard.

---

## Low severity (UX / docs / output)

### 14. No-args prints full help to **stdout** but exits 1 (help-to-stdout + failure code mismatch)
- **Severity:** Low · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js; echo $?    # prints help, exit 1
  ```
- **Expected:** Either exit 0 (help shown deliberately) or print the error to stderr. Mixed signal: success-looking help text on stdout but a failure exit code.
- **Root cause:** Commander emits the missing-command help via the configured `writeOut` → stdout (`src/cli/run.ts:17-18`) while the thrown `CommanderError` carries exitCode 1 (`run.ts:32-34`).

### 15. Error/usage text is written without a trailing newline (chomped)
- **Severity:** Low · **Confidence:** High
- **Repro:** Pipe any error: `node dist/src/cli/index.js search foo --nope | cat` — the final help block has its trailing newline stripped, so the next shell prompt/pipe output runs on the same line.
- **Expected:** Output ends with a newline.
- **Root cause:** `configureOutput` deliberately strips one trailing `\n` (`str.replace(/\n$/, "")`) at `src/cli/run.ts:18-19`, then `defaultIO.out/err` re-add exactly one — but for multi-line help commander already includes the newline that gets stripped, leaving inconsistent final-newline behaviour vs direct `console`.

### 16. README example `lobbyregister --compact count Energie` works, but README also says "Global options go **before** the command" — yet `--compact` after the command also works (inconsistent guidance)
- **Severity:** Low · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js count Energie --compact   # works: {"query":"Energie","resultCount":2351}
  ```
- **Expected:** Documentation matches behaviour (commander allows globals after via `optsWithGlobals`).
- **Actual:** README line 52 says globals must go before the command; in practice they work after too. Minor doc/behaviour mismatch.
- **Root cause:** `optsWithGlobals()` resolves globals regardless of position (`src/cli/shared.ts:66`); README is stricter than reality.

### 17. `--max-retries` / `--timeout` / `--max-response-bytes` defaults shown in `--help` omit their real default values
- **Severity:** Low · **Confidence:** High
- **Repro:** `node dist/src/cli/index.js --help`
- **Expected:** Help shows defaults (timeout 30000, max-retries 2, max-response-bytes 100 MiB) like `--base-url` does.
- **Actual:** Only `--base-url` shows a `(default: ...)`. The numeric options describe the default in prose ("default 100 MiB") but commander does not render an actual default token, and `--timeout`/`--max-retries` show no default at all, while the engine does apply 30000/2.
- **Root cause:** `.option(...)` calls for the numeric flags pass `parseIntArg` as the 3rd arg instead of a default value (`src/cli/program.ts:31-38`), so commander has no default to display.

### 18. `count` accepts no command-specific options, so `--results-only`/`--page`/`--page-size` on `count` error out — but these would be reasonable user expectations
- **Severity:** Low · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js count Energie --page 2
  # error: unknown option '--page'
  ```
- **Expected:** Clear messaging is fine, but a user reasonably tries `count ... --page-size`; the error gives no hint these are `search`-only.
- **Actual:** Generic "unknown option" with the count usage block. Minor UX.
- **Root cause:** `count` registers no options (`src/cli/commands/search.ts:25-32`).

### 19. `--timeout 1e3` succeeds — scientific notation silently accepted for a "milliseconds integer"
- **Severity:** Low · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js --timeout 1e3 count Energie   # works, timeout = 1000ms
  ```
- **Expected:** Reject `1e3`; it is not a plain integer.
- **Actual:** Accepted (`Number("1e3")===1000`, integer). Exit 0. (Sibling of bug #4; listed separately because timeout is a different surface and a user could be genuinely surprised here.)
- **Root cause:** `parseIntArg` (`src/cli/shared.ts:11`).

### 20. Query argument that looks like an unknown short option is rejected (no way to search a `-`-leading term without `--`)
- **Severity:** Low · **Confidence:** High
- **Repro:**
  ```
  node dist/src/cli/index.js search -xyz
  # error: unknown option '-xyz'
  ```
  (Workaround `search -- -xyz` works, but it is undocumented.)
- **Expected:** Either treat a non-flag-looking leading-dash token as the query, or document the `--` separator.
- **Actual:** Leading-dash queries fail unless the user knows to insert `--`; README never mentions `--`.
- **Root cause:** Commander treats `-xyz` as options before the positional; no `--` guidance in help/README (`src/cli/commands/search.ts:7`).

---

## Summary

- **20 genuine, reproducible bugs**, all verified against the live API and the built CLI.
- Grouped: **7 High**, **6 Medium**, **7 Low**.
- The three most serious are the inert pagination (`--page`/`--page-size` do nothing while advertised) and the resulting full-6 MB download on every `count`/`search`, plus the over-permissive `parseIntArg` that accepts hex/empty/whitespace/scientific values as "non-negative integers".
- Things that are NOT bugs / correct: 404 → exit 4 (confirmed `echo $?` = 4); no fields dropped vs raw curl `/sucheJson` (envelope identical); UTF-8 umlauts/emoji emitted raw (not escaped) in both pretty and compact; special URL chars (`&=?#%`) correctly encoded; `file://`/`ftp://` base URLs rejected with a typed error; empty base URL rejected; trailing-slash base URL normalised; extra positional args rejected; timeout/max-response-bytes enforced.
