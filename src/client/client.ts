// LobbyregisterClient — a typed client over the open (no-auth) search endpoint of
// the German Lobbyregister (https://www.lobbyregister.bundestag.de/sucheJson),
// the public register of interest representatives ("Lobbyisten").
//
//   client.search({ q: "Energie", pageSize: 10 })
//   client.count("Energie")

import { RequestEngine, type EngineOptions } from "./engine.js";
import type { QueryParams } from "./query.js";
import type { SearchResult, SearchParams } from "./types.js";

const PATH = "/sucheJson";

export class LobbyregisterClient {
  private readonly engine: RequestEngine;

  constructor(options: EngineOptions = {}) {
    this.engine = new RequestEngine(options);
  }

  /** Search the register; returns the full envelope (resultCount + results). */
  search(params: SearchParams = {}): Promise<SearchResult> {
    const query: QueryParams = {};
    if (params.q !== undefined) query["q"] = params.q;
    if (params.page !== undefined) query["page"] = params.page;
    if (params.pageSize !== undefined) query["pageSize"] = params.pageSize;
    if (params.sort !== undefined) query["sort"] = params.sort;
    return this.engine.getJson(PATH, query);
  }

  /**
   * How many entries match a query.
   *
   * Uses `pageSize: 1` rather than `pageSize: 0`. A live probe of `/sucheJson`
   * (2026-06) showed the endpoint ignores `pageSize` for the returned `results`
   * array entirely: both `pageSize=0` and `pageSize=1` return the full result
   * set (e.g. all 2351 entries for `q=Energie`) while reporting the correct
   * `resultCount`. `pageSize=0` therefore does NOT yield an empty-results
   * envelope and offers no download saving, so switching to it would not help.
   * `resultCount` is read from whatever envelope comes back.
   */
  async count(q?: string): Promise<number> {
    const res = await this.search({ q, pageSize: 1 });
    return res.resultCount;
  }
}
